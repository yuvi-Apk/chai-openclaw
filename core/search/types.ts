/** Web search and page reading, behind interfaces so the engine can be swapped. */

/** One search result, in the shape every search provider must return. */
export interface Source {
    title: string;
    url: string;
    snippet: string;
    /** ISO date (YYYY-MM-DD) when the provider knows it. */
    date?: string;
}

export interface SearchProvider {
    readonly name: string;
    search(query: string, limit: number, signal?: AbortSignal): Promise<Source[]>;
}

export interface PageFetcher {
    /** The readable text of a web page, already cut to a safe length. */
    fetchText(url: string, signal?: AbortSignal): Promise<string>;
}
