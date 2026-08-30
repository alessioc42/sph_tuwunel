import { createHmac } from "node:crypto";

function b64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export type JwtClaims = {
  sub: string;
  iat: number;
  exp: number;
  iss?: string;
  sph?: Record<string, string>;
};

/** HS256 JWT compatible with tuwunel [global.jwt] / matrix_plug (sub = localpart). */
export function mintJwt(
  secret: string,
  sub: string,
  ttlSeconds: number,
  extra?: { iss?: string; sph?: Record<string, string> },
): { token: string; claims: JwtClaims } {
  const now = Math.floor(Date.now() / 1000);
  const claims: JwtClaims = {
    sub,
    iat: now,
    exp: now + ttlSeconds,
    ...(extra?.iss ? { iss: extra.iss } : {}),
    ...(extra?.sph ? { sph: extra.sph } : {}),
  };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const sig = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest();
  return { token: `${header}.${payload}.${b64url(sig)}`, claims };
}

export function verifyJwt(secret: string, token: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed jwt");
  const [header, payload, sig] = parts as [string, string, string];
  const expected = b64url(
    createHmac("sha256", secret).update(`${header}.${payload}`).digest(),
  );
  if (!timingSafeEqual(sig, expected)) throw new Error("bad signature");
  const claims = JSON.parse(
    Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    ),
  ) as JwtClaims;
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now) {
    throw new Error("expired");
  }
  if (typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("missing sub");
  }
  return claims;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
