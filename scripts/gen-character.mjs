#!/usr/bin/env node
/**
 * 用 Aholo Lux3D 造一个会干活的人形。
 *
 * 三个阶段，每一步都可单独重跑（taskId 会存盘，绝不重复提交）：
 *
 *   1. gen       text-to-3D  → 一个人形 GLB 的公网 URL
 *   2. rig       auto-rig    → 带骨骼的 GLB
 *   3. retarget  动作迁移    → 一个 GLB 里含 5 个动作 clip → public/models/worker.glb
 *
 * 用法：
 *   set AHOLO_API_KEY=xxx
 *   node scripts/gen-character.mjs --dry-run      # 只打印计划
 *   node scripts/gen-character.mjs                # 跑完整条流水线
 *   node scripts/gen-character.mjs --stage rig    # 只跑某一步（用已存的 URL）
 *   node scripts/gen-character.mjs --glb <url>    # 跳过生成，直接给一个 GLB
 *
 * 说明：三个阶段的产物都是公网 URL（2 小时有效），所以可以首尾相接，
 * 不需要先把文件传到别的地方。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const REGION = process.env.LUX3D_REGION === "global" ? "global" : "cn";
const BASE = REGION === "global" ? "https://api.aholo.ai/global" : "https://api.aholo3d.cn";
const KEY = process.env.AHOLO_API_KEY || process.env.LUX3D_API_KEY || "";

const STATE_FILE = path.join(__dirname, ".character-state.json");
const OUT_GLB = path.join(ROOT, "public", "models", "worker.glb");

/** 主角形象：卡通、办公室、T 字站姿（绑骨对姿态敏感） */
// 第一次跑失败了：手臂下垂 → MODEL_NOT_RIGGABLE。
// 绑骨对手臂外展极其敏感，所以这次把姿势要求写得非常死。
const PROMPT =
  "A 3D character model of a cartoon office worker in a clear A-pose for rigging: " +
  "BOTH ARMS RAISED OUTWARD at 45 degrees away from the body, arms clearly separated from the torso " +
  "with obvious empty space between arms and body, NOT hanging down, NOT touching the body, " +
  "legs straight and slightly apart, full body head to toe, facing forward, " +
  "short hair, light blue shirt, dark trousers, simple flat cartoon colors, " +
  "single character standing alone on a plain white background";

const STYLE = "cartoon";

/** 分镜里主角要用的 5 个动作（85 个预设 ID 里挑的） */
const ANIMATIONS = ["Idle_Loop", "Walk_Formal_Loop", "Interact", "Idle_FoldArms_Loop", "Fixing_Kneeling"];

/* ------------------------------------------------------------------ 工具 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const has = (n) => argv.includes("--" + n);

const DRY = has("dry-run");
const STAGE = arg("stage", "all");
const GIVEN_GLB = arg("glb", null);

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), "utf8");
}

async function api(pathname, init = {}) {
  const res = await fetch(BASE + pathname, {
    ...init,
    signal: AbortSignal.timeout(30000),
    headers: { authorization: KEY, "content-type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status} 非 JSON: ${text.slice(0, 200)}`);
  }
  if (body.c !== "0") throw new Error(`接口失败 c=${body.c} m=${body.m || ""}`);
  return body.d;
}

const STATUS = { 0: "排队", 1: "运行中", 2: "等待中", 3: "完成", 4: "失败", 5: "失败", 6: "取消" };

async function poll(taskId, { timeoutMs = 20 * 60 * 1000, label = "" } = {}) {
  const started = Date.now();
  let last = -1;
  for (;;) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`轮询超时（taskId=${taskId} 已存盘，可用 --stage 续跑）`);
    }
    const d = await api(`/lux3d/v1/generate/task/get?taskid=${encodeURIComponent(taskId)}`);
    if (d && d.status !== last) {
      last = d.status;
      console.log(`   ${label} 状态：${STATUS[d.status] ?? d.status}`);
    }
    if (d?.status === 3) return d;
    if (d && [4, 5, 6].includes(d.status)) {
      throw new Error(`任务失败 status=${d.status} ${JSON.stringify(d.outputs || []).slice(0, 200)}`);
    }
    await sleep(12000);
  }
}

function pickUrl(outputs, ext = ".glb") {
  for (const o of outputs || []) {
    const c = o?.content;
    if (typeof c !== "string" || !c || c === "NOT_REQUESTED" || c === "null") continue;
    if (c.split("?")[0].toLowerCase().endsWith(ext)) return c;
  }
  return null;
}

/* -------------------------------------------------------------- 三个阶段 */

