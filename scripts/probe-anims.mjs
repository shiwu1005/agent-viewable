import fs from "node:fs";

/** 一次提交一批候选动作 ID，API 会逐条返回 status，成功的就是存在的 */
const KEY = process.env.AHOLO_API_KEY || "";
const BASE = "https://api.aholo.ai/global";
const STATE = "C:/work/agent-office/scripts/.character-state.json";

const CANDIDATES = [
  "Angry_Gesture_Loop",
  "Facepalm",
  "Cheer",
  "Disappointed",
  "Think_Loop",
  "Shrug",
  "Typing_Loop",
  "Stand_Up",
  "Clap_Loop",
  "Head_Shake",
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
  const body = JSON.parse(await res.text());
  if (body.c !== "0") throw new Error(`c=${body.c} ${body.m || ""}`);
  return body.d;
}

const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
if (!state.riggedUrl) throw new Error("没有 riggedUrl");

console.log("提交动作探测，共", CANDIDATES.length, "个候选");
const taskId = await api("/lux3d/v1/animations/retarget/task/create", {
  method: "POST",
  body: JSON.stringify({
    rigModelUrl: state.riggedUrl,
    animationIds: CANDIDATES,
    animationOutputMode: "combined",
    outFormat: "glb",
  }),
});
console.log("  taskId:", taskId);

for (;;) {
  let d;
  try {
    d = await api(`/lux3d/v1/generate/task/get?taskid=${taskId}`);
  } catch {
    await sleep(9000);
    continue;
  }
  console.log("  status", d.status);
  if (d.status === 3) {
    const raw = (d.outputs || []).map((o) => o?.content).join(" ");
    try {
      const parsed = JSON.parse(raw);
      const acts = parsed.actions || [];
      const ok = acts.filter((a) => a.status === "success");
      const bad = acts.filter((a) => a.status !== "success");
      console.log("\n✅ 可用:", ok.map((a) => a.animation_id).join(", "));
      console.log("❌ 不存在:", bad.map((a) => a.animation_id).join(", ") || "无");
      const url = acts.map((a) => a.animationGlbUrl).find(Boolean);
      if (url) {
        const r = await fetch(url, { signal: AbortSignal.timeout(240000) });
        const buf = Buffer.from(await r.arrayBuffer());
        fs.writeFileSync("C:/work/agent-office/public/models/worker-perf.glb", buf);
        console.log(`\n下载 worker-perf.glb ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
        fs.writeFileSync(
          "C:/work/agent-office/scripts/.perf-order.json",
          JSON.stringify(ok.map((a) => a.animation_id), null, 2),
        );
      }
    } catch (e) {
      console.log("解析失败:", e.message, raw.slice(0, 200));
    }
    break;
  }
  if (d.status === 4 || d.status === 6) throw new Error("任务失败");
  await sleep(12000);
}
