import { timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./config";
import { md5Hex } from "./config";
import { parseSphUsername, toMatrixLocalpart } from "./identity";
import { mintJwt } from "./jwt";
import { loginWithJwt } from "./matrix";
import { FileStore, randomToken } from "./store";
import { isLanisMobile } from "./ua";

function md5Equal(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type ProtocolResult =
  | { kind: "text"; status: number; body: string }
  | { kind: "html"; status: number; body: string }
  | { kind: "json"; status: number; body: unknown }
  | { kind: "redirect"; status: number; location: string };

/**
 * SPH-compatible protocol (mirrors index.php steps 1–4), issuing Matrix JWTs
 * (Lanis-Mobile) or Cinny loginToken redirects (browsers).
 */
export class SphProtocol {
  constructor(
    private readonly cfg: AppConfig,
    private readonly store: FileStore,
  ) {}

  handleStep1(t: string): ProtocolResult {
    if (!t) return { kind: "text", status: 400, body: "missing t" };
    this.store.purgeOlderThan("sp_1_", this.cfg.connectTtlSeconds);
    this.store.purgeOlderThan("sp_2_", this.cfg.connectTtlSeconds);
    this.store.purgeOlderThan("lt_", this.cfg.connectTtlSeconds);

    const challenge = md5Hex(
      `${Date.now()}${randomToken(8)}${t}${randomToken(8)}`,
    );
    this.store.putStep1({ t, challenge, createdAt: Date.now() });
    return { kind: "text", status: 200, body: challenge };
  }

  handleAction(params: {
    a: string;
    t: string;
    s: string;
    n: string;
    u?: string;
  }): ProtocolResult {
    const { a, t, s, n, u } = params;
    if (!s) return { kind: "text", status: 200, body: "-1" };
    if (!t) return { kind: "text", status: 200, body: "-2" };
    if (!n) return { kind: "text", status: 200, body: "-3" };

    const step1 = this.store.takeStep1(t);
    if (!step1 || step1.t !== t) {
      return { kind: "text", status: 200, body: "-4" };
    }

    const expected = md5Hex(`${step1.challenge}${this.cfg.secret}`);
    if (!md5Equal(s, expected)) {
      return { kind: "text", status: 200, body: "-4" };
    }

    if (a === "login") {
      return this.login(n, u ?? "");
    }
    if (a === "status") {
      return this.status();
    }
    return { kind: "text", status: 400, body: "unknown action" };
  }

  private login(folderNameMd5: string, userPayload: string): ProtocolResult {
    const key = `${randomToken(8)}${md5Hex(folderNameMd5)}-${randomToken(16)}`;
    this.store.putStep2({
      key,
      folderNameMd5,
      userPayload: decodeUriSafe(userPayload),
      createdAt: Date.now(),
    });

    const url = `${this.cfg.publicBaseUrl}/?a=refresh&k=${encodeURIComponent(key)}`;
    return { kind: "text", status: 200, body: url };
  }

  private status(): ProtocolResult {
    const status = {
      Datenpfad: ["ok"],
      Ordner: [
        [
          this.cfg.folderName,
          `md5=${this.cfg.folderNameMd5}`,
          `Url: ${this.cfg.publicBaseUrl}/`,
          "mode=jwt-cinny-bridge",
          `cinny=${this.cfg.elementWebUrl}`,
        ],
      ],
    };
    return {
      kind: "text",
      status: 200,
      body: phpSerialize(status),
    };
  }

  async handleRefresh(
    k: string,
    userAgent: string | null,
  ): Promise<ProtocolResult> {
    if (!k) {
      return {
        kind: "html",
        status: 400,
        body: page("Fehlender Schlüssel", "<p>Bitte erneut im Schulportal starten.</p>"),
      };
    }

    const step2 = this.store.takeStep2(k);
    if (!step2) {
      return {
        kind: "html",
        status: 410,
        body: page(
          "Aufruf nur einmal gültig",
          "<p>Bitte starten Sie erneut im Schulportal!</p>",
        ),
      };
    }

    if (!md5Equal(step2.folderNameMd5, this.cfg.folderNameMd5)) {
      return {
        kind: "html",
        status: 400,
        body: page("Ungültig", "<p>Der Name ist nicht gültig!</p>"),
      };
    }

    const stamp = formatStamp(new Date());
    const uniq = randomToken(6);
    const authUser = step2.userPayload
      ? `${stamp}-${step2.userPayload}-${uniq}`
      : `${stamp}-${uniq}`;

    const identity = parseSphUsername(authUser);
    const localpart = toMatrixLocalpart(identity, this.cfg.folderName);

    const sphMeta: Record<string, string> = { raw: authUser, kind: identity.kind };
    if (identity.kind === "lehrer") {
      sphMeta.login = identity.login;
      sphMeta.kuerzel = identity.kuerzel;
    } else if (identity.kind === "schueler") {
      sphMeta.login = identity.login;
      sphMeta.klasse = identity.klasse;
      sphMeta.stufe = identity.stufe;
    } else if (identity.kind === "opaque") {
      sphMeta.login = identity.loginHint;
    }

    return this.completeAuth({ localpart, identity: sphMeta, userAgent });
  }

  async exchange(
    code: string,
    userAgent: string | null,
  ): Promise<ProtocolResult> {
    const rec = this.store.takeExchange(code);
    if (!rec) {
      return { kind: "json", status: 410, body: { error: "code_used_or_expired" } };
    }
    if (Date.now() - rec.createdAt > this.cfg.connectTtlSeconds * 1000) {
      return { kind: "json", status: 410, body: { error: "code_expired" } };
    }
    return this.completeAuth({
      localpart: rec.localpart,
      identity: rec.identity,
      userAgent,
    });
  }

  /**
   * Mint JWT; Lanis-Mobile gets JSON, browsers get Cinny loginToken redirect.
   * Also used when refresh skips the intermediate exchange HTML.
   */
  async completeAuth(opts: {
    localpart: string;
    identity: Record<string, string>;
    userAgent: string | null;
  }): Promise<ProtocolResult> {
    const { token, claims } = mintJwt(
      this.cfg.jwtSecret,
      opts.localpart,
      this.cfg.jwtTtlSeconds,
      { iss: this.cfg.publicBaseUrl, sph: opts.identity },
    );

    const jwtPayload = {
      token,
      access_token: token,
      token_type: "Bearer",
      expires_in: this.cfg.jwtTtlSeconds,
      localpart: opts.localpart,
      homeserver: this.cfg.publicBaseUrl,
      matrix_homeserver: this.cfg.matrixHomeserver,
      claims,
      identity: opts.identity,
      matrix_login: {
        type: "org.matrix.login.jwt",
        token,
      },
    };

    if (isLanisMobile(opts.userAgent)) {
      return { kind: "json", status: 200, body: jwtPayload };
    }

    // Browser → Cinny via m.login.token. Cinny reads window.location.search
    // and POSTs immediately — no prior SSO click / mx_sso_hs_url required.
    try {
      const session = await loginWithJwt(
        this.cfg.matrixHomeserver,
        token,
        "SPH Cinny",
      );
      const loginToken = randomToken(24);
      this.store.putLoginToken({
        token: loginToken,
        session,
        createdAt: Date.now(),
      });

      const location =
        `${this.cfg.elementWebUrl.replace(/\/$/, "")}/?loginToken=${encodeURIComponent(loginToken)}`;

      return { kind: "redirect", status: 302, location };
    } catch (e) {
      return {
        kind: "html",
        status: 502,
        body: page(
          "Matrix-Login fehlgeschlagen",
          `<p>${escapeHtml(String(e))}</p>
           <p>JWT wurde erzeugt, Cinny-Weiterleitung nicht möglich.</p>
           <pre style="word-break:break-all;font-size:.75rem">${escapeHtml(token.slice(0, 64))}…</pre>`,
        ),
      };
    }
  }

  /** Create a one-time exchange code (for tests / deferred completion). */
  putExchangeCode(localpart: string, identity: Record<string, string>): string {
    const code = randomToken(24);
    this.store.putExchange({
      code,
      localpart,
      identity,
      createdAt: Date.now(),
    });
    return code;
  }
}

function decodeUriSafe(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function formatStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** Minimal PHP serialize() for the status payload SPH may expect. */
export function phpSerialize(value: unknown): string {
  if (value === null) return "N;";
  if (typeof value === "string") {
    return `s:${Buffer.byteLength(value)}:"${value}";`;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) return `i:${value};`;
    return `d:${value};`;
  }
  if (typeof value === "boolean") return `b:${value ? 1 : 0};`;
  if (Array.isArray(value)) {
    let out = `a:${value.length}:{`;
    value.forEach((v, i) => {
      out += phpSerialize(i) + phpSerialize(v);
    });
    return out + "}";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    let out = `a:${entries.length}:{`;
    for (const [k, v] of entries) {
      out += phpSerialize(k) + phpSerialize(v);
    }
    return out + "}";
  }
  return "N;";
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; --bg:#f2efe8; --ink:#1c1917; --accent:#0f766e; }
  body { margin:0; font-family: "IBM Plex Sans", "Segoe UI", sans-serif; background:
    radial-gradient(1200px 600px at 10% -10%, #c7ddd8 0%, transparent 55%),
    radial-gradient(900px 500px at 100% 0%, #e8dcc8 0%, transparent 50%),
    var(--bg); color: var(--ink); min-height:100vh; display:grid; place-items:center; }
  main { width:min(520px, 92vw); padding:2rem; }
  h1 { font-family: "Fraunces", Georgia, serif; font-weight:600; font-size:1.75rem; margin:0 0 .75rem; }
  p { line-height:1.5; }
  a { color: var(--accent); }
</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
