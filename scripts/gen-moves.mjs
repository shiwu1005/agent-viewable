#!/usr/bin/env node
/**
 * 给已绑好的角色补一批动作 clip。
 * 复用 scripts/.character-state.json 里的 riggedUrl，只跑 retarget，不动绑骨。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STATE_FILE = path.join(__dirname, ".character-state.json");

const REGION = process.env.LUX3D_REGION === "global" ? "global" : "cn";
const BASE = REGION === "global" ? "https://api.aholo.ai/global" : "https://api.aholo3d.cn";
const KEY = process.env.AHOLO_API_KEY || process.env.LUX3D_API_KEY || "";

/** 工厂里用得上的动作（85 个预设里挑的） */
const EXTRA = [
  "Walk_Carry_Loop", // 抱着东西走 —— 和小人手里的道具对上了
  "Sitting_Idle_Loop", // 坐在工位上
  "OverhandThrow", // 把交付物扔出去
  "Push_Loop", // 推
  "PickUp_Table", // 搬东西
  "Idle_Talking_Loop", // 嘴上解释
  "Chest_Open", // 开箱
  "Interact", // 操作（已有，占位保持顺序稳定）
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, init = {}) {
  let res;
  for (let i = 0; i < 4; i++) {
    try {
      res = await fetch(BASE + p, {
        ...init,
        signal: AbortSignal.timeout(30000),
        headers: { authorization: KEY, "content-type": "application/json", ...(init.headers || {}) },
      });
      break;
    } catch (e) {
      if (i === 3) throw e;
      await sleep(3000 * (i + 1));
    }
  }
  const text = await res.text();
  const body = JSON.parse(text);
  if (body.c !== "0") throw new Error(`c=${body.c} ${body.m || ""}`);
  return body.d;
}

async function poll(taskId) {
  const t0 = Date.now();
  let last = -1;
  for (;;) {
    if (Date.now() - t0 > 40 * 60 * 1000) throw new Error("超时（taskId 已存盘）");
    let d;
    try {
      d = await api(`/lux3d/v1/generate/task/get?taskid=${encodeURIComponent(taskId)}`);
    } catch {
      await sleep(9000);
      continue;
    }
    if (d && d.status !== last) {
      last = d.status;
      console.log("    状态", { 0: "排队", 1: "运行中", 3: "完成", 4: "失败", 6: "取消" }[d.status] ?? d.status);
    }
    if (d?.status === 3) return d;
    if (d && [4, 5, 6].includes(d.status)) throw new Error(`失败 status=${d.status}`);
    await sleep(12000);
  }
}

async function main() {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  if (!state.riggedUrl) throw new Error("没有 riggedUrl，先跑 gen-character.mjs");

  console.log("补动作 clip");
  console.log("  角色:", state.riggedUrl.slice(0, 70));
  console.log("  动作:", EXTRA.join(", "));

  if (!state.extraTaskId) {
    state.extraTaskId = await api("/lux3d/v1/animations/retarget/task/create", {
      method: "POST",
      body: JSON.stringify({
        rigModelUrl: state.riggedUrl,
        animationIds: EXTRA,
        animationOutputMode: "combined",
        outFormat: "glb",
      }),
    });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log("  taskId:", state.extraTaskId);
  } else {
    console.log("  续查 taskId:", state.extraTaskId);
  }

  const d = await poll(state.extraTaskId);
  const raw = (d.outputs || []).map((o) => o?.content).join(" ");
  let url = null;
  try {
    const parsed = JSON.parse(raw);
    url = (parsed.actions || []).map((a) => a.animationGlbUrl || a.fbxUrl).find(Boolean);
  } catch {
    /* ignore */
  }
  if (!url) throw new Error("没有拿到 GLB: " + raw.slice(0, 200));

  const res = await fetch(url, { signal: AbortSignal.timeout(240000) });
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = path.join(ROOT, "public", "models", "worker-moves.glb");
  fs.writeFileSync(dest, buf);
  console.log(`  ✓ worker-moves.glb  ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
