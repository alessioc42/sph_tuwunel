import type { AppConfig } from "./config";
import type { FileStore } from "./store";

/**
 * Reverse-proxy Matrix Client-Server API to tuwunel, intercepting
 * `m.login.token` so Cinny can finish the SPH handoff.
 *
 * Cinny (CHAT_HOST) and the bridge (PUBLIC_BASE_URL) are different
 * origins — every Matrix response must carry CORS, including the
 * loginToken intercept path.
 */
export async function handleMatrixProxy(
  req: Request,
  cfg: AppConfig,
  store: FileStore,
): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/_matrix/")) {
    return new Response("Not a matrix path", { status: 404 });
  }

  if (
    req.method === "POST" &&
    /\/_matrix\/client\/(?:r0|v3)\/login$/.test(url.pathname)
  ) {
    const raw = await req.text();
    let body: { type?: string; token?: string } = {};
    try {
      body = JSON.parse(raw) as { type?: string; token?: string };
    } catch {
      return matrixJson(req, cfg, { errcode: "M_BAD_JSON", error: "Bad JSON" }, 400);
    }

    if (body.type === "m.login.token" && body.token) {
      const rec = store.getLoginToken(body.token);
      if (!rec) {
        return matrixJson(
          req,
          cfg,
          { errcode: "M_FORBIDDEN", error: "Invalid login token" },
          403,
        );
      }
      if (Date.now() - rec.createdAt > cfg.connectTtlSeconds * 1000) {
        store.takeLoginToken(body.token);
        return matrixJson(
          req,
          cfg,
          { errcode: "M_FORBIDDEN", error: "Login token expired" },
          403,
        );
      }
      // Keep until TTL so Cinny retries (Strict Mode / flaky net) still work.
      return matrixJson(req, cfg, {
        user_id: rec.session.user_id,
        access_token: rec.session.access_token,
        device_id: rec.session.device_id,
        home_server: rec.session.home_server ?? cfg.matrixServerName,
      });
    }

    // Other login types (incl. JWT) go to the real homeserver.
    return proxyToHomeserver(req, cfg, raw);
  }

  return proxyToHomeserver(req, cfg);
}

async function proxyToHomeserver(
  req: Request,
  cfg: AppConfig,
  bodyText?: string,
): Promise<Response> {
  const incoming = new URL(req.url);
  const target = new URL(cfg.matrixHomeserver.replace(/\/$/, ""));
  const dest = `${target.origin}${incoming.pathname}${incoming.search}`;

  const headers = new Headers();
  const pass = [
    "authorization",
    "content-type",
    "accept",
    "user-agent",
    "x-requested-with",
  ];
  for (const h of pass) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (bodyText !== undefined) {
    init.body = bodyText;
  } else if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(dest, init);
  const outHeaders = corsHeaders(req, cfg);
  const ct = upstream.headers.get("content-type");
  if (ct) outHeaders.set("content-type", ct);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

/** CORS headers for Cinny ↔ bridge cross-origin Matrix calls. */
export function corsHeaders(req: Request, cfg: AppConfig): Headers {
  const out = new Headers();
  const origin = req.headers.get("origin");
  if (origin && isAllowedOrigin(origin, cfg)) {
    out.set("access-control-allow-origin", origin);
    out.set("access-control-allow-credentials", "true");
    out.set(
      "access-control-allow-headers",
      "Authorization, Content-Type, Accept",
    );
    out.set(
      "access-control-allow-methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    out.set("vary", "Origin");
  }
  return out;
}

function matrixJson(
  req: Request,
  cfg: AppConfig,
  body: unknown,
  status = 200,
): Response {
  const headers = corsHeaders(req, cfg);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

export function isAllowedOrigin(origin: string, cfg: AppConfig): boolean {
  try {
    const o = new URL(origin);
    const element = cfg.elementWebUrl ? new URL(cfg.elementWebUrl) : null;
    const pub = new URL(cfg.publicBaseUrl);
    if (o.origin === pub.origin) return true;
    if (element && o.origin === element.origin) return true;
    return cfg.corsOrigins.includes(o.origin);
  } catch {
    return false;
  }
}

