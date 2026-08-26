import { describe, expect, it } from "vitest";

import {
  inferLanguagesFromFiles,
  languageFromFilename,
} from "./infer-languages-from-files";

describe("languageFromFilename", () => {
  it("maps common extensions", () => {
    expect(languageFromFilename("src/app.ts")).toBe("TypeScript");
    expect(languageFromFilename("main.py")).toBe("Python");
    expect(languageFromFilename("Makefile")).toBe("Other");
  });
});

describe("inferLanguagesFromFiles", () => {
  it("skips directories and weights by size", () => {
    const counts = inferLanguagesFromFiles([
      { path: "src", type: "dir", size: 0 },
      { path: "a.rs", type: "file", size: 10 },
      { path: "b.rs", type: "file", size: 5 },
    ]);
    expect(counts).toEqual({ Rust: 15 });
  });
});
