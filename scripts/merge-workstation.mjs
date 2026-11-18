#!/usr/bin/env node
/**
 * 把"站着办公的工位"合成一个 GLB：桌 + 显示器 + 键盘 + 杯子。
 *
 *   node scripts/merge-workstation.mjs
 *
 * 为什么要合：分开摆的时候，显示器总会和桌面错开几厘米（穿模或悬空）。
 * 合成一个模型之后，相对位置在导出时就固定了，摆进场景只需要对齐一个包围盒。
 */

import fs from "node:fs";
import path from "node:path";
// three 的 loader/exporter 会引用浏览器全局，Node 里补一下
globalThis.self = globalThis;

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

const ROOT = process.cwd();
const DESK_SRC = path.join(ROOT, "public/models/roomset/standingdesk.glb");
const MUG_SRC = path.join(ROOT, "public/models/props/mug.glb");
const DEST = path.join(ROOT, "public/models/roomset/workstation.glb");

/** 目标尺寸（米） */
const DESK_H = 1.0; // 站立桌总高
const DESK_DEPTH_USE = 0.55; // 只用桌面靠人的这一半
const MON_W = 0.86;
const MON_H = 0.5;
const MUG_H = 0.11;

const load = (p) =>
  new Promise((res, rej) => {
    const buf = fs.readFileSync(p);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    new GLTFLoader().parse(ab, "", res, rej);
  });

/** 归一化：脚踩 y=0、XZ 居中、总高 = height */
function normalize(obj, height) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = height / Math.max(size.y, 1e-4);
  obj.scale.setScalar(s);
  obj.updateMatrixWorld(true);

  const b2 = new THREE.Box3().setFromObject(obj);
  obj.position.x -= (b2.min.x + b2.max.x) / 2;
  obj.position.z -= (b2.min.z + b2.max.z) / 2;
  obj.position.y -= b2.min.y;
  obj.updateMatrixWorld(true);
  return obj;
}

const body = (color, rough = 0.65, metal = 0.05) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

async function main() {
  const group = new THREE.Group();
  group.name = "workstation";

  // ---- 桌子 ----
  const deskGltf = await load(DESK_SRC);
  const desk = normalize(deskGltf.scene, DESK_H);
  group.add(desk);

  desk.updateMatrixWorld(true);
  const deskBox = new THREE.Box3().setFromObject(desk);
  const deskTop = deskBox.max.y;
  const deskBack = deskBox.min.z;
  const deskFront = deskBox.max.z;
  console.log(`桌子：顶面 y=${deskTop.toFixed(3)}  z ∈ [${deskBack.toFixed(3)}, ${deskFront.toFixed(3)}]`);

  // 显示器放在靠后一点的位置
  const monZ = deskBack + (deskFront - deskBack) * 0.28;

  // ---- 显示器：整块面板 + 底座 + 支臂 ----
  const panel = new THREE.Mesh(new THREE.BoxGeometry(MON_W, MON_H, 0.035), body("#14181d", 0.4, 0.2));
  panel.position.set(0, deskTop + 0.09 + MON_H / 2, monZ);
  group.add(panel);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(MON_W * 0.93, MON_H * 0.9),
    new THREE.MeshBasicMaterial({ color: "#4a86b8", toneMapped: false }),
  );
  screen.position.set(0, deskTop + 0.09 + MON_H / 2, monZ + 0.019);
  group.add(screen);

  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.022, 0.19), body("#1b2026", 0.5, 0.3));
  foot.position.set(0, deskTop + 0.011, monZ + 0.02);
  group.add(foot);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.06), body("#1b2026", 0.5, 0.3));
  arm.position.set(0, deskTop + 0.07, monZ + 0.02);
  group.add(arm);

  // ---- 键盘：桌面靠人一侧 ----
  const kbZ = deskBack + (deskFront - deskBack) * 0.72;
  const keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.028, 0.19), body("#1c2126", 0.7, 0.1));
  keyboard.position.set(0, deskTop + 0.014, kbZ);
  group.add(keyboard);

  // 键帽：一排小方块，近看有细节
  const keyMat = body("#2b3238", 0.8, 0.05);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 13; c++) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.008, 0.03), keyMat);
      k.position.set(-0.26 + c * 0.043, deskTop + 0.032, kbZ - 0.06 + r * 0.038);
      group.add(k);
    }
  }

  // ---- 杯子：桌面右侧 ----
  if (fs.existsSync(MUG_SRC)) {
    const mugGltf = await load(MUG_SRC);
    const mug = normalize(mugGltf.scene, MUG_H);
    mug.position.x += MON_W / 2 + 0.22;
    mug.position.y += deskTop;
    mug.position.z = monZ + 0.26;
    group.add(mug);
  } else {
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, MUG_H, 16), body("#e8ecf0", 0.6));
    mug.position.set(MON_W / 2 + 0.22, deskTop + MUG_H / 2, monZ + 0.26);
    group.add(mug);
  }

  // ---- 导出 ----
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(group, { binary: true });
  fs.writeFileSync(DEST, Buffer.from(glb));
  console.log(`✓ ${path.relative(ROOT, DEST)}  ${(fs.statSync(DEST).size / 1024).toFixed(0)} KB`);

  group.updateMatrixWorld(true);
  const final = new THREE.Box3().setFromObject(group);
  const sz = final.getSize(new THREE.Vector3());
  console.log(
    `包围盒：${sz.x.toFixed(2)} × ${sz.y.toFixed(2)} × ${sz.z.toFixed(2)}  ` +
      `y ${final.min.y.toFixed(2)}→${final.max.y.toFixed(2)}`,
  );
}

main().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
