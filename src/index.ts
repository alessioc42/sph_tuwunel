import { loadConfig, type AppConfig } from "./config";
import { clientIp, isAllowedIp } from "./ip";
import { verifyJwt } from "./jwt";
import { handleMatrixProxy, isAllowedOrigin } from "./proxy";
import { SphProtocol } from "./protocol";
import { FileStore } from "./store";

export type AppDeps = {
  config: AppConfig;
  protocol: SphProtocol;
  store: FileStore;
};

export function createApp(deps?: Partial<AppDeps>): {
  config: AppConfig;
  protocol: SphProtocol;
  store: FileStore;
  handler: (req: Request) => Promise<Response>;
} {
  const config = deps?.config ?? loadConfig();
  const store = deps?.store ?? new FileStore(config.dataDir);
  const protocol = deps?.protocol ?? new SphProtocol(config, store);

  function text(body: string, status = 200): Response {
    return new Response(body, {
      status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  function html(body: string, status = 200): Response {
    return new Response(body, {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  function fromResult(
    r: Awaited<ReturnType<SphProtocol["handleRefresh"]>>,
  ): Response {
    if (r.kind === "text") return text(r.body, r.status);
    if (r.kind === "html") return html(r.body, r.status);
    if (r.kind === "redirect") {
      return new Response(null, {
        status: r.status,
        headers: { location: r.location },
      });
    }
    return json(r.body, r.status);
  }

  function requireSphIp(req: Request): Response | null {
    const ip = clientIp(req);
    if (!isAllowedIp(ip, config.fromIps, config.allowAllIps)) {
      return text("Ungültiger Aufruf!", 403);
    }
    return null;
  }

  async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const q = url.searchParams;
    const ua = req.headers.get("user-agent");

    if (req.method === "OPTIONS") {
      const origin = req.headers.get("origin");
      if (origin && isAllowedOrigin(origin, config)) {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": origin,
            "access-control-allow-credentials": "true",
            "access-control-allow-headers":
              "Authorization, Content-Type, Accept",
            "access-control-allow-methods":
              "GET, POST, PUT, DELETE, OPTIONS",
          },
        });
      }
      return new Response(null, { status: 204 });
    }

    if (config.enableMatrixProxy && url.pathname.startsWith("/_matrix/")) {
      return handleMatrixProxy(req, config, store);
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        folder: config.folderName,
        folderMd5: config.folderNameMd5,
        elementWebUrl: config.elementWebUrl,
        matrixProxy: config.enableMatrixProxy,
      });
    }

    if (url.pathname === "/.well-known/matrix/client") {
      const base = config.enableMatrixProxy
        ? config.publicBaseUrl
        : config.matrixHomeserver;
      return json({
        "m.homeserver": { base_url: base },
      });
    }

    if (url.pathname === "/auth/exchange") {
      return fromResult(await protocol.exchange(q.get("code") ?? "", ua));
    }

    if (url.pathname === "/auth/me") {
      const auth = req.headers.get("authorization") ?? "";
      const m = /^Bearer\s+(.+)$/i.exec(auth);
      if (!m) return json({ error: "missing_bearer" }, 401);
      try {
        const claims = verifyJwt(config.jwtSecret, m[1]!);
        return json({ claims });
      } catch (e) {
        return json({ error: String(e) }, 401);
      }
    }

    if (url.pathname === "/app" || url.pathname === "/app/") {
      return html(appPage(config));
    }

    if (url.pathname === "/" || url.pathname === "/index.php") {
      const a = q.get("a");
      const t = q.get("t");
      const k = q.get("k");

      if (a === "refresh" && k) {
        return fromResult(await protocol.handleRefresh(k, ua));
      }

      if (t && !a) {
        const denied = requireSphIp(req);
        if (denied) return denied;
        return fromResult(protocol.handleStep1(t));
      }

      if (a && t) {
        const denied = requireSphIp(req);
        if (denied) return denied;
        return fromResult(
          protocol.handleAction({
            a,
            t,
            s: q.get("s") ?? "",
            n: q.get("n") ?? "",
            u: q.get("u") ?? undefined,
          }),
        );
      }

      return html(homePage(config));
    }

    return text("Not found", 404);
  }

  return { config, protocol, store, handler };
}

function homePage(c: AppConfig): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>SPH JWT Bridge</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1rem;line-height:1.5}
  code{background:#f4f4f5;padding:.1rem .35rem;border-radius:4px}
</style></head><body>
<h1>SPH → Matrix Bridge</h1>
<p>SPH-kompatible Gegenstelle. Tile-URL: <code>${escape(c.publicBaseUrl)}/</code></p>
<ul>
  <li>Folder: <code>${escape(c.folderName)}</code> (md5 <code>${escape(c.folderNameMd5)}</code>)</li>
  <li>Homeserver (tuwunel): <code>${escape(c.matrixHomeserver)}</code></li>
  <li>Element Web: <code>${escape(c.elementWebUrl)}</code></li>
  <li>Matrix proxy: <code>${c.enableMatrixProxy ? "on" : "off"}</code></li>
  <li>Lanis-Mobile UA → JWT JSON · Browser → Element <code>loginToken</code></li>
</ul>
<p><a href="/app">Demo</a> · <a href="/health">Health</a> · <a href="/.well-known/matrix/client">well-known</a></p>
</body></html>`;
}

function appPage(c: AppConfig): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Bridge demo</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}
  pre{background:#111;color:#e5e5e5;padding:1rem;border-radius:8px;overflow:auto;word-break:break-all}
</style></head><body>
<h1>Host demo</h1>
<p>Browser users are redirected to Element. Lanis-Mobile receives JWT JSON on the refresh URL.</p>
<p><a href="${escape(c.elementWebUrl)}">Open Element</a></p>
<pre id="out">${escape(JSON.stringify({
    element: c.elementWebUrl,
    homeserver_public: c.enableMatrixProxy ? c.publicBaseUrl : c.matrixHomeserver,
    lanis: 'User-Agent: … Lanis-Mobile … → JWT',
  }, null, 2))}</pre>
</body></html>`;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/** @deprecated use createApp().handler */
export function createHandler(opts?: {
  config?: AppConfig;
  protocol?: SphProtocol;
  store?: FileStore;
}) {
  return createApp({
    config: opts?.config,
    protocol: opts?.protocol,
    store: opts?.store,
  }).handler;
}

if (import.meta.main) {
  const { config, handler } = createApp();
  const server = Bun.serve({
    port: config.port,
    fetch: handler,
  });
  console.log(
    `SPH bridge on ${config.publicBaseUrl} (port ${server.port}) → Element ${config.elementWebUrl}, HS ${config.matrixHomeserver}`,
  );
}
