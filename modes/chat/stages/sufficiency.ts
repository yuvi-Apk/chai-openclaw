/**
 * Stage 5: a quick check of whether the search results can answer the
 * question, and if not, what one extra round should look for.
 */
import { sufficiencyPrompt } from "../prompts";
import type { Source } from "../types";
import { buildEvidenceBlock } from "./synthesizer";
import { completeJsonStep, extractJson, textField, type StageContext } from "./shared";

export interface SufficiencyVerdict {
    sufficient: boolean;
    /** The key fact that is missing, in a few words. */
    missing: string;
    /** Refined searches to run in the follow-up round. */
    queries: string[];
    /** Numbers of sources worth opening in full. */
    read: number[];
}

/** An unreadable reply counts as "enough", so a bad check never costs a search round. */
const ASSUME_ENOUGH: SufficiencyVerdict = { sufficient: true, missing: "", queries: [], read: [] };

export function parseSufficiency(
    reply: string,
    sourceCount: number,
    maxQueries: number,
    maxPages: number,
): SufficiencyVerdict {
    const json = extractJson(reply);
    if (!json || typeof json.sufficient !== "boolean") return ASSUME_ENOUGH;
    if (json.sufficient) return ASSUME_ENOUGH;

    const queries = (Array.isArray(json.queries) ? json.queries : [])
        .map((q) => textField(q).slice(0, 200))
        .filter(Boolean)
        .slice(0, maxQueries);
    const read = [...new Set((Array.isArray(json.read) ? json.read : []).map(Number))]
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= sourceCount)
        .slice(0, maxPages);

    return { sufficient: false, missing: textField(json.missing).slice(0, 200), queries, read };
}

export async function checkSufficiency(
    question: string,
    sources: Source[],
    ctx: StageContext,
): Promise<SufficiencyVerdict> {
    try {
        const reply = await completeJsonStep("sufficiency", {
            model: ctx.config.routerModel(),
            system: sufficiencyPrompt(ctx.config.maxSubQueries, ctx.config.maxPagesToRead),
            messages: [
                { role: "user", content: `Question: ${question}\n\nSearch results:\n${buildEvidenceBlock(sources)}` },
            ],
            maxTokens: ctx.config.maxOutputTokens.sufficiency,
        }, ctx);
        return parseSufficiency(
            reply,
            sources.length,
            ctx.config.maxSubQueries,
            ctx.config.maxPagesToRead,
        );
    } catch (error) {
        if (ctx.signal?.aborted) throw error;
        return ASSUME_ENOUGH;
    }
}
