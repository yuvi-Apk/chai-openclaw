/**
 * The core of chat mode: one user message in, one structured result out.
 * It runs the stages in order (route, answer directly or plan, search,
 * check, write) and depends only on the interfaces, never on a provider or
 * on the terminal, so any front end can call it.
 */
import type { Cache } from "../../core/cache";
import type { HistoryStore } from "../../core/history";
import type { LLMClient } from "../../core/llm/types";
import type { PageFetcher, SearchProvider, Source } from "../../core/search/types";
import { CallBudget, limitInput, RateLimiter } from "../../core/security/limits";
import type { UsageRecord } from "../../core/usage";
import type { ChatConfig } from "./config";
import { summaryPrompt } from "./prompts";
import { planSearch } from "./stages/planner";
import { decideRoute } from "./stages/router";
import { gatherEvidence } from "./stages/searcher";
import { MeteredLLM, type StageContext } from "./stages/shared";
import { checkSufficiency } from "./stages/sufficiency";
import { answerDirectly, answerFromSources, citedSources } from "./stages/synthesizer";
import type { ChatResult, CitedSource, RouteDecision, SearchPlan } from "./types";

export interface ChatDeps {
    llm: LLMClient;
    search: SearchProvider;
    pages: PageFetcher;
    searchCache: Cache<Source[]>;
    routeCache: Cache<RouteDecision>;
    history: HistoryStore;
}

export interface AskOptions {
    /** "search" always searches the web, "direct" never does. */
    force?: "search" | "direct";
    signal?: AbortSignal;
    /** A short progress line, e.g. "Searching (2 queries)". */
    onStatus?: (status: string) => void;
    /** Called once, just before the first piece of the answer. */
    onAnswerStart?: (origin: "model" | "web") => void;
    onToken?: (token: string) => void;
}

/** With this many results a simple question is not worth a sufficiency call. */
const ENOUGH_SOURCES_FOR_SIMPLE = 3;
/** Longest fallback summary kept when the summary call fails. */
const FALLBACK_SUMMARY_CHARS = 600;
/** Sources listed after an answer when it is stored in the history. */
const SOURCES_KEPT_IN_HISTORY = 6;

export class ChatEngine {
    /** The sources of the most recent web answer, for a "/sources" command. */
    lastSources: CitedSource[] = [];

    private readonly modelLimiter: RateLimiter;
    private readonly searchLimiter: RateLimiter;
    /** Folding old turns into the summary runs between messages. */
    private pendingSummary: Promise<void> | null = null;
    /** Usage of that background call, reported with the next message. */
    private carriedUsage: UsageRecord[] = [];

    constructor(
        private readonly deps: ChatDeps,
        readonly config: ChatConfig,
    ) {
        this.modelLimiter = new RateLimiter(config.maxModelCallsPerMinute);
        this.searchLimiter = new RateLimiter(config.maxSearchesPerMinute);
    }

    /** Forget the conversation. Cached search results are kept. */
    reset(): void {
        this.deps.history.clear();
        this.lastSources = [];
    }

