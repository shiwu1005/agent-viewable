#!/usr/bin/env node
/**
 * 为四个房间各生成一件"适配"的家具，替换掉我手工拼的方块。
 *
 *   node scripts/gen-roomset.mjs --dry-run
 *   node scripts/gen-roomset.mjs
 *   node scripts/gen-roomset.mjs --only counter,dropbox
 *
 * 断点续跑：taskId 存在 scripts/.roomset-state.json。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "models", "roomset");
const STATE_FILE = path.join(__dirname, ".roomset-state.json");

const REGION = process.env.LUX3D_REGION === "global" ? "global" : "cn";
const BASE = REGION === "global" ? "https://api.aholo.ai/global" : "https://api.aholo3d.cn";
const KEY = process.env.AHOLO_API_KEY || process.env.LUX3D_API_KEY || "XopGbHyhmQydTVU";

const STYLE = "cartoon";
const FACE_COUNT = 40000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const has = (n) => argv.includes("--" + n);

const DRY = has("dry-run");
const ONLY = arg("only", null);
const FORCE = has("force");
const CONC = Number(arg("concurrency", "2"));

/* ---------------------------------------------------------------- 清单 */

export const ROOMSET = [
  {
    id: "counter",
    // 接单房：落地接待台，正面对着顾客
    prompt:
      "A reception counter desk, solid warm wooden front panel with a wide flat top surface, " +
      "waist high, front facing view, single object, clean product shot, plain background",
    height: 1.0,
  },
  {
    id: "whiteboard",
    // 思考房：带轮子的白板
    prompt:
      "A whiteboard on a wheeled stand, white board surface with slim aluminum frame, " +
      "front facing view, single object, clean product shot, plain background",
    height: 1.85,
  },
  {
    id: "standingdesk",
    // 执行房：站立办公桌
    prompt:
      "A height adjustable standing desk, light wood top with black metal frame, " +
      "front facing view, single object, clean product shot, plain background",
    height: 1.05,
  },
  {
    id: "workstation",
    // 一体工位：桌子 + 显示器 + 键盘 + 杯子，一次生成就不会错位
    prompt:
      "an office desk with a computer on it",
    height: 1.32,
  },
  {
    id: "dropbox",
    // 交付房：包裹投递箱
    prompt:
      "A parcel drop box kiosk, dark metal body with a horizontal slot near the top, " +
      "front facing view, single object, clean product shot, plain background",
    height: 1.2,
  },
];

/* ---------------------------------------------------------------- 工具 */

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), "utf8");

async function api(p, init = {}) {
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      res = await fetch(BASE + p, {
        ...init,
        signal: AbortSignal.timeout(30000),
        headers: { authorization: KEY, "content-type": "application/json", ...(init.headers || {}) },
      });
      break;
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(`      (网络抖动，重试 ${attempt + 1})`);
      await sleep(2500 * (attempt + 1));
    }
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
  if (body.c !== "0") throw new Error(`c=${body.c} ${body.m || ""}`);
  return body.d;
}

async function poll(taskId, timeoutMs = 40 * 60 * 1000) {
  const t0 = Date.now();
  let last = -1;
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error("轮询超时（taskId 已落盘，可续跑）");
    let d;
    try {
      d = await api(`/lux3d/v1/generate/task/get?taskid=${encodeURIComponent(taskId)}`);
    } catch {
      console.log("      (查询失败，稍后再试)");
      await sleep(8000);
      continue;
    }
    if (d && d.status !== last) {
      last = d.status;
      const label = { 0: "排队", 1: "运行中", 3: "完成", 4: "失败", 6: "取消" }[d.status] ?? d.status;
      console.log(`    ${label}`);
    }
    if (d?.status === 3) return d;
    if (d && [4, 5, 6].includes(d.status)) throw new Error(`任务失败 status=${d.status}`);
    await sleep(12000);
  }
}

function pickGlb(outputs) {
  for (const o of outputs || []) {
    const c = o?.content;
    if (typeof c !== "string" || !c || c === "NOT_REQUESTED" || c === "null") continue;
    if (c.split("?")[0].toLowerCase().endsWith(".glb")) return c;
  }
  return null;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

/* ---------------------------------------------------------------- 单个 */

async function makeOne(item, state) {
  const st = (state[item.id] = state[item.id] || {});
  const dest = path.join(OUT_DIR, `${item.id}.glb`);

  if (fs.existsSync(dest) && !FORCE) {
    console.log(`✓ ${item.id} 已存在，跳过`);
    return;
  }

  if (!st.taskId) {
    console.log(`▸ ${item.id} 提交`);
    st.taskId = await api("/lux3d/v1/generate/text-to-3d/task/create", {
      method: "POST",
      body: JSON.stringify({
        prompt: item.prompt,
        style: STYLE,
        version: "G1",
        faceCount: FACE_COUNT,
        outputFormat: ["glb"],
        aiPredictSize: true,
      }),
    });
    saveState(state);
  } else {
    console.log(`▸ ${item.id} 续查 taskId=${st.taskId}`);
  }

  const d = await poll(st.taskId);
  const url = pickGlb(d.outputs);
  if (!url) throw new Error("任务成功但没有 GLB");

  const bytes = await download(url, dest);
  console.log(`  ✓ ${item.id}.glb  ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  st.done = true;
  st.height = item.height;
  saveState(state);
}

/* ---------------------------------------------------------------- 主流程 */

async function main() {
  console.log("房间家具生成 · Lux3D text-to-3D");
  console.log(`  区域 ${REGION}  风格 ${STYLE}  面数 ${FACE_COUNT}`);

  let list = ROOMSET;
  if (ONLY) {
    const ids = ONLY.split(",").map((s) => s.trim());
    list = ROOMSET.filter((p) => ids.includes(p.id));
  }

  if (DRY) {
    for (const p of list) console.log(`  - ${p.id}: ${p.prompt}`);
    return;
  }

  const state = loadState();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONC, list.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= list.length) return;
      try {
        await makeOne(list[i], state);
      } catch (e) {
        console.error(`  ✗ ${list[i].id}: ${e.message}`);
      }
    }
  });
  await Promise.all(workers);

  const ok = list.filter((p) => fs.existsSync(path.join(OUT_DIR, `${p.id}.glb`)));
  console.log(`\n完成 ${ok.length}/${list.length}`);
}

main().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
