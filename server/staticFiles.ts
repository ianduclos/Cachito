import { statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

export type StaticFileResolution =
  | { kind: "file"; file: string; immutable: boolean }
  | { kind: "not-found" }
  | { kind: "unavailable" };

function isFile(path: string) {
  try { return statSync(path).isFile(); } catch { return false; }
}

function inside(root: string, path: string) {
  return path === root || path.startsWith(`${root}${sep}`);
}

/** Maps a decoded URL path to a production file without escaping publicRoot. */
export function resolveStaticFile(publicRoot: string, pathname: string): StaticFileResolution {
  const root = resolve(publicRoot);
  const fingerprintedAssets = resolve(root, "assets");
  const requested = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);

  if (!inside(root, requested)) return { kind: "not-found" };
  if (pathname.startsWith("/assets/") && !inside(fingerprintedAssets, requested)) return { kind: "not-found" };
  if (isFile(requested)) return { kind: "file", file: requested, immutable: inside(fingerprintedAssets, requested) };

  // Asset and file-like requests should fail honestly; only extensionless app
  // routes receive the SPA shell.
  if (pathname.startsWith("/assets/") || extname(pathname)) return { kind: "not-found" };
  const shell = resolve(root, "index.html");
  return isFile(shell) ? { kind: "file", file: shell, immutable: false } : { kind: "unavailable" };
}
