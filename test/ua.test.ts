import { describe, expect, test } from "bun:test";
import { isLanisMobile } from "../src/ua";

describe("isLanisMobile", () => {
  test("substring match", () => {
    expect(isLanisMobile("Foo Lanis-Mobile Bar")).toBe(true);
    expect(isLanisMobile("lanis-mobile")).toBe(false);
  });
});
