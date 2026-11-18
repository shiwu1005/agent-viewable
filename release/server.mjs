// 极简静态服务器：双击 start.bat 就会跑这个
// 用法：node server.mjs [端口]

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.argv[2] || 8123);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "text/plain; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  let file = path.join(DIST, urlPath);
  // 防目录穿越
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  // 单页应用：找不到文件就回 index.html
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const idx = path.join(DIST, "index.html");
    if (fs.existsSync(idx)) {
      res.writeHead(200, { "content-type": MIME[".html"] });
      fs.createReadStream(idx).pipe(res);
      return;
    }
    res.writeHead(404).end("not found");
    return;
  }

  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log("");
  console.log("  人工智能流水线 · 场景调整版");
  console.log("  ────────────────────────────");
  console.log(`  地址：${url}`);
  console.log("  关掉这个黑窗口就退出");
  console.log("");
  // Windows 下自动打开浏览器
  try {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* 打不开就让用户自己点 */
  }
});
