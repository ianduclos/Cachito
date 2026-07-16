import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveStaticFile } from "./staticFiles";

describe("production static routing", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cachito-static-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "app shell");
    writeFileSync(join(root, "assets", "index-abc123.js"), "bundle");
    writeFileSync(join(root, "favicon.png"), "icon");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("serves app routes from the non-cacheable shell", () => {
    expect(resolveStaticFile(root, "/room/ABCDE")).toEqual({
      kind: "file",
      file: resolve(root, "index.html"),
      immutable: false,
    });
  });

  it("marks only files contained by the fingerprinted assets directory immutable", () => {
    expect(resolveStaticFile(root, "/assets/index-abc123.js")).toEqual({
      kind: "file",
      file: resolve(root, "assets/index-abc123.js"),
      immutable: true,
    });
    expect(resolveStaticFile(root, "/favicon.png")).toMatchObject({ kind: "file", immutable: false });
  });

  it("returns not found for missing files and asset-path traversal", () => {
    expect(resolveStaticFile(root, "/assets/missing.js")).toEqual({ kind: "not-found" });
    expect(resolveStaticFile(root, "/missing.png")).toEqual({ kind: "not-found" });
    expect(resolveStaticFile(root, "/assets/../index.html")).toEqual({ kind: "not-found" });
    expect(resolveStaticFile(root, "/../../outside.txt")).toEqual({ kind: "not-found" });
  });

  it("reports an unavailable build when no app shell exists", () => {
    rmSync(join(root, "index.html"));
    expect(resolveStaticFile(root, "/online")).toEqual({ kind: "unavailable" });
  });
});