    async ask(rawText: string, options: AskOptions = {}): Promise<ChatResult> {
        await this.pendingSummary;
        const { config, deps } = this;
        const { history } = deps;
        const notes: string[] = [];
        const status = (text: string) => options.onStatus?.(text);

        const { text: question, truncated } = limitInput(rawText, config.maxInputChars);
        if (truncated) notes.push(`Your message was cut to ${config.maxInputChars} characters.`);

        const llm = new MeteredLLM(
            deps.llm,
            new CallBudget(config.maxCallsPerMessage, config.maxTokensPerMessage),
            this.modelLimiter,
        );
        const ctx: StageContext = { llm, config, ...(options.signal ? { signal: options.signal } : {}) };

        let answerStarted = false;
        const emitter = (origin: "model" | "web") => (token: string) => {
            if (!answerStarted) {
                answerStarted = true;
                options.onAnswerStart?.(origin);
            }
            options.onToken?.(token);
        };

        const finish = (
            partial: Pick<ChatResult, "kind" | "answer" | "origin" | "sources" | "route"> & {
                plan?: SearchPlan;
                cacheHits?: number;
            },
        ): ChatResult => {
            this.remember(question, partial.answer, partial.sources);
            if (partial.origin === "web") this.lastSources = partial.sources;
            const usage = [...this.carriedUsage, ...llm.usage];
            this.carriedUsage = [];
            return { cacheHits: 0, ...partial, usage, notes };
        };

        // ---- Step 1: does this need the web? ----
        status("Understanding your question");
        let route: RouteDecision =
            options.force === "search"
                ? { needsSearch: true, reason: "you asked for a web search", complexity: "moderate", via: "forced" }
                : options.force === "direct"
                    ? { needsSearch: false, reason: "you asked for no web search", complexity: "moderate", via: "forced" }
                    : await decideRoute(question, history, deps.routeCache, ctx);

        // ---- Step 2: answer straight from the model ----
        if (!route.needsSearch) {
            status("Writing answer");
            const direct = await answerDirectly(
                question,
                route,
                history,
                ctx,
                // Leave room for the search path if the model asks for it.
                { allowEscalation: options.force !== "direct" && llm.budget.hasRoom(2), noLiveData: false },
                emitter("model"),
            );
            if (!direct.escalate) {
                return finish({ kind: "answer", answer: direct.answer, origin: "model", sources: [], route });
            }
            route = { ...route, needsSearch: true, reason: "the model asked for fresh data", via: "escalated" };
        }

        // ---- Step 3: understand the request and plan the searches ----
        const plan = await planSearch(question, route, history, ctx);
        if (plan.clarify) {
            return finish({ kind: "clarify", answer: plan.clarify, origin: "model", sources: [], route, plan });
        }

        // ---- Step 4: search ----
        let searchesLeft = config.maxSearchesPerMessage;
        const searchDeps = { search: deps.search, cache: deps.searchCache, limiter: this.searchLimiter };
        const runSearch = async (queries: string[], existing: Source[]) => {
            const allowed = queries.slice(0, searchesLeft);
            searchesLeft -= allowed.length;
            return gatherEvidence(allowed, searchDeps, config, options.signal, existing);
        };

        status(`Searching (${plan.queries.length} ${plan.queries.length === 1 ? "query" : "queries"})`);
        const first = await runSearch(plan.queries, []);
        let sources = first.sources;
        let cacheHits = first.cacheHits;

        if (!sources.length) {
            // Search is down or found nothing: still answer, and say so.
            notes.push(
                first.failures
                    ? "Web search was not available, so this answer comes from the model alone."
                    : "The web search found nothing, so this answer comes from the model alone.",
            );
            status("Writing answer");
            const direct = await answerDirectly(
                question,
                route,
                history,
                ctx,
                { allowEscalation: false, noLiveData: true },
                emitter("model"),
            );
            const answer = direct.escalate ? "" : direct.answer;
            return finish({ kind: "answer", answer, origin: "model", sources: [], route, plan, cacheHits });
        }

        // ---- Step 5: is the evidence enough? At most one extra round. ----
        const worthChecking = !(route.complexity === "simple" && sources.length >= ENOUGH_SOURCES_FOR_SIMPLE);
        if (config.maxFollowUpRounds > 0 && worthChecking && llm.budget.hasRoomForOptional(1)) {
            status("Checking the sources");
            const verdict = await checkSufficiency(plan.intent, sources, ctx);
            if (!verdict.sufficient) {
                status(verdict.read.length ? "Reading sources" : "Searching again");
                const [more] = await Promise.all([
                    verdict.queries.length ? runSearch(verdict.queries, sources) : null,
                    this.readPages(sources, verdict.read, options.signal),
                ]);
                if (more) {
                    sources = [...sources, ...more.sources];
                    cacheHits += more.cacheHits;
                }
            }
        }

        // ---- Step 6: write the cited answer ----
        status("Writing answer");
        const answer = await answerFromSources(question, plan, sources, history, ctx, emitter("web"));
        return finish({
            kind: "answer",
            answer,
            origin: "web",
            sources: citedSources(answer, sources),
            route,
            plan,
            cacheHits,
        });
    }

    /**
     * Replace the short excerpt of the chosen sources with the page text.
     * A page that cannot be read keeps its excerpt; that is not an error.
     */
    private async readPages(sources: Source[], numbers: number[], signal?: AbortSignal): Promise<void> {
        await Promise.all(
            numbers.slice(0, this.config.maxPagesToRead).map(async (n) => {
                const source = sources[n - 1];
                if (!source) return;
                try {
                    const text = await this.deps.pages.fetchText(source.url, signal);
                    if (text.length > source.snippet.length) {
                        sources[n - 1] = { ...source, snippet: text.slice(0, this.config.maxPageChars) };
                    }
                } catch {
                    // keep the excerpt
                }
            }),
        );
        if (signal?.aborted) throw signal.reason ?? new Error("aborted");
    }

    /**
     * Store the turn. Only the answer and a short source list are kept, never
     * the raw search results, so later turns stay cheap.
     */
    private remember(question: string, answer: string, sources: CitedSource[]): void {
        if (!answer) return;
        const { history } = this.deps;
        const sourceLine = sources.length
            ? `\nSources: ${sources
                .slice(0, SOURCES_KEPT_IN_HISTORY)
                .map((s) => `[${s.n}] ${s.title} (${s.url})`)
                .join("; ")}`
            : "";
        history.append({ role: "user", content: question });
        history.append({ role: "assistant", content: answer + sourceLine });

        const overflow = history.takeOverflow();
        if (overflow.length) this.pendingSummary = this.summarise(overflow);
    }

    /** Fold turns that left the recent window into the rolling summary. */
    private async summarise(overflow: { role: string; content: string }[]): Promise<void> {
        const { history, llm } = this.deps;
        const previous = history.summary();
        const transcript = overflow
            .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content.slice(0, 1200)}`)
            .join("\n");
        const model = this.config.routerModel();
        const startedAt = Date.now();
        try {
            if (!this.modelLimiter.tryTake()) throw new Error("rate limited");
            const reply = await llm.complete({
                model,
                system: summaryPrompt(),
                messages: [
                    {
                        role: "user",
                        content: `${previous ? `Summary so far: ${previous}\n\n` : ""}Conversation:\n${transcript}`,
                    },
                ],
                maxTokens: this.config.maxOutputTokens.summary,
                lowEffort: true,
            });
            if (!reply.text.trim()) throw new Error("empty summary");
            history.setSummary(reply.text);
            this.carriedUsage.push({
                step: "summary",
                model,
                inputTokens: reply.inputTokens,
                outputTokens: reply.outputTokens,
                cost: reply.cost,
                ms: Date.now() - startedAt,
            });
        } catch {
            // No summary call possible: keep the questions themselves, clipped.
            const questions = overflow
                .filter((t) => t.role === "user")
                .map((t) => t.content.slice(0, 120))
                .join(" | ");
            history.setSummary(`${previous} ${questions}`.trim().slice(-FALLBACK_SUMMARY_CHARS));
        }
    }
}
