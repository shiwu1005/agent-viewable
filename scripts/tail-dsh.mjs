#!/usr/bin/env node
/**
 * 把 DSH 正在写的会话日志变成一条 SSE 事件流。
 *
 *   node scripts/tail-dsh.mjs                 # 自动跟最近在写的会话
 *   node scripts/tail-dsh.mjs --port 8787
 *   node scripts/tail-dsh.mjs --file <path>
 *   node scripts/tail-dsh.mjs --workspace C-work
 *
 * 不修改 DSH，不装插件，不 hook 任何东西 —— 只读文件。
 */

import http from "node:http";
import fs from "node:fs";
import {
  newestSessionFile,
  decodeFrames,
  parseLines,
  isShowRecord,
} from "./dsh-decode.mjs";
import { redactRecord, setRedactExtras } from "./redact.mjs";

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

setRedactExtras([process.env.AHOLO_API_KEY, process.env.LUX3D_API_KEY]);
const PORT = Number(arg("port", "8787"));
const FIXED_FILE = arg("file", null);
const WS_PREFIX = arg("workspace", null);
const POLL_MS = Number(arg("interval", "400"));
const BACKLOG = Number(arg("backlog", "12"));

let target = null; // { file, workspace, mtime, size }
let offset = 0;
const history = []; // 最近的演出记录，给新连上来的浏览器补课
const clients = new Set();

function log(...a) {
  console.log(`[tail]`, ...a);
}

function pickTarget() {
  if (FIXED_FILE) return { file: FIXED_FILE, workspace: "fixed", mtime: 0, size: 0 };
  const f = newestSessionFile({ workspacePrefix: WS_PREFIX });
  return f ? { file: f.file, workspace: f.workspace, mtime: f.mtime, size: f.size } : null;
}

function pushRecord(rec) {
  history.push(rec);
  if (history.length > 400) history.splice(0, history.length - 400);
  const payload = `data: ${JSON.stringify(rec)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

function emit(recs) {
  // 工具参数里可能出现密钥，推给浏览器之前先脱敏
  for (const r of recs) if (isShowRecord(r)) pushRecord(redactRecord(r));
}

/** 从 offset 往后读新增字节 */
function pump() {
  const cur = pickTarget();
  if (!cur) return;

  // 切到了一个新会话
  if (!target || cur.file !== target.file) {
    target = cur;
    offset = 0;
    history.length = 0;
    log("跟随会话:", target.workspace, "→", target.file);
    // 先把已有的读完（当作 backlog）
    const buf = fs.readFileSync(target.file);
    const { text, consumed } = decodeFrames(buf);
    offset = consumed;
    emit(parseLines(text));
    log("载入历史记录:", history.length);
    for (const res of clients) {
      try {
        res.write(`event: reset\ndata: ${JSON.stringify({ session: target.workspace })}\n\n`);
      } catch {
        /* ignore */
      }
    }
    return;
  }

  let st;
  try {
    st = fs.statSync(target.file);
  } catch {
    return;
  }
  if (st.size < offset) {
    // 文件被截断/重写
    offset = 0;
  }
  if (st.size === offset) return;

  let buf;
  try {
    const fd = fs.openSync(target.file, "r");
    const len = st.size - offset;
    buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, offset);
    fs.closeSync(fd);
  } catch {
    return;
  }

  const { text, consumed } = decodeFrames(buf);
  if (consumed > 0) offset += consumed;
  const recs = parseLines(text);
  if (recs.length) emit(recs);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    res.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(
      JSON.stringify({
        ok: true,
        session: target?.workspace ?? null,
        file: target?.file ?? null,
        offset,
        backlog: history.length,
        clients: clients.size,
      }),
    );
    return;
  }

  if (url.pathname !== "/events") {
    res.writeHead(404, { "access-control-allow-origin": "*" });
    res.end("not found");
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
    "x-accel-buffering": "no",
  });
  res.write(`retry: 1000\n\n`);
  res.write(
    `event: meta\ndata: ${JSON.stringify({
      session: target?.workspace ?? null,
      backlog: history.length,
    })}\n\n`,
  );
  for (const rec of history.slice(-BACKLOG)) {
    res.write(`data: ${JSON.stringify({ ...rec, _backlog: true })}\n\n`);
  }
  clients.add(res);
  log("浏览器接入，当前连接数", clients.size);

  const keep = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(keep);
    }
  }, 15000);

  req.on("close", () => {
    clearInterval(keep);
    clients.delete(res);
  });
});

pump();
const timer = setInterval(pump, POLL_MS);

server.listen(PORT, "127.0.0.1", () => {
  log(`SSE 就绪 → http://127.0.0.1:${PORT}/events`);
  log(`健康检查 → http://127.0.0.1:${PORT}/health`);
});

process.on("SIGINT", () => {
  clearInterval(timer);
  server.close();
  process.exit(0);
});
