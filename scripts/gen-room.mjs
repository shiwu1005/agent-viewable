#!/usr/bin/env node
/** 整间办公室内景（一次 text-to-3D），产出 public/models/room.glb */
import fs from "node:fs";

const KEY = process.env.AHOLO_API_KEY || "";
const BASE = process.env.LUX3D_REGION === "global" ? "https://api.aholo.ai/global" : "https://api.aholo3d.cn";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPTS = {
  // 空房间壳：有地板和两面墙 + 大窗，前面敞开，没有家具 —— 这才装得下人
  shell:
    "An empty modern office room interior shell, wooden plank floor, " +
    "two walls meeting in a corner, one wall has a very large window, " +
    "open front with no front wall and no ceiling, cutaway view, " +
    "no furniture, no people, no objects, clean stylized 3D game environment",
  // 剖切式内景：三面墙 + 木地板 + 家具，方便角色站进去
  cutaway:
    "A cozy modern office interior seen as a cutaway dollhouse, open front, " +
    "three visible walls with a large window showing night city, warm wooden floor, " +
    "several desks with computers, office chairs, a bookshelf, plants, pendant lights, " +
    "warm inviting lighting, stylized 3D game scene, single scene object",
};

const which = process.argv[2] || "cutaway";
const OUT_NAME = process.argv[3] || (which === "shell" ? "room-shell" : "room");
const prompt = PROMPTS[which] || PROMPTS.cutaway;

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
  const body = JSON.parse(await res.text());
  if (body.c !== "0") throw new Error(`c=${body.c} ${body.m || ""}`);
  return body.d;
}

const STATE = "C:/work/agent-office/scripts/.room-state.json";
let state = {};
try {
  state = JSON.parse(fs.readFileSync(STATE, "utf8"));
} catch {}

if (!state[which]) {
  console.log("提交整间内景:", which);
  state[which] = await api("/lux3d/v1/generate/text-to-3d/task/create", {
    method: "POST",
    body: JSON.stringify({
      prompt,
      style: "cartoon",
      version: "G1",
      faceCount: 150000,
      outputFormat: ["glb"],
      aiPredictSize: true,
    }),
  });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log("  taskId:", state[which]);
} else {
  console.log("续查 taskId:", state[which]);
}

let last = -1;
for (;;) {
  let d;
  try {
    d = await api(`/lux3d/v1/generate/task/get?taskid=${state[which]}`);
  } catch {
    await sleep(9000);
    continue;
  }
  if (d.status !== last) {
    last = d.status;
    console.log("  状态", { 0: "排队", 1: "运行中", 3: "完成", 4: "失败" }[d.status] ?? d.status);
  }
  if (d.status === 3) {
    const url = (d.outputs || []).map((o) => o?.content).find((c) => typeof c === "string" && c.split("?")[0].endsWith(".glb"));
    if (!url) throw new Error("没有 GLB");
    const r = await fetch(url, { signal: AbortSignal.timeout(240000) });
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(`C:/work/agent-office/public/models/${OUT_NAME}.glb`, buf);
    console.log(`  ✓ ${OUT_NAME}.glb`, (buf.length / 1024 / 1024).toFixed(2), "MB");
    break;
  }
  if (d.status === 4 || d.status === 6) throw new Error("任务失败 status=" + d.status);
  await sleep(12000);
}
