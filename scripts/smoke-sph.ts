#!/usr/bin/env bun
/**
 * End-to-end smoke against a running bridge.
 * Usage: bun run scripts/smoke-sph.ts http://127.0.0.1:13000
 */
import { createHash } from "node:crypto";

const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const secret = process.env.SPH_SECRET ?? "test-secret-aaaaaaaaaaaaaaaa";
const folder = process.env.FOLDER_NAME ?? "matrix";

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

async function sphLogin(userPayload: string): Promise<string> {
  const headers = { "x-forwarded-for": "127.0.0.1" };
  const t = `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const challengeRes = await fetch(`${base}/?t=${encodeURIComponent(t)}`, {
    headers,
  });
  const challenge = (await challengeRes.text()).trim();
  if (!challengeRes.ok || challenge.length !== 32) {
    throw new Error(`step1 failed ${challengeRes.status} ${challenge}`);
  }
  const s = md5(`${challenge}${secret}`);
  const n = md5(folder);
  const loginRes = await fetch(
    `${base}/?a=login&t=${encodeURIComponent(t)}&s=${s}&n=${n}&u=${encodeURIComponent(userPayload)}`,
    { headers },
  );
  const refreshUrl = (await loginRes.text()).trim();
  if (!loginRes.ok || !refreshUrl.includes("refresh")) {
    throw new Error(`login failed ${loginRes.status} ${refreshUrl}`);
  }
  return refreshUrl;
}

// Mobile
{
  const refreshUrl = await sphLogin("smoke.user-L-SM");
  const res = await fetch(refreshUrl, {
    headers: { "user-agent": "Lanis-Mobile/1.0" },
    redirect: "manual",
  });
  const body = (await res.json()) as { localpart?: string; token?: string };
  if (!res.ok || body.localpart !== "smoke.user" || !body.token) {
    console.error("mobile failed", res.status, body);
    process.exit(1);
  }
  console.log(JSON.stringify({ mobile: { ok: true, localpart: body.localpart } }));
}

// Browser (needs live homeserver)
{
  const refreshUrl = await sphLogin("browser.user-L-BU");
  const res = await fetch(refreshUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
    },
    redirect: "manual",
  });
  if (res.status !== 302) {
    console.error("browser expected 302", res.status, await res.text());
    process.exit(1);
  }
  const loc = res.headers.get("location") ?? "";
  let loginToken: string | null = null;
  try {
    loginToken = new URL(loc).searchParams.get("loginToken");
  } catch {
    loginToken = null;
  }
  if (!loginToken) {
    console.error("no loginToken in", loc);
    process.exit(1);
  }

  const loginRes = await fetch(`${base}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "m.login.token", token: loginToken }),
  });
  const session = (await loginRes.json()) as { user_id?: string };
  if (!loginRes.ok || !session.user_id?.includes("browser.user")) {
    console.error("loginToken redeem failed", loginRes.status, session);
    process.exit(1);
  }
  console.log(JSON.stringify({ browser: { ok: true, user_id: session.user_id, redirect: loc.split("?")[0] } }));
}
