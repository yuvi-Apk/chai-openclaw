/**
 * The AI SDK prints warnings and stream errors straight to the console,
 * which breaks a live display. The front end shows errors itself, once and
 * in plain words, so that output is silenced here, in one place.
 */

let quietCalls = 0;
let originalConsoleError: typeof console.error | undefined;

/**
 * Run `fn` with console.error switched off. Calls can overlap (parallel
 * sub-agents), so the real console.error comes back only when the last one ends.
 */
export async function withQuietSdkErrors<T>(fn: () => Promise<T>): Promise<T> {
    if (quietCalls++ === 0) {
        originalConsoleError = console.error;
        console.error = () => undefined;
    }
    try {
        return await fn();
    } finally {
        if (--quietCalls === 0 && originalConsoleError) {
            console.error = originalConsoleError;
            originalConsoleError = undefined;
        }
    }
}

/** Stop the SDK from printing provider warnings. Errors are still thrown. */
export function silenceSdkWarnings(): void {
    (globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;
}
