/**
 * Stage 3: understand the request and plan the searches.
 * One cheap call rewrites the question, spots real ambiguity and splits the
 * request into a few focused search strings.
 */
import type { HistoryStore } from "../../../core/history";
import { plannerPrompt } from "../prompts";
import type { RouteDecision, SearchPlan } from "../types";
import { compactContext, completeJsonStep, extractJson, textField, type StageContext } from "./shared";

/** A standalone question this short is already a good search string. */
const SKIP_PLANNER_MAX_CHARS = 120;
const MAX_QUERY_CHARS = 200;

/** The plan used when the planner is skipped or its reply cannot be read. */
function plainPlan(question: string): SearchPlan {
    return { intent: question, queries: [question.slice(0, MAX_QUERY_CHARS)] };
}

/** Turn the planner's reply into a plan, falling back to the question itself. */
export function parsePlan(reply: string, question: string, maxQueries: number): SearchPlan {
    const json = extractJson(reply);
    if (!json) return plainPlan(question);

    const queries = (Array.isArray(json.queries) ? json.queries : [])
        .map((q) => textField(q).slice(0, MAX_QUERY_CHARS))
        .filter(Boolean);
    const unique = [...new Set(queries.map((q) => q.toLowerCase()))]
        .map((lower) => queries.find((q) => q.toLowerCase() === lower)!)
        .slice(0, maxQueries);

    const intent = textField(json.intent) || question;
    const clarify = textField(json.clarify);
    const assumption = textField(json.assumption);
    return {
        intent,
        queries: unique.length ? unique : [intent.slice(0, MAX_QUERY_CHARS)],
        ...(clarify ? { clarify } : {}),
        ...(assumption ? { assumption } : {}),
    };
}

export async function planSearch(
    question: string,
    route: RouteDecision,
    history: HistoryStore,
    ctx: StageContext,
): Promise<SearchPlan> {
    // A short first question has nothing to resolve and nothing to split, so
    // the planner call would be money spent for the same search string.
    const standalone = history.turns().length === 0;
    if (route.complexity === "simple" && standalone && question.length <= SKIP_PLANNER_MAX_CHARS) {
        return plainPlan(question);
    }
    if (!ctx.llm.budget.hasRoomForOptional(1)) return plainPlan(question);

    const context = compactContext(history);
    try {
        const reply = await completeJsonStep("planner", {
            model: ctx.config.routerModel(),
            system: plannerPrompt(ctx.config.maxSubQueries),
            messages: [
                {
                    role: "user",
                    content: `${context ? `Conversation so far:\n${context}\n\n` : ""}Request: ${question.slice(0, 2000)}`,
                },
            ],
            maxTokens: ctx.config.maxOutputTokens.planner,
        }, ctx);
        return parsePlan(reply, question, ctx.config.maxSubQueries);
    } catch (error) {
        if (ctx.signal?.aborted) throw error;
        return plainPlan(question);
    }
}
