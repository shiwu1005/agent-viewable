import fs from "node:fs";

/**
 * 位置审计：打开页面，等模型加载，跑一次 __probe()，打印位置清单和穿模报告。
 *
 * 用法：ego-browser nodejs -e "await import('file:///C:/work/ego/video/audit.mjs')"
 * 输出：docs/audit.json + 终端表格
 */

const task = await taskSpace("agent-office");
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CAM = process.argv.find((a) => a.startsWith("--cam="))?.slice(6) ?? "";
const URL = `http://127.0.0.1:5180/?t=${Date.now()}${CAM ? `&cam=${CAM}` : ""}`;

await page.goto(URL);
await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1400,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

// 等角色模型真的挂上（这机器加载 100MB 素材很慢）
let loaded = false;
for (let i = 0; i < 150; i++) {
  await sleep(1000);
  if (await page.evaluate(() => !!window.__workerLoaded)) {
    loaded = true;
    break;
  }
}
console.log(loaded ? "模型已加载" : "⚠️ 模型没加载出来，测到的可能是兜底方块");

// 让主智能体进入工作状态，这样主角会坐到工位上
await page.evaluate(() => {
  const s = window.__office.getState();
  s.reset();
  s.apply({ type: "turn/start", seq: 51000, time: Date.now(), data: { turn: 1 } });
  s.apply({ type: "tool/call", seq: 51001, time: Date.now(), data: { name: "read", callId: "audit1" } });
});

// 等 IK 收敛
await sleep(9000);

const report = await page.evaluate(() => window.__probe?.() ?? null);
if (!report) {
  console.log("❌ __probe 不存在（devkit 没装上）");
  process.exit(1);
}

fs.mkdirSync("C:/work/agent-office/docs", { recursive: true });
fs.writeFileSync("C:/work/agent-office/docs/audit.json", JSON.stringify(report, null, 2));

const f = (n) => (typeof n === "number" ? n.toFixed(2) : String(n));

console.log("\n=== 位置清单 ===");
console.log("id".padEnd(22), "中心(x,y,z)".padEnd(24), "尺寸(x,y,z)".padEnd(22), "底面Y  顶面Y");
for (const [id, o] of Object.entries(report.objects)) {
  console.log(
    id.padEnd(22),
    o.center.map(f).join(",").padEnd(24),
    o.size.map(f).join(",").padEnd(22),
    f(o.y[0]).padEnd(7),
    f(o.y[1]),
  );
}

console.log("\n=== 角色 ===");
for (const c of report.characters) {
  console.log(c.id.padEnd(22), "pos", c.position.map(f).join(","), " 髋骨Y", f(c.hipsY));
}

console.log("\n=== 穿模（XZ 重叠 > 5cm）===");
if (!report.overlaps.length) console.log("  没有");
for (const o of report.overlaps) {
  console.log(`  ${o.a} × ${o.b}   x重叠 ${f(o.x)}  z重叠 ${f(o.z)}`);
}

console.log("\n报告已写入 docs/audit.json");
