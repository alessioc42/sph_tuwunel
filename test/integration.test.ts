import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { md5Hex } from "../src/config";
import {
  createApp,
  disableIdleTimeoutForLongPoll,
} from "../src/index";
import { SphProtocol, phpSerialize } from "../src/protocol";
import { FileStore } from "../src/store";
import { isLanisMobile } from "../src/ua";
import { MockSphClient, testConfig } from "./helpers";

const dirs: string[] = [];

function setup(overrides: Parameters<typeof testConfig>[0] = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "sph-bridge-"));
  dirs.push(dataDir);
  const cfg = testConfig({ dataDir, publicBaseUrl: "http://127.0.0.1", ...overrides });
  const store = new FileStore(dataDir);
  const protocol = new SphProtocol(cfg, store);
  return { cfg, store, protocol, dataDir };
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe("ua", () => {
  test("detects Lanis-Mobile", () => {
    expect(isLanisMobile("Lanis-Mobile/1.2.3")).toBe(true);
    expect(isLanisMobile("Mozilla/5.0 Lanis-Mobile")).toBe(true);
    expect(isLanisMobile("Mozilla/5.0 Chrome/120")).toBe(false);
  });
});

describe("protocol unit", () => {
  test("Lanis-Mobile refresh returns JWT JSON", async () => {
    const { cfg, protocol } = setup({
      // Avoid live HS for mobile path
      matrixHomeserver: "http://127.0.0.1:1",
    });
    const t = "tok-1";
    const challenge = (protocol.handleStep1(t) as { body: string }).body;
    const s = md5Hex(`${challenge}${cfg.secret}`);
    const login = protocol.handleAction({
      a: "login",
      t,
      s,
      n: cfg.folderNameMd5,
      u: "mueller.anna-L-MU",
    }) as { body: string };
    const k = new URL(login.body).searchParams.get("k")!;
    const refresh = await protocol.handleRefresh(k, "Lanis-Mobile/9.0");
    expect(refresh.kind).toBe("json");
    if (refresh.kind !== "json") return;
    const body = refresh.body as { localpart: string; token: string };
    expect(body.localpart).toBe("mueller.anna");
    expect(body.token.split(".")).toHaveLength(3);
  });

  test("rejects wrong secret", () => {
    const { protocol } = setup();
    const t = "tok-2";
    protocol.handleStep1(t);
    const bad = protocol.handleAction({
      a: "login",
      t,
      s: "0".repeat(32),
      n: md5Hex("matrix"),
    });
    expect(bad.kind).toBe("text");
    if (bad.kind === "text") expect(bad.body).toBe("-4");
  });

  test("refresh is single-use", async () => {
    const { cfg, protocol } = setup({
      matrixHomeserver: "http://127.0.0.1:1",
    });
    const t = "tok-3";
    const challenge = (protocol.handleStep1(t) as { body: string }).body;
    const s = md5Hex(`${challenge}${cfg.secret}`);
    const login = protocol.handleAction({
      a: "login",
      t,
      s,
      n: cfg.folderNameMd5,
    }) as { body: string };
    const k = new URL(login.body).searchParams.get("k")!;
    expect((await protocol.handleRefresh(k, "Lanis-Mobile")).status).toBe(200);
    expect((await protocol.handleRefresh(k, "Lanis-Mobile")).status).toBe(410);
  });

  test("phpSerialize basics", () => {
    const s = phpSerialize({ a: 1, b: ["x"] });
    expect(s.startsWith("a:2:")).toBe(true);
    expect(s).toContain('s:1:"a";');
  });
});

