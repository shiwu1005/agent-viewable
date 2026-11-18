// 一键启动：静态页面 + 实时事件桥
// 用法：node app.mjs [页面端口] [桥端口]
// 端口被占用时自动往后找空位。

import http from "node:http";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createBridge } from "./bridge.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const PAGE_PORT = Number(process.argv[2] || 8123);
const BRIDGE_PORT = Number(process.argv[3] || 8791);

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

  const file = path.join(DIST, urlPath);
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const idx = path.join(DIST, "index.html");
    if (fs.existsSync(idx)) {
      res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-cache" });
      fs.createReadStream(idx).pipe(res);
      return;
    }
    res.writeHead(404).end("not found");
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const cacheable = ext === ".glb" || ext === ".gltf" || ext === ".png" || ext === ".jpg";
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": cacheable ? "public, max-age=3600" : "no-cache",
  });
  fs.createReadStream(file).pipe(res);
});

function freePort(start, tries = 20) {
  return new Promise((resolve, reject) => {
    let port = start;
    const attempt = () => {
      const probe = net.createServer();
      probe.once("error", (err) => {
        probe.close();
        if (err.code === "EADDRINUSE" && port < start + tries) {
          port += 1;
          attempt();
        } else {
          reject(err);
        }
      });
      probe.once("listening", () => probe.close(() => resolve(port)));
      probe.listen(port, "127.0.0.1");
    };
    attempt();
  });
}

const pagePort = await freePort(PAGE_PORT);
const bridgePort = await freePort(BRIDGE_PORT);
const bridge = createBridge({ port: bridgePort });

const pageUrl = `http://127.0.0.1:${pagePort}/?source=live`;

bridge
  .listen()
  .then(() => {
    server.listen(pagePort, "127.0.0.1", () => {
      console.log("");
      console.log("  人工智能流水线 · 接入版");
      console.log("  ────────────────────────────");
      console.log(`  页面：${pageUrl}`);
      console.log(`  事件流：http://127.0.0.1:${bridgePort}/events`);
      console.log("  关掉这个窗口就退出");
      console.log("");
      try {
        spawn("cmd", ["/c", "start", "", pageUrl], { detached: true, stdio: "ignore" }).unref();
      } catch {
        /* 打不开就让用户自己点 */
      }
    });
  })
  .catch((e) => {
    console.error("");
    console.error("  启动失败：" + e.message);
    console.error(`  试试换个端口：node app.mjs ${pagePort > 9000 ? 8123 : pagePort + 1} ${bridgePort + 1}`);
    console.error("");
    process.exit(1);
  });

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    bridge.close();
    server.close();
    process.exit(0);
  });
}
