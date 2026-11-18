/**
 * AI 打工人 · 实时接入桥
 *
 * 作用：把 DeepSeek Harness（DSH）正在写入的会话日志，
 * 实时转成这个页面能吃的 SSE 事件流，供 dist 里的 3D 场景播放。
 *
 *   页面(8123)  ←— SSE http://127.0.0.1:8791/events ←— 本桥 ←— ~/.dsh/sessions/**.zstd
 *
 * 只读会话日志，不修改 DSH，也不碰它的内部 API。
 *
 * 单独跑：node bridge.mjs [--port 8791] [--sessions <dir>] [--session <id>] [--cwd <path>]
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

const FILE_NAME = "session.v4.jsonl.zstd";
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

/** 页面 useOffice.apply() 认识的事件类型 */
const VISUAL = new Set([
  "session",
  "turn/start",
  "turn/end",
  "todo/write",
  "assistant/message",
  "tool/call",
  "tool/result",
  "job/registered",
  "job/settled",
  "approval/asked",
  "approval/decided",
  "deliverables/presented",
]);

/** 只保留页面需要的字段，避免把整段工具输出推给浏览器 */
function slim(rec) {
  const d = rec.data && typeof rec.data === "object" ? rec.data : {};
  let data;
  switch (rec.type) {
    case "session":
      data = { id: d.id, cwd: d.cwd };
      break;
    case "turn/start":
      data = { turn: d.turn };
      break;
    case "todo/write":
      data = {
        todos: Array.isArray(d.todos)
          ? d.todos.slice(0, 40).map((t) => ({
              content: String(t && t.content ? t.content : "").slice(0, 120),
              status: t && t.status,
            }))
          : [],
      };
      break;
    case "assistant/message": {
      const content = Array.isArray(d.message?.content) ? d.message.content : [];
      const reasoning = content
        .filter((c) => c && c.type === "reasoning")
        .map((c) => String(c.text || "").slice(0, 240));
      data = {
        usage: { totalTokens: Number(d.usage?.totalTokens) || 0 },
        message: { content: reasoning.map((text) => ({ type: "reasoning", text })) },
      };
      break;
    }
    case "tool/call":
      data = {
        turn: d.turn,
        step: d.step,
        callId: d.callId,
        name: d.name,
        arguments: String(d.arguments || "").slice(0, 200),
      };
      break;
    case "tool/result": {
      const text = (Array.isArray(d.message?.content) ? d.message.content : [])
        .map((c) => (c && typeof c.text === "string" ? c.text : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 160);
      data = {
        toolCallId: d.toolCallId || d.message?.toolCallId,
        isError: Boolean(d.isError || d.message?.isError),
        message: {
          isError: Boolean(d.isError || d.message?.isError),
          toolCallId: d.toolCallId || d.message?.toolCallId,
          content: [{ type: "text", text }],
        },
      };
      break;
    }
    case "job/registered":
      data = { jobId: d.jobId, kind: d.kind, label: String(d.label || "").slice(0, 80) };
      break;
    case "approval/asked":
      data = { reason: String(d.reason || d.toolName || "").slice(0, 160), toolName: d.toolName };
      break;
    case "approval/decided":
      data = { outcome: d.outcome };
      break;
    case "deliverables/presented":
      data = { files: Array.isArray(d.files) ? d.files.slice(0, 12).map((f) => String(f)) : [] };
      break;
    default:
      data = d;
  }
  return { type: rec.type, seq: rec.seq, time: rec.time, data };
}

/** 读一个 zstd 帧；字节不够返回 null，魔数不对返回 { error: true } */
function frameAt(buf, off) {
  if (off + 4 > buf.length) return null;
  if (
    buf[off] !== ZSTD_MAGIC[0] ||
    buf[off + 1] !== ZSTD_MAGIC[1] ||
    buf[off + 2] !== ZSTD_MAGIC[2] ||
    buf[off + 3] !== ZSTD_MAGIC[3]
  ) {
    return { error: true };
  }
  const start = off;
  let p = off + 4;
  if (p + 1 > buf.length) return null;
  const fhd = buf[p++];
  const singleSegment = (fhd >> 5) & 1;
  // Single-Segment 时 FCS 字段固定 1 字节（spec：fcs 标志 0 + single segment = 1）
  let fcsSize = [0, 1, 2, 4, 8][(fhd >> 6) & 3];
  if (fcsSize === 0 && singleSegment) fcsSize = 1;
  const hasChecksum = (fhd >> 2) & 1;
  const dictIdSize = [0, 1, 2, 4][fhd & 3];
  if (!singleSegment) p += 1; // window descriptor
  p += dictIdSize + fcsSize;
  let last = false;
  while (!last) {
    if (p + 3 > buf.length) return null;
    const v = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
    p += 3;
    last = (v & 1) === 1;
    const type = (v >> 1) & 3;
    const size = v >>> 3;
    p += type === 1 ? 1 : size; // RLE 只有 1 字节
    if (p > buf.length) return null;
  }
  if (hasChecksum) p += 4;
  if (p > buf.length) return null;
  return { start, end: p };
}

function decompressFrame(buf, start, end) {
  return zlib.zstdDecompressSync(buf.subarray(start, end)).toString("utf8");
}

function listSessionFiles(root) {
  const out = [];
  let dirs;
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const sub = path.join(root, d.name);
    let inner;
    try {
      inner = fs.readdirSync(sub, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const s of inner) {
      if (!s.isDirectory()) continue;
      const file = path.join(sub, s.name, FILE_NAME);
      try {
        const st = fs.statSync(file);
        if (st.isFile() && st.size > 0) out.push({ file, id: s.name, mtime: st.mtimeMs, size: st.size });
      } catch {
        /* 没有日志就算 */
      }
    }
  }
  return out;
}

/** 读文件头里的 session 记录（cwd、delegationDepth 等） */
function readMeta(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const chunk = buf.subarray(0, n);
    let off = 0;
    for (let guard = 0; guard < 8; guard++) {
      const fr = frameAt(chunk, off);
      if (!fr || fr.error) break;
      const text = decompressFrame(chunk, fr.start, fr.end).trim();
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const rec = JSON.parse(line);
        if (rec.type === "session") return rec.data || {};
      }
      off = fr.end;
    }
    return {};
  } catch {
    return {};
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function createBridge(opts = {}) {
  if (typeof zlib.zstdDecompressSync !== "function") {
    throw new Error("当前 Node 不支持 zstd，请升级到 Node 22.15+ / 23.8+");
  }

  const port = Number(opts.port || process.env.BRIDGE_PORT || 8791);
  const sessionsRoot = opts.sessionsRoot || path.join(os.homedir(), ".dsh", "sessions");
  const onlySession = opts.session || null;
  const onlyCwd = opts.cwd ? path.resolve(opts.cwd) : null;
  const backlogLimit = Number(opts.backlog ?? 80);
  const pollMs = Number(opts.pollMs ?? 400);

  const clients = new Set();
  const metaCache = new Map();
  const state = {
    file: null,
    id: null,
    offset: 0, // 已消费到的字节
    lastSeq: 0,
    error: null,
  };

  function meta(file) {
    const st = fs.statSync(file);
    const key = `${file}:${st.size}:${st.mtimeMs}`;
    const hit = metaCache.get(file);
    if (hit && hit.key === key) return hit.meta;
    const m = readMeta(file);
    metaCache.set(file, { key, meta: m });
    return m;
  }

  function pick() {
    const all = listSessionFiles(sessionsRoot)
      .filter((f) => !onlySession || f.id.includes(onlySession))
      .map((f) => ({ ...f, meta: meta(f.file) }));
    const top = all.filter((f) => !f.meta || !f.meta.delegationDepth);
    const pool = top.length ? top : all;
    const scoped = onlyCwd ? pool.filter((f) => f.meta && f.meta.cwd && path.resolve(f.meta.cwd) === onlyCwd) : pool;
    const use = scoped.length ? scoped : pool;
    if (!use.length) return null;
    use.sort((a, b) => b.mtime - a.mtime);
    return use[0];
  }

  function write(res, chunk) {
    try {
      res.write(chunk);
    } catch {
      clients.delete(res);
    }
  }

  function broadcastReset() {
    for (const res of clients) write(res, "event: reset\ndata: {}\n\n");
  }

  function broadcastRecord(rec, backlog) {
    const payload = backlog ? { ...rec, _backlog: true } : rec;
    const line = "data: " + JSON.stringify(payload) + "\n\n";
    for (const res of clients) write(res, line);
  }

  function sendBacklog(res) {
    if (!state.file) return;
    let buf;
    try {
      buf = fs.readFileSync(state.file);
    } catch {
      return;
    }
    const collected = [];
    let off = 0;
    while (off < buf.length) {
      const fr = frameAt(buf, off);
      if (!fr) break;
      if (fr.error) {
        off += 1;
        continue;
      }
      let text;
      try {
        text = decompressFrame(buf, fr.start, fr.end);
      } catch {
        off = fr.end;
        continue;
      }
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          continue;
        }
        if (VISUAL.has(rec.type)) collected.push(rec);
      }
      off = fr.end;
    }
    for (const rec of collected.slice(-backlogLimit)) {
      write(res, "data: " + JSON.stringify({ ...slim(rec), _backlog: true }) + "\n\n");
    }
  }

  function resetTo(file, id) {
    state.file = file;
    state.id = id;
    state.offset = 0;
    state.lastSeq = 0;
    try {
      state.offset = fs.statSync(file).size;
    } catch {
      state.offset = 0;
    }
    broadcastReset();
    for (const res of clients) sendBacklog(res);
  }

  function consumeNew() {
    if (!state.file) return;
    let st;
    try {
      st = fs.statSync(state.file);
    } catch {
      state.file = null;
      return;
    }
    if (st.size < state.offset) {
      // 文件被重写/压缩：从头再来
      state.offset = 0;
      state.lastSeq = 0;
      broadcastReset();
    }
    if (st.size === state.offset) return;

    const len = st.size - state.offset;
    const buf = Buffer.alloc(len);
    let fd;
    try {
      fd = fs.openSync(state.file, "r");
      fs.readSync(fd, buf, 0, len, state.offset);
    } catch {
      return;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    let off = 0;
    while (off < buf.length) {
      const fr = frameAt(buf, off);
      if (!fr) break; // 半帧，等下次
      if (fr.error) {
        off += 1;
        state.offset += 1;
        continue;
      }
      let text;
      try {
        text = decompressFrame(buf, fr.start, fr.end);
      } catch {
        state.offset += fr.end - fr.start;
        off = fr.end;
        continue;
      }
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          continue;
        }
        if (!VISUAL.has(rec.type)) continue;
        if (typeof rec.seq === "number" && rec.seq > 0) {
          if (rec.seq <= state.lastSeq) continue;
          state.lastSeq = rec.seq;
        }
        broadcastRecord(slim(rec), false);
      }
      state.offset += fr.end - fr.start;
      off = fr.end;
    }
  }

  function tick() {
    try {
      const cand = pick();
      if (!cand) return;
      if (!state.file || state.file !== cand.file) {
        // 换会话：只有明显更新才切，避免两个会话抢屏
        if (state.file) {
          let curMtime = 0;
          try {
            curMtime = fs.statSync(state.file).mtimeMs;
          } catch {
            curMtime = 0;
          }
          if (cand.mtime < curMtime + 1500) {
            consumeNew();
            return;
          }
        }
        resetTo(cand.file, cand.id);
        return;
      }
      consumeNew();
    } catch (e) {
      state.error = String(e && e.message ? e.message : e);
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    res.setHeader("cache-control", "no-store");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          session: state.id,
          file: state.file,
          seq: state.lastSeq,
          clients: clients.size,
          error: state.error,
        })
      );
      return;
    }

    if (url.pathname === "/sessions") {
      const list = listSessionFiles(sessionsRoot)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 30)
        .map((f) => ({ id: f.id, file: f.file, mtime: f.mtime, size: f.size }));
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(list, null, 1));
      return;
    }

    if (url.pathname === "/reset") {
      if (state.file) resetTo(state.file, state.id);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, session: state.id }));
      return;
    }

    if (url.pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write("retry: 2000\n\n");
      res.write("event: reset\ndata: {}\n\n");
      clients.add(res);
      sendBacklog(res);
      const hb = setInterval(() => write(res, ": ping\n\n"), 15000);
      req.on("close", () => {
        clearInterval(hb);
        clients.delete(res);
      });
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found: " + url.pathname);
  });

  const timer = setInterval(tick, pollMs);
  tick();

  return {
    port,
    state,
    get clients() {
      return clients.size;
    },
    close() {
      clearInterval(timer);
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      clients.clear();
      server.close();
    },
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve(`http://127.0.0.1:${port}`));
      });
    },
  };
}

// 直接运行时自启
const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const get = (name) => {
    const i = args.indexOf("--" + name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const bridge = createBridge({
    port: get("port") || 8791,
    sessionsRoot: get("sessions"),
    session: get("session"),
    cwd: get("cwd"),
    backlog: get("backlog"),
  });
  bridge
    .listen()
    .then((url) => {
      console.log("AI 打工人 · 接入桥已启动");
      console.log("  SSE   : " + url + "/events");
      console.log("  健康检查: " + url + "/health");
      console.log("  会话目录: " + (get("sessions") || path.join(os.homedir(), ".dsh", "sessions")));
    })
    .catch((e) => {
      console.error("接入桥启动失败:", e.message);
      process.exit(1);
    });
}
