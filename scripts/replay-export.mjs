#!/usr/bin/env node
/**
 * 把一次 DSH 会话导出成静态的 replay.jsonl，给 GitHub Pages 用。
 *
 *   node scripts/replay-export.mjs                     # 最近的一次会话
 *   node scripts/replay-export.mjs --file <path>
 *   node scripts/replay-export.mjs --workspace C-work
 *   node scripts/replay-export.mjs --out public/replay.jsonl
 *
 * 导出的是「演出相关」的原始记录，前端用同一套 mapping 解析，
 * 所以回放和实时的表现完全一致。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newestSessionFile, decodeFile, isShowRecord, listSessionFiles } from "./dsh-decode.mjs";
import { redactRecord, setRedactExtras } from "./redact.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const OUT = path.resolve(ROOT, arg("out", "public/replay.jsonl"));

// 需要抹掉的明文：环境变量里的 key + 命令行 --redact 传进来的
const REDACT_VALUES = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--redact" && argv[i + 1]) REDACT_VALUES.push(argv[i + 1]);
}
setRedactExtras([process.env.AHOLO_API_KEY, process.env.LUX3D_API_KEY, ...REDACT_VALUES]);
const FIXED = arg("file", null);
const WS = arg("workspace", null);

let target;
if (FIXED) target = { file: FIXED, workspace: "fixed" };
else {
  if (argv.includes("--list")) {
    for (const f of listSessionFiles()) {
      const st = fs.statSync(f.file);
      console.log(new Date(st.mtimeMs).toLocaleString("zh-CN"), String(st.size).padStart(10), f.workspace);
    }
    process.exit(0);
  }
  target = newestSessionFile({ workspacePrefix: WS });
}

if (!target) {
  console.error("找不到会话文件");
  process.exit(1);
}

console.log("导出会话:", target.workspace);
console.log("  文件:", target.file);
console.log("  已对工具参数做密钥脱敏");

const all = decodeFile(target.file);
// 会话日志里有工具调用的原始参数，可能带 API key —— 落盘前先洗
const show = all.filter(isShowRecord).map(redactRecord);

const meta = {
  type: "export/meta",
  exportedAt: Date.now(),
  workspace: target.workspace,
  source: path.basename(path.dirname(target.file)),
  totalRecords: all.length,
  showRecords: show.length,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, [meta, ...show].map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`  ${show.length} 条演出记录 → ${path.relative(ROOT, OUT)}  (${kb} KB)`);

const counts = {};
for (const r of show) counts[r.type] = (counts[r.type] || 0) + 1;
console.log("  ", JSON.stringify(counts));
