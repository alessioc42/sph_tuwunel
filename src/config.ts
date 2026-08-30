import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type AppConfig = {
  port: number;
  publicBaseUrl: string;
  secret: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
  loginTtlSeconds: number;
  connectTtlSeconds: number;
  allowAllIps: boolean;
  fromIps: string[];
  folderName: string;
  folderNameMd5: string;
  matrixHomeserver: string;
  /** Public Matrix server_name (MXID domain), e.g. localhost or matrix.schule.de */
  matrixServerName: string;
  /** Element Web base URL (no trailing slash). Browser users are sent here. */
  elementWebUrl: string;
  /** When true, proxy /_matrix/* to matrixHomeserver (needed for Element loginToken). */
  enableMatrixProxy: boolean;
  corsOrigins: string[];
  dataDir: string;
};

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env ${name}`);
  }
  return v;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function loadIps(path: string): string[] {
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

/** Mirror PHP substr($ip, 0, 17) allowlist matching. */
export function normalizeIpPrefix(ip: string): string {
  return ip.trim().slice(0, 17);
}

export function md5Hex(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = resolve(process.env.DATA_DIR ?? "./data");
  const folderName = process.env.FOLDER_NAME ?? "matrix";
  const ipFile =
    process.env.SERVER_IPS_FILE ??
    (() => {
      const primary = resolve(dataDir, "ServerIPs.txt");
      try {
        readFileSync(primary);
        return primary;
      } catch {
        return resolve("deploy/ServerIPs.txt");
      }
    })();
  const fromFile = loadIps(ipFile);
  const fromEnv = (process.env.SPH_FROM_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fromIps = [...new Set([...fromFile, ...fromEnv].map(normalizeIpPrefix))];
  const matrixHomeserver =
    process.env.MATRIX_HOMESERVER ?? "http://127.0.0.1:8008";
  let matrixServerName = process.env.MATRIX_SERVER_NAME ?? "";
  if (!matrixServerName) {
    try {
      matrixServerName = new URL(matrixHomeserver).hostname;
    } catch {
      matrixServerName = "localhost";
    }
  }

  const cfg: AppConfig = {
    port: Number(process.env.PORT ?? 3000),
    publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3000").replace(
      /\/$/,
      "",
    ),
    secret: env("SPH_SECRET", "change-me-to-a-long-random-secret"),
    jwtSecret: env(
      "JWT_SECRET",
      "matrix-plug-e2e-local-hmac-secret-do-not-use-in-prod",
    ),
    jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 3600),
    loginTtlSeconds: Number(process.env.LOGIN_TTL_SECONDS ?? 1800),
    connectTtlSeconds: Number(process.env.CONNECT_TTL_SECONDS ?? 30),
    allowAllIps: envBool("ALLOW_ALL_IPS", false),
    fromIps,
    folderName,
    folderNameMd5: md5Hex(folderName),
    matrixHomeserver,
    matrixServerName,
    elementWebUrl: (process.env.ELEMENT_WEB_URL ?? "http://127.0.0.1:8080").replace(
      /\/$/,
      "",
    ),
    enableMatrixProxy: envBool("ENABLE_MATRIX_PROXY", true),
    corsOrigins: (process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    dataDir,
    ...overrides,
  };

  if (!cfg.secret || cfg.secret.includes("change-me")) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SPH_SECRET must be set to a strong value in production");
    }
  }

  return cfg;
}