async function stageGen(state) {
  if (state.glbUrl && !has("force")) {
    console.log(`① 生成：已有结果，跳过（${state.glbUrl.slice(0, 70)}…）`);
    return state.glbUrl;
  }
  if (GIVEN_GLB) {
    state.glbUrl = GIVEN_GLB;
    saveState(state);
    console.log(`① 生成：使用外部 GLB`);
    return GIVEN_GLB;
  }

  // 已经提交过但没拿到结果 → 接着查那个任务，不要再提交一次
  if (state.genTaskId) {
    console.log(`① 生成：续查已有任务 taskId=${state.genTaskId}`);
    const done = await poll(state.genTaskId, { label: "生成", timeoutMs: 35 * 60 * 1000 });
    const url = pickUrl(done.outputs);
    if (!url) throw new Error(`任务成功但没有 GLB: ${JSON.stringify(done.outputs).slice(0, 200)}`);
    state.glbUrl = url;
    saveState(state);
    return url;
  }

  console.log("① 生成：text-to-3D");
  console.log(`   prompt: ${PROMPT.slice(0, 80)}…`);
  if (DRY) return null;

  const taskId = await api("/lux3d/v1/generate/text-to-3d/task/create", {
    method: "POST",
    body: JSON.stringify({
      prompt: PROMPT,
      style: STYLE,
      version: "G1",
      faceCount: 120000,
      outputFormat: ["glb"],
      aiPredictSize: true,
    }),
  });
  state.genTaskId = taskId;
  saveState(state);
  console.log(`   taskId=${taskId}`);

  const d = await poll(taskId, { label: "生成", timeoutMs: 35 * 60 * 1000 });
  const url = pickUrl(d.outputs);
  if (!url) throw new Error(`没有 GLB 产物: ${JSON.stringify(d.outputs).slice(0, 300)}`);
  state.glbUrl = url;
  saveState(state);
  console.log(`   ✓ ${url.slice(0, 80)}…`);
  return url;
}

async function stageRig(state, glbUrl) {
  if (state.riggedUrl && !has("force")) {
    console.log("② 绑骨：已有结果，跳过");
    return state.riggedUrl;
  }
  if (state.rigTaskId) {
    console.log(`② 绑骨：续查已有任务 taskId=${state.rigTaskId}`);
    const done = await poll(state.rigTaskId, { label: "绑骨", timeoutMs: 25 * 60 * 1000 });
    const url = pickUrl(done.outputs);
    if (!url) throw new Error(`绑骨没有产出 GLB: ${JSON.stringify(done.outputs).slice(0, 200)}`);
    state.riggedUrl = url;
    saveState(state);
    return url;
  }

  console.log("② 绑骨：auto-rig（人形才能绑，失败会返回 MODEL_NOT_RIGGABLE）");
  if (DRY) return null;

  const taskId = await api("/lux3d/v1/animations/rig/task/create", {
    method: "POST",
    body: JSON.stringify({ modelUrl: glbUrl }),
  });
  state.rigTaskId = taskId;
  saveState(state);
  console.log(`   taskId=${taskId}`);

  const d = await poll(taskId, { label: "绑骨", timeoutMs: 25 * 60 * 1000 });
  const url = pickUrl(d.outputs);
  if (!url) {
    const raw = (d.outputs || []).map((o) => o?.content).join(" ");
    throw new Error(`绑骨没有产出 GLB：${raw.slice(0, 300)}`);
  }
  state.riggedUrl = url;
  saveState(state);
  console.log(`   ✓ ${url.slice(0, 80)}…`);
  return url;
}

