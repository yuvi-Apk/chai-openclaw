/** Hiding secrets and personal data before text is shown, logged or passed on. */

const SECRET_PATTERNS: RegExp[] = [
    /\b(sk|pk|rk|tvly|ghp|gho|xox[abp])-[A-Za-z0-9_-]{16,}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
    /\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"']{8,}/gi,
    /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, // email addresses
];

/**
 * Hide API keys, tokens and email addresses.
 * @param knownSecrets exact values to hide, e.g. the keys from the settings
 */
export function redactSecrets(text: string, knownSecrets: string[] = []): string {
    let out = text;
    for (const secret of knownSecrets) {
        if (secret) out = out.split(secret).join("[redacted]");
    }
    for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
    return out;
}

/** A copy of an environment without the named variables, for programs we start. */
export function scrubEnv(
    env: Record<string, string | undefined>,
    names: readonly string[],
): Record<string, string | undefined> {
    const copy = { ...env };
    for (const name of names) delete copy[name];
    return copy;
}
