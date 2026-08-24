import { describe, expect, it } from "vitest";
import { DiffArgumentError, parseDiffArguments } from "../src/arguments.ts";

describe("parseDiffArguments", () => {
  it("parses an empty working-tree request", () => {
    expect(parseDiffArguments("")).toEqual({ staged: false });
  });

  it("accepts plain and Pi @-completed paths", () => {
    expect(parseDiffArguments("src/main.ts")).toEqual({ staged: false, path: "src/main.ts" });
    expect(parseDiffArguments("@src/main.ts")).toEqual({ staged: false, path: "src/main.ts" });
  });

  it("normalizes Pi quoted @ paths containing spaces", () => {
    expect(parseDiffArguments('@"src/path with spaces/file.ts"')).toEqual({
      staged: false,
      path: "src/path with spaces/file.ts",
    });
  });

  it("parses staged and revision modes", () => {
    expect(parseDiffArguments("--staged @src/main.ts")).toEqual({ staged: true, path: "src/main.ts" });
    expect(parseDiffArguments("--ref main...HEAD src/main.ts")).toEqual({
      staged: false,
      ref: "main...HEAD",
      path: "src/main.ts",
    });
    expect(parseDiffArguments("--ref=HEAD~2")).toEqual({ staged: false, ref: "HEAD~2" });
  });

  it("rejects duplicate paths and incompatible options", () => {
    expect(() => parseDiffArguments("one.ts two.ts")).toThrow(DiffArgumentError);
    expect(() => parseDiffArguments("--staged --staged")).toThrow("--staged may only be specified once");
    expect(() => parseDiffArguments("--ref HEAD --ref main")).toThrow("--ref may only be specified once");
    expect(() => parseDiffArguments("--staged --ref HEAD")).toThrow("cannot be used together");
  });

  it("rejects malformed arguments", () => {
    expect(() => parseDiffArguments("--ref")).toThrow("--ref requires");
    expect(() => parseDiffArguments("--ref=-R")).toThrow("does not start with '-'");
    expect(() => parseDiffArguments("--ref -R")).toThrow("does not start with '-'");
    expect(() => parseDiffArguments("--unknown")).toThrow("Unknown option");
    expect(() => parseDiffArguments("@")).toThrow("Select a file after @");
    expect(() => parseDiffArguments('@"unterminated')).toThrow("unterminated quote");
  });
});
