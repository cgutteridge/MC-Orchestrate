import { describe, expect, it } from "vitest";
import { DesiredSizeSchema } from "./schema.js";

describe("DesiredSizeSchema", () => {
  it("accepts quoted positive integers", () => {
    expect(
      DesiredSizeSchema.parse({
        width: "9",
        depth: "21",
        height: "16",
      }),
    ).toEqual({
      width: 9,
      depth: 21,
      height: 16,
    });
  });

  it("rejects non-integer strings", () => {
    expect(() =>
      DesiredSizeSchema.parse({
        width: "9.5",
        depth: "21",
        height: "16",
      }),
    ).toThrow();
  });

  it("rejects zero and negative-looking strings", () => {
    expect(() =>
      DesiredSizeSchema.parse({
        width: "0",
        depth: "-2",
        height: "16",
      }),
    ).toThrow();
  });
});
