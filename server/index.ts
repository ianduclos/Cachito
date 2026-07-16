import { createReadStream } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { installOnlineRooms } from "../dev/onlineRooms";
import { resolveStaticFile } from "./staticFiles";

const development = process.argv.includes("--dev");
const root = resolve(import.meta.dirname, "..");
const assets = resolve(root, "dist");
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; media-src 'self'; connect-src 'self' wss://cachito-rooms-ribcxidnzq-ez.a.run.app; worker-src 'self' blob:; manifest-src 'self'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};
let vite: ViteDevServer | undefined;

function sendText(response: ServerResponse, status: number, body: string, extraHeaders: Record<string, string> = {}) {
  response.writeHead(status, {
    ...securityHeaders,
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "text/plain; charset=utf-8",
    ...extraHeaders,
  });
  response.end(body);
}

const httpServer = createServer((request, response) => {
  if (vite) return vite.middlewares(request, response, () => undefined);
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "Method not allowed", { Allow: "GET, HEAD" });
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    sendText(response, 400, "Bad request");
    return;
  }

  const selection = resolveStaticFile(assets, pathname);
  if (selection.kind === "not-found") {
    sendText(response, 404, "Not found");
    return;
  }
  if (selection.kind === "unavailable") {
    sendText(response, 503, "Application build is unavailable");
    return;
  }

  response.writeHead(200, {
    ...securityHeaders,
    "Cache-Control": selection.immutable ? "public, max-age=31536000, immutable" : "no-store, max-age=0",
    "Content-Type": contentTypes[extname(selection.file).toLowerCase()] ?? "application/octet-stream",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(selection.file).on("error", () => response.destroy()).pipe(response);
});

async function main() {
  if (development) vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  installOnlineRooms(httpServer);
  const port = Number(process.env.PORT ?? 5173);
  httpServer.listen(port, "0.0.0.0", () => console.log(`Cachito is running at http://localhost:${port}`));
}

void main();