async function stageRetarget(state, riggedUrl) {
  if (state.animUrl && !has("force")) {
    console.log("③ 动作：已有结果，跳过");
    return state.animUrl;
  }
  if (state.animTaskId) {
    console.log(`③ 动作：续查已有任务 taskId=${state.animTaskId}`);
    const done = await poll(state.animTaskId, { label: "动作", timeoutMs: 25 * 60 * 1000 });
    const raw2 = (done.outputs || []).map((o) => o?.content).join(" ");
    let u = null;
    try {
      const parsed = JSON.parse(raw2);
      u = (parsed.actions || []).map((a) => a.animationGlbUrl || a.fbxUrl).find(Boolean) || null;
    } catch {
      u = pickUrl(done.outputs);
    }
    if (!u) throw new Error(`续跑没拿到 GLB: ${raw2.slice(0, 300)}`);
    state.animUrl = u;
    saveState(state);
    return u;
  }

  console.log(`③ 动作：retarget（一次带 ${ANIMATIONS.length} 个 clip，combined）`);
  console.log(`   ${ANIMATIONS.join(", ")}`);
  if (DRY) return null;

  const taskId = await api("/lux3d/v1/animations/retarget/task/create", {
    method: "POST",
    body: JSON.stringify({
      rigModelUrl: riggedUrl,
      animationIds: ANIMATIONS,
      animationOutputMode: "combined",
      outFormat: "glb",
    }),
  });
  state.animTaskId = taskId;
  saveState(state);
  console.log(`   taskId=${taskId}`);

  const d = await poll(taskId, { label: "动作", timeoutMs: 25 * 60 * 1000 });
  const raw = (d.outputs || []).map((o) => o?.content).join(" ");
  // retarget 的结果是一个 JSON 字符串，里面才是各个动作的 URL
  let url = null;
  try {
    const parsed = JSON.parse(raw);
    const acts = parsed.actions || [];
    url = acts.map((a) => a.animationGlbUrl || a.fbxUrl).find(Boolean) || null;
  } catch {
    url = pickUrl(d.outputs);
  }
  if (!url) throw new Error(`动作迁移没有产出 GLB：${raw.slice(0, 400)}`);
  state.animUrl = url;
  saveState(state);
  console.log(`   ✓ ${url.slice(0, 80)}…`);
  return url;
}

async function download(url) {
  console.log("④ 下载");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}（产物 URL 可能已过期）`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(OUT_GLB), { recursive: true });
  fs.writeFileSync(OUT_GLB, buf);
  console.log(`   ✓ ${path.relative(ROOT, OUT_GLB)}  ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  console.log("人工智能流水线 · Lux3D 角色流水线");
  console.log(`  区域 ${REGION}  (${BASE})`);
  if (!KEY && !DRY) {
    console.error("缺少 AHOLO_API_KEY");
    process.exit(2);
  }

  let state = loadState();
  if (has("force")) {
    console.log("  --force：清空存盘，重新提交");
    state = {};
    saveState(state);
  }
  if (Object.keys(state).length) {
    console.log("  续跑：已有", Object.entries(state).map(([k]) => k).join(", "));
  }

  console.log(`  阶段 ${STAGE}`);
  if (DRY) console.log("  --dry-run：只打印，不调用接口");

  let glb = state.glbUrl ?? null;
  if (STAGE === "all" || STAGE === "gen") glb = await stageGen(state);
  else if (!glb) throw new Error("没有可用的 glbUrl，先跑 --stage gen 或 --glb");

  let rigged = state.riggedUrl ?? null;
  let anim = state.animUrl ?? null;

  try {
    if (STAGE === "all" || STAGE === "rig") rigged = await stageRig(state, glb);
    else if (!rigged && STAGE !== "gen") throw new Error("没有可用的 riggedUrl，先跑 --stage rig");

    if (STAGE === "all" || STAGE === "retarget") anim = await stageRetarget(state, rigged);
    else if (!anim && STAGE !== "gen") throw new Error("没有可用的 animUrl，先跑 --stage retarget");

    if (anim && !DRY) await download(anim);
  } catch (e) {
    // 绑骨失败不阻塞：先用静态模型顶上，人至少有长相，只是没有骨骼动画
    console.error("\n⚠ 骨骼流程失败：", e.message || e);
    if (glb && !DRY) {
      console.log("\n降级：下载静态模型（无骨骼动作，靠位移模拟走位）");
      await download(glb);
      console.log("下一步可以换一个更标准的 T-pose prompt 重跑：");
      console.log("  node scripts/gen-character.mjs --force");
    }
    process.exitCode = 2;
    return;
  }

  if (!DRY) {
    console.log("\n完成。前端还没接 GLB 角色 loader —— 下一步是把它读进 Scene 里。");
  }
}

main().catch((e) => {
  console.error("\n失败:", e.message || e);
  process.exit(1);
});
