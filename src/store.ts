import { mkdirSync, readdirSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { MatrixLoginResult } from "./matrix";

export type Step1Record = { t: string; challenge: string; createdAt: number };
export type Step2Record = {
  key: string;
  folderNameMd5: string;
  userPayload: string;
  createdAt: number;
};
export type ExchangeRecord = {
  code: string;
  localpart: string;
  identity: Record<string, string>;
  createdAt: number;
};
export type LoginTokenRecord = {
  token: string;
  session: MatrixLoginResult;
  createdAt: number;
};

export class FileStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(name: string): string {
    return join(this.dir, name);
  }

  purgeOlderThan(prefix: string, maxAgeSeconds: number): number {
    const now = Date.now();
    let n = 0;
    for (const name of readdirSync(this.dir)) {
      if (!name.startsWith(prefix)) continue;
      const full = this.path(name);
      try {
        const raw = readFileSync(full, "utf8");
        const obj = JSON.parse(raw) as { createdAt: number };
        if (now - obj.createdAt > maxAgeSeconds * 1000) {
          unlinkSync(full);
          n++;
        }
      } catch {
        try {
          unlinkSync(full);
          n++;
        } catch {
          /* ignore */
        }
      }
    }
    return n;
  }

  putStep1(rec: Step1Record): void {
    writeFileSync(this.path(`sp_1_${safe(rec.t)}.json`), JSON.stringify(rec));
  }

  takeStep1(t: string): Step1Record | null {
    return this.takeJson(`sp_1_${safe(t)}.json`);
  }

  putStep2(rec: Step2Record): void {
    writeFileSync(this.path(`sp_2_${safe(rec.key)}.json`), JSON.stringify(rec));
  }

  takeStep2(key: string): Step2Record | null {
    return this.takeJson(`sp_2_${safe(key)}.json`);
  }

  putExchange(rec: ExchangeRecord): void {
    writeFileSync(this.path(`ex_${safe(rec.code)}.json`), JSON.stringify(rec));
  }

  takeExchange(code: string): ExchangeRecord | null {
    return this.takeJson(`ex_${safe(code)}.json`);
  }

  putLoginToken(rec: LoginTokenRecord): void {
    writeFileSync(this.path(`lt_${safe(rec.token)}.json`), JSON.stringify(rec));
  }

  /** Peek without consuming (Element may retry). */
  getLoginToken(token: string): LoginTokenRecord | null {
    try {
      return JSON.parse(
        readFileSync(this.path(`lt_${safe(token)}.json`), "utf8"),
      ) as LoginTokenRecord;
    } catch {
      return null;
    }
  }

  takeLoginToken(token: string): LoginTokenRecord | null {
    return this.takeJson(`lt_${safe(token)}.json`);
  }

  private takeJson<T>(filename: string): T | null {
    const p = this.path(filename);
    try {
      const rec = JSON.parse(readFileSync(p, "utf8")) as T;
      unlinkSync(p);
      return rec;
    } catch {
      return null;
    }
  }
}

function safe(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!cleaned) throw new Error("invalid id");
  return cleaned;
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}
