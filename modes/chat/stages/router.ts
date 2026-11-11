/**
 * Stage 1: decide whether a question needs a web search.
 * Obvious cases are settled by free rules. Only the unclear ones cost a
 * call to the cheap model, and that decision is cached.
 */
import type { Cache, HistoryStore } from "../interfaces";
import { routerPrompt } from "../prompts";
import type { Complexity, RouteDecision } from "../types";
import { compactContext, completeJsonStep, extractJson, textField, type StageContext } from "./shared";

/** Words that mean the answer changes over time. */
const TIME_SENSITIVE =
    /\b(latest|newest|today|tonight|yesterday|tomorrow|currently|right now|this (week|month|year)|recent(ly)?|news|headlines|price of|stock price|share price|exchange rate|who won|score of|live score|weather|forecast|release date|current (version|price|president|prime minister|ceo|status|events?))\b/i;

const WANTS_SOURCES =
    /\b(with (sources|links|references|citations)|cite|citations?|(give|provide|show|share)( me)?( a| some| the)? (links?|sources?|references?))\b/i;

const SMALL_TALK =
    /^(hi|hello|hey|yo|thanks|thank you|thx|ok|okay|cool|great|bye|good (morning|afternoon|evening|night))\b[\s!.,]*$/i;

/** Only digits and operators, e.g. "12 * (3 + 4)". */
const ARITHMETIC = /^(?=.*\d)[\d\s+\-*/().^%=x]+\??$/i;

/** Openings that ask for an explanation or a piece of writing, not for facts of the day. */
const STABLE_REQUEST =
    /^(please\s+|can you\s+|could you\s+)?(explain|define|describe how|how (do|does|to|can|would)|why (do|does|is|are)|write|rewrite|translate|summari[sz]e|fix|debug|refactor|convert|calculate|solve|prove|what (is|are) (a|an|the difference|the meaning)|what does .+ mean)\b/i;

/** A time-sensitive question up to this length counts as simple. */
const SIMPLE_QUESTION_MAX_CHARS = 80;

/** True when the text mentions this year, last year or a later one. */
function mentionsRecentYear(text: string): boolean {
    const cutoff = new Date().getFullYear() - 1;
    return [...text.matchAll(/\b(20\d\d)\b/g)].some((m) => Number(m[1]) >= cutoff);
}

/** Does the text ask about something that changes? Also used to pick a cache lifetime. */
export function looksTimeSensitive(text: string): boolean {
    return TIME_SENSITIVE.test(text) || mentionsRecentYear(text);
}

/** Settle the obvious cases without a model call. Null means "not obvious". */
export function routeByRules(question: string): RouteDecision | null {
    const text = question.trim();
    const decide = (needsSearch: boolean, reason: string, complexity: Complexity): RouteDecision => ({
        needsSearch,
        reason,
        complexity,
        via: "rule",
    });

    if (SMALL_TALK.test(text)) return decide(false, "small talk", "simple");
    if (ARITHMETIC.test(text)) return decide(false, "arithmetic", "simple");
    if (WANTS_SOURCES.test(text)) return decide(true, "the user asked for sources", "moderate");
    if (looksTimeSensitive(text)) {
        // A short single question is its own search string; longer or
        // comparing questions go through the planner to be split up.
        const single = text.length <= SIMPLE_QUESTION_MAX_CHARS && !/\b(and|vs\.?|versus|compare)\b/i.test(text);
        return decide(true, "asks about recent or changing information", single ? "simple" : "moderate");
    }
    if (text.includes("```")) return decide(false, "contains code", "moderate");
    if (STABLE_REQUEST.test(text)) return decide(false, "explanation or writing task", "moderate");
    return null;
}

/** Turn the router model's reply into a decision. Null when it is not usable. */
export function parseRouterReply(reply: string): RouteDecision | null {
    const json = extractJson(reply);
    if (!json || typeof json.needs_search !== "boolean") return null;
    const complexity = textField(json.complexity).toLowerCase();
    return {
        needsSearch: json.needs_search,
        reason: textField(json.reason).slice(0, 120) || "no reason given",
        complexity: complexity === "simple" || complexity === "complex" ? complexity : "moderate",
        via: "model",
    };
}

/**
 * Used when the router cannot run. Answering directly is the cheap choice,
 * and the answer model can still ask for a search if it needs one.
 */
const FALLBACK: RouteDecision = {
    needsSearch: false,
    reason: "router unavailable, answering directly",
    complexity: "moderate",
    via: "default",
};

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

export async function decideRoute(
    question: string,
    history: HistoryStore,
    routeCache: Cache<RouteDecision>,
    ctx: StageContext,
): Promise<RouteDecision> {
    const byRule = routeByRules(question);
    if (byRule) return byRule;

    // The same words can mean something else after a different question, so
    // the previous user message is part of the cache key.
    const previous = history.turns().filter((t) => t.role === "user").pop()?.content ?? "";
    const cacheKey = `${normalise(question)}|${normalise(previous).slice(0, 200)}`;
    const cached = routeCache.get(cacheKey);
    if (cached) return { ...cached, via: "cache" };

    if (!ctx.llm.budget.hasRoom(1)) return FALLBACK;

    const context = compactContext(history);
    try {
        const reply = await completeJsonStep("router", {
            model: ctx.config.routerModel(),
            system: routerPrompt(),
            messages: [
                {
                    role: "user",
                    content: `${context ? `Conversation so far:\n${context}\n\n` : ""}Question: ${question.slice(0, 1500)}`,
                },
            ],
            maxTokens: ctx.config.maxOutputTokens.router,
        }, ctx);
        const decision = parseRouterReply(reply);
        if (!decision) return FALLBACK;
        routeCache.set(cacheKey, decision, ctx.config.routerCacheTtlMs);
        return decision;
    } catch (error) {
        if (ctx.signal?.aborted) throw error;
        // A real problem (bad key, no credits) will show up on the answer call.
        return FALLBACK;
    }
}
