/**
 * Stages 2 and 6: write the answer.
 * `answerDirectly` answers from the model alone. `answerFromSources` writes
 * a cited answer from the gathered web evidence. Both stream their text.
 */
import type { HistoryStore } from "../../../core/history";
import type { LLMRequest, LLMResponse } from "../../../core/llm/types";
import type { Source } from "../../../core/search/types";
import { wrapUntrusted } from "../../../core/security/untrusted";
import { directAnswerPrompt, NEED_SEARCH_SIGNAL, synthesisPrompt } from "../prompts";
import type { CitedSource, RouteDecision, SearchPlan } from "../types";
import type { StageContext } from "./shared";

/** The numbered source list the model reads, marked as untrusted web content. */
export function buildEvidenceBlock(sources: Source[]): string {
    const entries = sources.map((source, index) => {
        const date = source.date ? ` | ${source.date}` : "";
        return `[${index + 1}] ${source.title} | ${source.url}${date}\n${source.snippet}`;
    });
    return wrapUntrusted(entries.join("\n\n"));
}

/** The sources the answer actually cites. If it cites none, all are returned. */
export function citedSources(answer: string, sources: Source[]): CitedSource[] {
    const numbered = sources.map((source, index) => ({ ...source, n: index + 1 }));
    const used = new Set([...answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
    const cited = numbered.filter((source) => used.has(source.n));
    return cited.length ? cited : numbered;
}

/**
 * Stream an answer. Some models now and then return nothing at all; nothing
 * has reached the screen in that case, so trying once more is safe.
 */
async function streamAnswer(
    ctx: StageContext,
    request: LLMRequest,
    onToken: (token: string) => void,
): Promise<LLMResponse> {
    const first = await ctx.llm.stream("answer", request, onToken);
    if (first.text.trim() || !ctx.llm.budget.hasRoom()) return first;
    return ctx.llm.stream("answer (retry)", request, onToken);
}

export interface DirectOptions {
    /** Let the model answer NEED_SEARCH instead of guessing at fresh facts. */
    allowEscalation: boolean;
    /** A search was wanted but failed; the model should say its answer may be dated. */
    noLiveData: boolean;
}

/** Either the finished answer, or a request to search the web first. */
export type DirectOutcome = { escalate: false; answer: string } | { escalate: true };

export async function answerDirectly(
    question: string,
    route: RouteDecision,
    history: HistoryStore,
    ctx: StageContext,
    options: DirectOptions,
    onToken: (token: string) => void,
): Promise<DirectOutcome> {
    // The first few characters are held back until it is clear the reply is
    // not the NEED_SEARCH signal, so the signal never reaches the screen.
    let held = "";
    let decided = !options.allowEscalation;
    let escalate = false;

    const receive = (token: string) => {
        if (escalate) return;
        if (decided) return onToken(token);
        held += token;
        const start = held.trimStart();
        if (start.length < NEED_SEARCH_SIGNAL.length && NEED_SEARCH_SIGNAL.startsWith(start)) return;
        decided = true;
        if (start.startsWith(NEED_SEARCH_SIGNAL)) escalate = true;
        else onToken(held);
    };

    const reply = await streamAnswer(
        ctx,
        {
            // Small talk and sums do not need the stronger, dearer model.
            model: route.complexity === "simple" ? ctx.config.routerModel() : ctx.config.answerModel(),
            system: directAnswerPrompt({ ...options, summary: history.summary() }),
            messages: [...history.turns(), { role: "user", content: question }],
            maxTokens: ctx.config.maxOutputTokens.answer,
            ...(ctx.signal ? { signal: ctx.signal } : {}),
        },
        receive,
    );

    if (escalate || (!decided && reply.text.trim() === NEED_SEARCH_SIGNAL)) return { escalate: true };
    if (!decided) onToken(held); // a reply shorter than the signal word
    if (!reply.text.trim()) throw new Error("The model returned an empty answer.");
    return { escalate: false, answer: reply.text.trim() };
}

export async function answerFromSources(
    question: string,
    plan: SearchPlan,
    sources: Source[],
    history: HistoryStore,
    ctx: StageContext,
    onToken: (token: string) => void,
): Promise<string> {
    const lines = [`Question: ${question}`];
    if (plan.intent && plan.intent !== question) lines.push(`Understood as: ${plan.intent}`);
    if (plan.assumption) lines.push(`Assumption made (mention it briefly): ${plan.assumption}`);
    lines.push("", "Sources:", buildEvidenceBlock(sources));

    const reply = await streamAnswer(
        ctx,
        {
            model: ctx.config.answerModel(),
            system: synthesisPrompt(history.summary()),
            messages: [...history.turns(), { role: "user", content: lines.join("\n") }],
            maxTokens: ctx.config.maxOutputTokens.answer,
            ...(ctx.signal ? { signal: ctx.signal } : {}),
        },
        onToken,
    );
    if (!reply.text.trim()) throw new Error("The model returned an empty answer.");
    return reply.text.trim();
}
