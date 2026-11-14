// Local dev server: serves public/ and runs api/*.js like Vercel does.
// Usage: GEMINI_API_KEY=... node dev/server.mjs   then open http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json" };
const handlers = {
  "/api/chat": (await import(path.join(root, "api/chat.js"))).default,
  "/api/vision": (await import(path.join(root, "api/vision.js"))).default,
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (handlers[url.pathname]) return handlers[url.pathname](req, res);
  let file = path.join(root, "public", url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
  if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("content-type", types[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log("Sheba AI on http://localhost:" + (process.env.PORT || 3000)));
