import { describe, expect, test } from "bun:test";
import { parseSphUsername, toMatrixLocalpart } from "../src/identity";

describe("parseSphUsername", () => {
  test("anonymous when no identity handoff", () => {
    const id = parseSphUsername("20240115123000-abc123");
    expect(id.kind).toBe("anonymous");
  });

  test("lehrer with shortcode", () => {
    const id = parseSphUsername("20240115123000-mueller.anna-L-MU-9f3a2b");
    expect(id).toEqual({
      kind: "lehrer",
      login: "mueller.anna",
      kuerzel: "MU",
      raw: "20240115123000-mueller.anna-L-MU-9f3a2b",
    });
  });

  test("schueler with class", () => {
    const id = parseSphUsername("20240115123000-schmidt.max-10a-10-deadbeef");
    expect(id).toEqual({
      kind: "schueler",
      login: "schmidt.max",
      klasse: "10a",
      stufe: "10",
      raw: "20240115123000-schmidt.max-10a-10-deadbeef",
    });
  });

  test("opaque single middle segment", () => {
    const id = parseSphUsername("20240115123000-onlylogin-uniq");
    expect(id.kind).toBe("opaque");
    if (id.kind === "opaque") expect(id.loginHint).toBe("onlylogin");
  });
});

describe("toMatrixLocalpart", () => {
  test("sanitizes teacher login", () => {
    const id = parseSphUsername("20240115123000-Mueller.Anna-L-MU-x");
    expect(toMatrixLocalpart(id, "matrix")).toBe("mueller.anna");
  });
});
