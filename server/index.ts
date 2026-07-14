import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { installOnlineRooms } from "../dev/onlineRooms";

const development = process.argv.includes("--dev");
const root = resolve(import.meta.dirname, "..");
const assets = resolve(root, "dist");
const contentTypes: Record<string, string> = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".wav": "audio/wav" };
let vite: ViteDevServer | undefined;

const httpServer = createServer((request, response) => {
  if (vite) return vite.middlewares(request, response, () => undefined);
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const candidate = normalize(join(assets, pathname === "/" ? "index.html" : pathname));
  const file = candidate.startsWith(assets) && existsSync(candidate) ? candidate : join(assets, "index.html");
  response.writeHead(200, { "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
});

async function main() {
  if (development) vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  installOnlineRooms(httpServer);
  const port = Number(process.env.PORT ?? 5173);
  httpServer.listen(port, "0.0.0.0", () => console.log(`Cachito is running at http://localhost:${port}`));
}

void main();
