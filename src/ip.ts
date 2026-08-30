import { normalizeIpPrefix } from "./config";

export function clientIp(req: Request, trustProxy = true): string {
  if (trustProxy) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
  }
  // Bun.serve does not expose socket remoteAddress on Request; tests inject headers.
  return "127.0.0.1";
}

export function isAllowedIp(
  ip: string,
  allowlist: string[],
  allowAll: boolean,
): boolean {
  if (allowAll) return true;
  const prefix = normalizeIpPrefix(ip);
  return allowlist.includes(prefix);
}
