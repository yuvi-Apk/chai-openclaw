/**
 * HistoryStore kept in memory. It holds the last few turns word for word and
 * a short summary of everything older, so the prompt stays small however
 * long the conversation gets.
 */
import type { HistoryStore } from "../interfaces";
import type { ChatTurn } from "../types";

export class MemoryHistory implements HistoryStore {
    private recent: ChatTurn[] = [];
    private older = "";

    /** @param keepTurns question-and-answer pairs kept word for word */
    constructor(private readonly keepTurns: number) {}

    turns(): ChatTurn[] {
        return [...this.recent];
    }

    summary(): string {
        return this.older;
    }

    setSummary(summary: string): void {
        this.older = summary.trim();
    }

    append(turn: ChatTurn): void {
        this.recent.push(turn);
    }

    takeOverflow(): ChatTurn[] {
        const keep = this.keepTurns * 2; // one turn = a question and its answer
        if (this.recent.length <= keep) return [];
        return this.recent.splice(0, this.recent.length - keep);
    }

    clear(): void {
        this.recent = [];
        this.older = "";
    }
}
