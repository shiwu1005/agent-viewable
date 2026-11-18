/**
 * DSH 会话文件解码。
 *
 * DSH 把会话写成一串首尾相接的 zstd frame 追加到：
 *   ~/.dsh/sessions/<工作区>/session-<id>/session.v4.jsonl.zstd
 *
 * 坑：zlib.zstdDecompressSync(整个文件) 只解第一帧。
 * 必须按魔数 28 B5 2F FD 切帧，逐帧解压。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";

export const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** 找出缓冲区里所有 zstd 帧的起始偏移 */
export function frameOffsets(buf) {
  const offs = [];
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) {
      offs.push(i);
    }
  }
  return offs;
}

/**
 * 解压一段（可能由多帧拼接而成的）缓冲区。
 * 返回 { text, consumed }：consumed 是已经完整解出的字节数，
 * 尾部没写完的半帧不会算进去，下次从 consumed 继续读即可。
 */
export function decodeFrames(buf) {
  const offs = frameOffsets(buf);
  if (offs.length === 0) return { text: "", consumed: 0, frames: 0 };

  const parts = [];
  let consumed = 0;
  let frames = 0;

  for (let k = 0; k < offs.length; k++) {
    const start = offs[k];
    // 默认本帧到下一帧起点结束；失败就往后合并（防止 payload 里恰好出现魔数）
    let end = k + 1 < offs.length ? offs[k + 1] : buf.length;
    let decoded = null;

    for (let tries = 0; tries < 4; tries++) {
      try {
        decoded = zlib.zstdDecompressSync(buf.subarray(start, end));
        break;
      } catch {
        const nextIdx = k + 1 + tries;
        if (nextIdx >= offs.length) {
          end = buf.length;
          try {
            decoded = zlib.zstdDecompressSync(buf.subarray(start, end));
          } catch {
            decoded = null;
          }
          break;
        }
        end = offs[nextIdx];
      }
    }

    if (!decoded) {
      // 这一帧还没写完（正在追加中），停在这里
      break;
    }

    parts.push(decoded.toString("utf8"));
    consumed = end;
    frames++;
  }

  return { text: parts.join(""), consumed, frames };
}

/** 整个文件解成 JSON 记录数组 */
export function decodeFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const { text } = decodeFrames(buf);
  return parseLines(text);
}

export function parseLines(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      /* 半行 / 坏行，跳过 */
    }
  }
  return out;
}

/** DSH 的数据根目录 */
export function sessionsRoot() {
  return process.env.DSH_HOME
    ? path.join(process.env.DSH_HOME, "sessions")
    : path.join(os.homedir(), ".dsh", "sessions");
}

/** 列出所有会话的 session 文件 */
export function listSessionFiles(root = sessionsRoot()) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const ws of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue;
    const wsDir = path.join(root, ws.name);
    let entries = [];
    try {
      entries = fs.readdirSync(wsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const s of entries) {
      if (!s.isDirectory()) continue;
      const dir = path.join(wsDir, s.name);
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith(".jsonl.zstd") || f.endsWith(".jsonl")) {
          out.push({ workspace: ws.name, dir, file: path.join(dir, f) });
        }
      }
    }
  }
  return out;
}

/** 找最近在写的那个会话文件 */
export function newestSessionFile({ workspacePrefix } = {}) {
  const files = listSessionFiles().filter(
    (f) => !workspacePrefix || f.workspace.includes(workspacePrefix),
  );
  let best = null;
  for (const f of files) {
    try {
      const st = fs.statSync(f.file);
      if (!best || st.mtimeMs > best.mtime) best = { ...f, mtime: st.mtimeMs, size: st.size };
    } catch {
      /* ignore */
    }
  }
  return best;
}

/** 演出相关的记录类型（其余直接丢弃，别推给前端） */
export const SHOW_TYPES = new Set([
  "session",
  "turn/start",
  "turn/end",
  "step/start",
  "step/end",
  "assistant/message",
  "tool/call",
  "tool/result",
  "todo/write",
  "job/registered",
  "job/settled",
  "approval/asked",
  "approval/decided",
  "deliverables/presented",
]);

export function isShowRecord(r) {
  return r && typeof r.type === "string" && SHOW_TYPES.has(r.type);
}
