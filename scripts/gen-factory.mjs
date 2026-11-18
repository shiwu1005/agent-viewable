#!/usr/bin/env node
/**
 * 流水线的五件核心装置，全部用 Lux3D 生成，替换手拼方块。
 *
 *   node scripts/gen-factory.mjs --dry-run
 *   node scripts/gen-factory.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "models", "factory");
const STATE_FILE = path.join(__dirname, ".factory-state.json");

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

export const FACTORY = [
  {
    id: "conveyor",
    prompt:
      "A long industrial conveyor belt machine, black rubber belt with metal frame and rollers, " +
      "side rails, standing on metal legs, side view, single object, clean product shot, plain background",
    height: 0.9,
  },
  {
    id: "processor",
    prompt:
      "A large industrial processing machine cabinet, dark metal body with a big flat screen panel " +
      "mounted on top, sci-fi factory equipment, front view, single object, clean product shot, plain background",
    height: 2.4,
  },
  {
    id: "robotarm2",
    prompt:
      "A heavy industrial six axis robot arm, anthracite dark gray body with orange accents, " +
      "visible rotary joints, cable harness along the arm, precision engineering, sleek modern design, " +
      "mounted on a heavy round base, front view, single object, clean product shot, plain background",
    height: 1.8,
  },
  {
    id: "robotarm3",
    prompt:
      "A sleek modern collaborative robot arm, matte black and silver, streamlined articulated segments, " +
      "integrated joints with glowing ring indicators, tool flange at the end, " +
      "mounted on a round base, front view, single object, clean product shot, plain background",
    height: 1.8,
  },
  {
    id: "crate",
    prompt:
      "A cardboard shipping box with packing tape, slightly worn edges, " +
      "front view, single object, clean product shot, plain background",
    height: 0.34,
  },
  {
    id: "recycle",
    prompt:
      "An industrial rework return station machine, a mechanical diverter arm that pushes items backwards " +
      "onto a lower return conveyor, red and dark gray metal, hydraulic cylinder, warning stripes, " +
      "side view, single object, clean product shot, plain background",
    height: 1.5,
  },
  {
    id: "chute",
    prompt:
      "An industrial output chute, angled metal slide with side walls leading to a dark opening, " +
      "side view, single object, clean product shot, plain background",
    height: 1.0,
  },
];

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
    if (Date.now() - t0 > timeoutMs) throw new Error("轮询超时");
    let d;
    try {
      d = await api(`/lux3d/v1/generate/task/get?taskid=${encodeURIComponent(taskId)}`);
    } catch {
      await sleep(8000);
      continue;
    }
    if (d && d.status !== last) {
      last = d.status;
      console.log(`    ${{ 0: "排队", 1: "运行中", 3: "完成", 4: "失败", 6: "取消" }[d.status] ?? d.status}`);
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

async function makeOne(item, state) {
  const st = (state[item.id] = state[item.id] || {});
  const dest = path.join(OUT_DIR, `${item.id}.glb`);
  if (fs.existsSync(dest) && !FORCE) {
    console.log(`✓ ${item.id} 已存在`);
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
  }
  const d = await poll(st.taskId);
  const url = pickGlb(d.outputs);
  if (!url) throw new Error("没有 GLB");
  const bytes = await download(url, dest);
  console.log(`  ✓ ${item.id}.glb ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  st.done = true;
  saveState(state);
}

async function main() {
  console.log("流水线装置生成 · Lux3D");
  let list = FACTORY;
  if (ONLY) {
    const ids = ONLY.split(",").map((s) => s.trim());
    list = FACTORY.filter((p) => ids.includes(p.id));
  }
  if (DRY) {
    for (const p of list) console.log(`  - ${p.id}: ${p.prompt.slice(0, 90)}`);
    return;
  }
  const state = loadState();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONC, list.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= list.length) return;
        try {
          await makeOne(list[i], state);
        } catch (e) {
          console.error(`  ✗ ${list[i].id}: ${e.message}`);
        }
      }
    }),
  );
  const ok = list.filter((p) => fs.existsSync(path.join(OUT_DIR, `${p.id}.glb`)));
  console.log(`\n完成 ${ok.length}/${list.length}`);
}

main().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
