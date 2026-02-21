import { describe, expect, it } from "vitest";
import { asErrorDetails, parseQueryNumber } from "./vite-office-plugin";

// ---------------------------------------------------------------------------
// asErrorDetails
// ---------------------------------------------------------------------------
describe("asErrorDetails", () => {
  it("returns error.message for Error instances", () => {
    const err = new Error("something went wrong");
    expect(asErrorDetails(err)).toBe("something went wrong");
  });

  it("returns the string directly for string errors", () => {
    expect(asErrorDetails("timeout")).toBe("timeout");
  });

  it("returns undefined for non-Error, non-string values", () => {
    expect(asErrorDetails(42)).toBeUndefined();
    expect(asErrorDetails(null)).toBeUndefined();
    expect(asErrorDetails(undefined)).toBeUndefined();
    expect(asErrorDetails({ message: "obj" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseQueryNumber
// ---------------------------------------------------------------------------
describe("parseQueryNumber", () => {
  it("returns undefined for null", () => {
    expect(parseQueryNumber(null)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseQueryNumber("")).toBeUndefined();
  });

  it("returns undefined for non-numeric strings", () => {
    expect(parseQueryNumber("abc")).toBeUndefined();
    expect(parseQueryNumber("NaN")).toBeUndefined();
    expect(parseQueryNumber("Infinity")).toBeUndefined();
  });

  it("returns floored integer for numeric strings", () => {
    expect(parseQueryNumber("5")).toBe(5);
    expect(parseQueryNumber("3.7")).toBe(3);
    expect(parseQueryNumber("100")).toBe(100);
  });

  it("returns floored value for negative numbers", () => {
    expect(parseQueryNumber("-2.9")).toBe(-3);
  });

  it("returns 0 for '0'", () => {
    expect(parseQueryNumber("0")).toBe(0);
  });
});
