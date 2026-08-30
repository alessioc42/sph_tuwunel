import { describe, expect, test } from "bun:test";
import { mintJwt, verifyJwt } from "../src/jwt";

describe("jwt", () => {
  test("round-trip", () => {
    const { token, claims } = mintJwt("secret", "alice", 60);
    expect(claims.sub).toBe("alice");
    const verified = verifyJwt("secret", token);
    expect(verified.sub).toBe("alice");
  });

  test("rejects bad signature", () => {
    const { token } = mintJwt("secret", "alice", 60);
    expect(() => verifyJwt("other", token)).toThrow();
  });

  test("rejects expired", () => {
    const { token } = mintJwt("secret", "alice", -10);
    expect(() => verifyJwt("secret", token)).toThrow(/expired/);
  });
});
