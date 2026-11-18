#!/usr/bin/env node
/**
 * 用 Lux3D 批量生成工作室家具。
 *
 * 之前场景里的桌椅书架全是我手搓的方块 —— 这是浪费 API。
 * 现在每个道具都是 text-to-3D 生成的 GLB。
 *
 *   node scripts/gen-props.mjs --dry-run
 *   node scripts/gen-props.mjs
 *   node scripts/gen-props.mjs --only chair,monitor --force
 *
 * 断点续跑：每个 taskId 存在 scripts/.props-state.json，绝不重复提交。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "models", "props");
const STATE_FILE = path.join(__dirname, ".props-state.json");

const REGION = process.env.LUX3D_REGION === "global" ? "global" : "cn";
const BASE = REGION === "global" ? "https://api.aholo.ai/global" : "https://api.aholo3d.cn";
const KEY = process.env.AHOLO_API_KEY || process.env.LUX3D_API_KEY || "";

/* ---------------------------------------------------------------- 清单 */

export const PROPS = [
  {
    id: "desk",
    prompt:
      "A modern office desk, light oak wood top with slim black metal legs, " +
      "three quarter view, single object, clean product shot, plain background",
    height: 0.78,
  },
  {
    id: "chair",
    prompt:
      "An office swivel chair, black mesh back, padded seat, five star base with casters, " +
      "single object, clean product shot, plain background",
    height: 1.05,
  },
  {
    id: "monitor",
    prompt:
      "A 27 inch computer monitor with a slim metal stand, thin dark bezel, blank screen, " +
      "single object, clean product shot, plain background",
    height: 0.5,
  },
  {
    id: "bookshelf",
    prompt:
      "A low wooden bookshelf with three shelves filled with colorful books, " +
      "single object, clean product shot, plain background",
    height: 1.5,
  },
  {
    id: "plant",
    prompt:
      "A potted monstera plant with big green leaves in a terracotta pot, " +
      "single object, clean product shot, plain background",
    height: 1.2,
  },
  {
    id: "sofa",
    prompt:
      "A three seat sofa with teal fabric cushions, wooden frame, cozy lounge style, " +
      "single object, clean product shot, plain background",
    height: 0.85,
  },
  {
    id: "armchair",
    prompt:
      "A vintage brown leather armchair with wooden legs, cozy lounge style, " +
      "single object, clean product shot, plain background",
    height: 0.95,
  },
  {
    id: "coffeetable",
    prompt:
      "A low wooden coffee table with a chunky top, industrial style, " +
      "single object, clean product shot, plain background",
    height: 0.45,
  },
  {
    id: "mug",
    prompt: "A white ceramic coffee mug with a small handle, simple, single object, product shot, plain background",
    height: 0.1,
  },
  {
    id: "bookstack",
    prompt: "A stack of three hardcover books with colorful spines lying flat, single object, product shot, plain background",
    height: 0.12,
  },
  {
    id: "speaker",
    prompt: "A small retro bluetooth speaker box with a fabric front, single object, product shot, plain background",
    height: 0.24,
  },
  {
    id: "printer",
    prompt:
      "A compact office laser printer, white and grey plastic body with a paper tray, " +
      "single object, clean product shot, plain background",
    height: 0.6,
  },
];

const STYLE = "cartoon";
const FACE_COUNT = 60000;

/* ---------------------------------------------------------------- 工具 */

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

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), "utf8");

async function api(p, init = {}) {
  // 这台机器的网络会间歇性抽风，重试 4 次再放弃
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
      process.stdout.write(`      (网络抖动，重试 ${attempt + 1})\n`);
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

async function poll(taskId, timeoutMs = 35 * 60 * 1000) {
  const t0 = Date.now();
  let last = -1;
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error("轮询超时（taskId 已存盘，可续跑）");
    let d;
    try {
      d = await api(`/lux3d/v1/generate/task/get?taskid=${encodeURIComponent(taskId)}`);
    } catch (e) {
      process.stdout.write(`      (查询失败，稍后再试)\n`);
      await sleep(8000);
      continue;
    }
    if (d && d.status !== last) {
      last = d.status;
      const label = { 0: "排队", 1: "运行中", 3: "完成", 4: "失败", 6: "取消" }[d.status] ?? d.status;
      process.stdout.write(`    ${label}\n`);
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

async function makeProp(prop, state) {
  const st = state[prop.id] || {};
  state[prop.id] = st;
  const dest = path.join(OUT_DIR, `${prop.id}.glb`);

  if (fs.existsSync(dest) && !FORCE) {
    console.log(`✓ ${prop.id} 已存在，跳过`);
    return;
  }

  if (!st.taskId) {
    console.log(`▶ ${prop.id} 提交`);
    st.taskId = await api("/lux3d/v1/generate/text-to-3d/task/create", {
      method: "POST",
      body: JSON.stringify({
        prompt: prop.prompt,
        style: STYLE,
        version: "G1",
        faceCount: FACE_COUNT,
        outputFormat: ["glb"],
        aiPredictSize: true,
      }),
    });
    saveState(state);
  } else {
    console.log(`▶ ${prop.id} 续查 taskId=${st.taskId}`);
  }

  const d = await poll(st.taskId);
  const url = pickGlb(d.outputs);
  if (!url) throw new Error("任务成功但没有 GLB");

  const bytes = await download(url, dest);
  console.log(`  ✓ ${prop.id}.glb  ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  st.done = true;
  st.height = prop.height;
  saveState(state);
}

/* ---------------------------------------------------------------- 主流程 */

async function main() {
  console.log("工作室家具生成 · Lux3D text-to-3D");
  console.log(`  区域 ${REGION}  风格 ${STYLE}  面数 ${FACE_COUNT}`);
  if (!KEY && !DRY) {
    console.error("缺少 AHOLO_API_KEY");
    process.exit(2);
  }

  let list = PROPS;
  if (ONLY) {
    const ids = ONLY.split(",").map((s) => s.trim());
    list = PROPS.filter((p) => ids.includes(p.id));
  }

  console.log(`  计划 ${list.length} 个: ${list.map((p) => p.id).join(", ")}`);
  if (DRY) {
    for (const p of list) console.log(`  - ${p.id}: ${p.prompt.slice(0, 70)}…`);
    return;
  }

  const state = loadState();

  // 并发 2（免费账户上限）
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONC, list.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= list.length) return;
      try {
        await makeProp(list[i], state);
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
