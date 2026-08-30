import { createHash } from "node:crypto";
import type { AppConfig } from "../src/config";
import { md5Hex } from "../src/config";

/** Simulates the Schulportal server side of the handshake against a bridge URL. */
export class MockSphClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly folderName: string,
  ) {}

  private md5(s: string): string {
    return createHash("md5").update(s).digest("hex");
  }

  async step1(t: string, headers?: HeadersInit): Promise<string> {
    const res = await fetch(`${this.baseUrl}/?t=${encodeURIComponent(t)}`, {
      headers,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`step1 ${res.status}: ${body}`);
    return body.trim();
  }

  async login(
    t: string,
    challenge: string,
    userPayload?: string,
    headers?: HeadersInit,
  ): Promise<string> {
    const s = this.md5(`${challenge}${this.secret}`);
    const n = md5Hex(this.folderName);
    const u = userPayload ? `&u=${encodeURIComponent(userPayload)}` : "";
    const url =
      `${this.baseUrl}/?a=login&t=${encodeURIComponent(t)}` +
      `&s=${encodeURIComponent(s)}&n=${encodeURIComponent(n)}${u}`;
    const res = await fetch(url, { headers });
    const body = await res.text();
    if (!res.ok) throw new Error(`login ${res.status}: ${body}`);
    return body.trim();
  }
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    publicBaseUrl: "http://127.0.0.1:0",
    secret: "test-secret-aaaaaaaaaaaaaaaa",
    jwtSecret: "matrix-plug-e2e-local-hmac-secret-do-not-use-in-prod",
    jwtTtlSeconds: 600,
    loginTtlSeconds: 1800,
    connectTtlSeconds: 120,
    allowAllIps: false,
    fromIps: ["127.0.0.1", "::1", "::ffff:127.0.0.1"].map((s) => s.slice(0, 17)),
    folderName: "matrix",
    folderNameMd5: md5Hex("matrix"),
    matrixHomeserver: process.env.MATRIX_HOMESERVER ?? "http://127.0.0.1:8008",
    matrixServerName: "localhost",
    elementWebUrl: "http://127.0.0.1:8080",
    enableMatrixProxy: true,
    corsOrigins: [],
    dataDir: overrides.dataDir ?? "/tmp/sph-test-unused",
    ...overrides,
  };
}
