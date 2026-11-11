/**
 * URL safety for anything fetched from the open web: only http and https,
 * and never this machine or a private network.
 */
import net from "node:net";
import { lookup } from "node:dns/promises";

/** True for addresses that point at this machine or a private network. */
export function isPrivateHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host) return true;
    if (host === "localhost" || /\.(localhost|local|internal|lan|home)$/.test(host)) return true;
    if (net.isIPv4(host)) {
        const [a = 0, b = 0] = host.split(".").map(Number);
        return (
            a === 0 || a === 10 || a === 127 ||
            (a === 169 && b === 254) ||          // link-local, cloud metadata
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
            a >= 224                              // multicast and reserved
        );
    }
    if (net.isIPv6(host)) {
        return (
            host === "::" || host === "::1" ||
            host.startsWith("fc") || host.startsWith("fd") || // unique local
            host.startsWith("fe80") ||                         // link-local
            host.startsWith("::ffff:")                         // IPv4 written as IPv6
        );
    }
    return false;
}

/** Why a URL must not be fetched, or null when it looks safe. No network access. */
export function unsafeUrlReason(rawUrl: string): string | null {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return "not a valid URL";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return "only http and https are allowed";
    if (url.username || url.password) return "URLs with a login are not allowed";
    if (isPrivateHost(url.hostname)) return "local and private addresses are blocked";
    return null;
}

/**
 * Full check before a fetch: the URL itself, then the address its name
 * resolves to (a public-looking name can still point at a private address).
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
    const reason = unsafeUrlReason(rawUrl);
    if (reason) throw new Error(`Blocked URL (${reason}): ${rawUrl}`);
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!net.isIP(host)) {
        const addresses = await lookup(host, { all: true });
        if (addresses.some((a) => isPrivateHost(a.address))) {
            throw new Error(`Blocked URL (resolves to a private address): ${rawUrl}`);
        }
    }
    return url;
}