describe("http integration", () => {
  test("m.login.token response includes CORS for Cinny origin", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sph-cors-"));
    dirs.push(dataDir);
    const config = testConfig({
      dataDir,
      publicBaseUrl: "https://auth.example.test",
      elementWebUrl: "https://chat.example.test",
      enableMatrixProxy: true,
      connectTtlSeconds: 60,
    });
    const store = new FileStore(dataDir);
    store.putLoginToken({
      token: "tok-cors-1",
      session: {
        user_id: "@alice:example.test",
        access_token: "syt_test_token",
        device_id: "DEVICE",
        home_server: "example.test",
      },
      createdAt: Date.now(),
    });
    const { handler } = createApp({ config, store });
    const res = await handler(
      new Request("https://auth.example.test/_matrix/client/v3/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://chat.example.test",
        },
        body: JSON.stringify({ type: "m.login.token", token: "tok-cors-1" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://chat.example.test",
    );
    const body = (await res.json()) as { user_id: string };
    expect(body.user_id).toBe("@alice:example.test");
  });

  test("disableIdleTimeoutForLongPoll only for /_matrix/", () => {
    const calls: Array<[Request, number]> = [];
    const server = {
      timeout(request: Request, seconds: number) {
        calls.push([request, seconds]);
      },
    };
    const sync = new Request("https://auth.test/_matrix/client/v3/sync?timeout=30000");
    disableIdleTimeoutForLongPoll(sync, server);
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toBe(0);

    calls.length = 0;
    disableIdleTimeoutForLongPoll(new Request("https://auth.test/health"), server);
    expect(calls).toHaveLength(0);
  });

  test("long-poll /sync survives Bun idleTimeout", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sph-sync-"));
    dirs.push(dataDir);

    const mockHs = Bun.serve({
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path.endsWith("/sync")) {
          await Bun.sleep(2000);
          return Response.json({ next_batch: "s1" });
        }
        return new Response("no", { status: 404 });
      },
    });

    const config = testConfig({
      dataDir,
      publicBaseUrl: "http://127.0.0.1",
      elementWebUrl: "https://chat.example.test",
      enableMatrixProxy: true,
      matrixHomeserver: `http://127.0.0.1:${mockHs.port}`,
    });
    const { handler } = createApp({ config });
    const bridge = Bun.serve({
      port: 0,
      idleTimeout: 1,
      fetch(req, srv) {
        disableIdleTimeoutForLongPoll(req, srv);
        return handler(req);
      },
    });

    try {
      const started = Date.now();
      const res = await fetch(
        `http://127.0.0.1:${bridge.port}/_matrix/client/v3/sync?timeout=30000`,
        { headers: { origin: "https://chat.example.test" } },
      );
      expect(res.status).toBe(200);
      expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
      const body = (await res.json()) as { next_batch: string };
      expect(body.next_batch).toBe("s1");
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "https://chat.example.test",
      );
    } finally {
      bridge.stop(true);
      mockHs.stop(true);
    }
  });

  test("Lanis-Mobile full flow + browser Cinny redirect against live tuwunel", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sph-http-"));
    dirs.push(dataDir);

    const config = testConfig({
      dataDir,
      publicBaseUrl: "http://127.0.0.1",
      elementWebUrl: "http://127.0.0.1:8080",
      enableMatrixProxy: true,
    });

    // Skip if homeserver down
    let hsOk = false;
    try {
      const v = await fetch(`${config.matrixHomeserver}/_matrix/client/versions`);
      hsOk = v.ok;
    } catch {
      hsOk = false;
    }
    if (!hsOk) {
      console.warn("skip live tuwunel tests — homeserver unreachable");
      return;
    }

    const { handler, store } = createApp({ config });
    const server = Bun.serve({ port: 0, fetch: handler });
    config.publicBaseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const sph = new MockSphClient(
        config.publicBaseUrl,
        config.secret,
        config.folderName,
      );
      const headers = { "x-forwarded-for": "127.0.0.1" };

      // Mobile path
      {
        const t = `m-${Date.now()}`;
        const challenge = await sph.step1(t, headers);
        const refreshUrl = await sph.login(
          t,
          challenge,
          "schmidt.max-10a-10",
          headers,
        );
        const refreshRes = await fetch(refreshUrl, {
          headers: { "user-agent": "Lanis-Mobile/2.0 (Android)" },
          redirect: "manual",
        });
        expect(refreshRes.status).toBe(200);
        const body = (await refreshRes.json()) as {
          localpart: string;
          token: string;
          matrix_login: { type: string };
        };
        expect(body.localpart).toBe("schmidt.max");
        expect(body.matrix_login.type).toBe("org.matrix.login.jwt");
      }

      // Browser path → Cinny redirect + loginToken redeem via proxy
      {
        const t = `b-${Date.now()}`;
        const challenge = await sph.step1(t, headers);
        const refreshUrl = await sph.login(
          t,
          challenge,
          "lehrer.test-L-LT",
          headers,
        );
        const refreshRes = await fetch(refreshUrl, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0 Safari/537.36",
          },
          redirect: "manual",
        });
        expect(refreshRes.status).toBe(302);
        const loc = refreshRes.headers.get("location")!;
        expect(loc.startsWith("http://127.0.0.1:8080/?loginToken=")).toBe(
          true,
        );
        const lt = new URL(loc).searchParams.get("loginToken");
        expect(lt).toBeTruthy();

        const elementOrigin = "http://127.0.0.1:8080";
        const loginRes = await fetch(
          `${config.publicBaseUrl}/_matrix/client/v3/login`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: elementOrigin,
            },
            body: JSON.stringify({ type: "m.login.token", token: lt }),
          },
        );
        expect(loginRes.status).toBe(200);
        expect(loginRes.headers.get("access-control-allow-origin")).toBe(
          elementOrigin,
        );
        const session = (await loginRes.json()) as {
          user_id: string;
          access_token: string;
        };
        expect(session.user_id).toBe("@lehrer.test:localhost");
        expect(session.access_token.length).toBeGreaterThan(10);

        // Same token remains valid until CONNECT_TTL (Cinny may retry).
        const again = await fetch(
          `${config.publicBaseUrl}/_matrix/client/v3/login`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: elementOrigin,
            },
            body: JSON.stringify({ type: "m.login.token", token: lt }),
          },
        );
        expect(again.status).toBe(200);
        expect(again.headers.get("access-control-allow-origin")).toBe(
          elementOrigin,
        );

        void store;
      }

      const denied = await fetch(`${config.publicBaseUrl}/?t=evil`, {
        headers: { "x-forwarded-for": "8.8.8.8" },
      });
      expect(denied.status).toBe(403);
    } finally {
      server.stop(true);
    }
  });
});
