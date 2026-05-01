import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(webDir, "dist");
const port = Number(process.env.MAESTRO_WEB_PORT || 5173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

if (!existsSync(path.join(distDir, "index.html"))) {
  console.error("Web dist is missing. Run `corepack pnpm run build:web` first.");
  process.exit(1);
}

createServer((req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const cleanPath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/u, "");
  const requestedPath = cleanPath ? path.join(distDir, cleanPath) : path.join(distDir, "index.html");
  const filePath = resolveInsideDist(requestedPath) && existsSync(requestedPath) && statSync(requestedPath).isFile()
    ? requestedPath
    : path.join(distDir, "index.html");
  const extension = path.extname(filePath);

  res.writeHead(200, { "content-type": mimeTypes[extension] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}).listen(port, "127.0.0.1", () => {
  console.log(`Maestro web listening at http://127.0.0.1:${port}`);
});

function resolveInsideDist(candidate) {
  const relative = path.relative(distDir, path.resolve(candidate));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}
