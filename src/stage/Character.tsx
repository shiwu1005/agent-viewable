import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { ArmIKPair, BakedPose } from "./ik";
import { devRegister, devUnregister } from "../dev/devkit";
import { useGLTF } from "@react-three/drei";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

export const WORKER_URL = "/models/worker.glb";

/* ------------------------------------------------------------ 有没有模型 */

let probePromise: Promise<boolean> | null = null;

/** 只取前 4 字节验 GLB 魔数 —— 开发服务器会把未知路径回退成 index.html（也是 200） */
export function probeWorker(): Promise<boolean> {
  if (probePromise) return probePromise;
  probePromise = (async () => {
    try {
      const res = await fetch(WORKER_URL, { headers: { Range: "bytes=0-3" } });
      if (!res.ok) return false;
      const b = new Uint8Array(await res.arrayBuffer());
      return b.length >= 4 && b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46;
    } catch {
      return false;
    }
  })();
  return probePromise;
}

export function useWorkerAvailable() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    probeWorker().then((ok) => alive && setReady(ok));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

/* -------------------------------------------------------------- 动作解析 */

/**
 * retarget 出来的 clip 名字会被服务端改写成 animation_1..5，
 * 顺序与提交时的 animationIds 一致。这里把两者对应起来。
 */
const CLIP_ORDER = ["Idle_Loop", "Walk_Formal_Loop", "Interact", "Idle_FoldArms_Loop", "Fixing_Kneeling"];

/** worker-moves.glb 里的动作，顺序与 scripts/gen-moves.mjs 的 EXTRA 一致 */
const CLIP_ORDER_MOVES = [
  "Walk_Carry_Loop",
  "Sitting_Idle_Loop",
  "OverhandThrow",
  "Push_Loop",
  "PickUp_Table",
  "Idle_Talking_Loop",
  "Chest_Open",
  "Interact2",
];

export const MOVES_URL = "/models/worker-moves.glb";

let movesProbe: Promise<boolean> | null = null;
export function probeMoves(): Promise<boolean> {
  if (movesProbe) return movesProbe;
  movesProbe = (async () => {
    try {
      const res = await fetch(MOVES_URL, { headers: { Range: "bytes=0-3" } });
      if (!res.ok) return false;
      const b = new Uint8Array(await res.arrayBuffer());
      return b.length >= 4 && b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46;
    } catch {
      return false;
    }
  })();
  return movesProbe;
}

export function useMovesAvailable() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    probeMoves().then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, []);
  return ok;
}

/** 把两套 GLB 的动作按逻辑名合并 */
export function buildClipMap(base: THREE.AnimationClip[], extra?: THREE.AnimationClip[] | null) {
  const map: Record<string, THREE.AnimationClip> = {};
  CLIP_ORDER.forEach((name, i) => {
    const c = base?.[i] ?? base?.find((a) => a.name === `animation_${i + 1}`);
    if (c) map[name] = c;
  });
  if (extra) {
    CLIP_ORDER_MOVES.forEach((name, i) => {
      const c = extra[i];
      if (c) map[name] = c;
    });
  }
  return map;
}

function resolveClip(actions: Record<string, THREE.AnimationAction>, want: string) {
  if (!actions || Object.keys(actions).length === 0) return undefined;
  if (actions[want]) return actions[want];

  // 想要的没有就退到相近的
  const fallback: Record<string, string[]> = {
    Walk_Carry_Loop: ["Walk_Formal_Loop"],
    Sitting_Idle_Loop: ["Interact", "Idle_Loop"],
    OverhandThrow: ["Interact"],
    Push_Loop: ["Walk_Formal_Loop"],
    PickUp_Table: ["Fixing_Kneeling"],
    Idle_Talking_Loop: ["Idle_Loop"],
    Chest_Open: ["Interact"],
  };
  for (const alt of fallback[want] || []) if (actions[alt]) return actions[alt];

  const inc = Object.keys(actions).find((k) => k.toLowerCase().includes(want.toLowerCase().split("_")[0]));
  if (inc) return actions[inc];
  return Object.values(actions)[0];
}

/* ---------------------------------------------------------------- 模型本体 */

type GLTFResult = { scene: THREE.Group; animations: THREE.AnimationClip[] };

export type IkConfig = {
  /** 左手目标、右手目标（世界坐标） */
  points: [THREE.Vector3, THREE.Vector3];
  /** 肘部朝哪边弯的提示点 */
  pole: THREE.Vector3;
  /** 坐着时髋关节要落在多高（世界坐标 y）；不给就不做坐姿吸附 */
  seatY?: number;
};

type WorkerProps = {
  /** 位置清单里的名字，例如 char:main */
  devId?: string;
  /** 动作用一次还是循环 */
  loop?: "repeat" | "once";
  ik?: IkConfig | null;
  clip?: string;
  height?: number;
  angry?: boolean;
  hueShift?: number;
  /** 红温：拍电脑 */
  slamOn?: boolean;
  slamStart?: number;
  /** 身份外观：眼镜 / 耳麦 / 帽子 / 挎包 */
  look?: "think" | "reception" | "worker" | "courier";
  tint?: string;
  prop?: string;
  mirror?: boolean;
};

function WithMoves(props: WorkerProps) {
  const base = useGLTF(WORKER_URL);
  const extra = useGLTF(MOVES_URL);
  return <Core {...props} base={base as unknown as GLTFResult} extra={extra as unknown as GLTFResult} />;
}

function WithoutMoves(props: WorkerProps) {
  const base = useGLTF(WORKER_URL);
  return <Core {...props} base={base as unknown as GLTFResult} extra={null} />;
}

export function WorkerModel(props: WorkerProps) {
  const hasMoves = useMovesAvailable();
  return hasMoves ? <WithMoves {...props} /> : <WithoutMoves {...props} />;
}


const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

/**
 * 一个可动的角色实例。
 * 每次实例化都克隆骨骼（SkeletonUtils.clone），否则多个小人会共享同一套骨骼。
 */
function Core({
  base,
  extra,
  ik,
  devId,
  clip = "Idle_Loop",
  height = 1.35,
  angry = false,
  hueShift,
  tint,
  prop,
  look,
  slamOn = false,
  slamStart = 0,
  mirror = false,
}: WorkerProps & { base: GLTFResult; extra: GLTFResult | null }) {
  const scene = base.scene;
  const clipMap = useMemo(() => buildClipMap(base.animations, extra?.animations), [base, extra]);

  const prepared = useMemo(() => {
    const root = cloneSkeleton(scene) as THREE.Object3D;
    root.updateWorldMatrix(true, true);

    // 归一化：脚踩地、居中、缩放到目标身高
    _box.setFromObject(root);
    _box.getSize(_size);
    _box.getCenter(_center);
    const s = height / Math.max(_size.y, 1e-4);

    // 关键：SkeletonUtils.clone 默认**共享材质**。
    // 如果在这里直接改 color/emissive，多个小人会互相叠加，越乘越灰。
    // 所以每个实例先把材质克隆一份。
    const mats: THREE.MeshStandardMaterial[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false;

      const list = Array.isArray(m.material) ? m.material : [m.material];
      const cloned = list.map((mm) => (mm as THREE.Material).clone());
      m.material = Array.isArray(m.material) ? cloned : cloned[0];

      for (const mm of cloned) {
        const std = mm as THREE.MeshStandardMaterial;
        if (!std) continue;
        if (hueShift && std.color) std.color.offsetHSL(hueShift, 0, 0);
        if (tint && std.color) {
          // color 是乘数，白色=不改。从白色往目标色靠 30% 只加一层淡色
          const target = new THREE.Color("#ffffff").lerp(new THREE.Color(tint), 0.3);
          std.color.multiply(target);
        }
        if (std.emissive) mats.push(std);
      }
    });

    return { root, s, mats, offset: new THREE.Vector3(-_center.x, -_box.min.y, -_center.z) };
  }, [scene, height, hueShift, tint]);

  // 彩色领巾：整模只有一套材质贴图，改不了"衣服"，
  // 就给它加一条不依赖骨骼的围巾 —— 位置固定，变形也看不出来。
  // 手里的道具：直接挂到右手骨骼上，会跟着动作走
  useEffect(() => {
    if (!prop) return;
    // three.js 的 GLTFLoader 会把节点名里的冒号去掉：
    // mixamorig:RightHand → mixamorigRightHand，两种都试一遍
    const hand =
      prepared.root.getObjectByName("mixamorigRightHand") ||
      prepared.root.getObjectByName("mixamorig:RightHand") ||
      prepared.root.getObjectByName("mixamorigLeftHand") ||
      prepared.root.getObjectByName("mixamorig:LeftHand");
    if (!hand) return;

    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.34, 0.18),
      new THREE.MeshStandardMaterial({ color: prop, emissive: prop, emissiveIntensity: 0.5, toneMapped: false }),
    );
    m.name = "__prop";
    m.position.set(0, -0.06, 0.12);
    hand.add(m);
    return () => {
      hand.remove(m);
    };
  }, [prop, prepared.root]);

  // 身份配饰：挂到头部骨骼上，跟着动作走
  useEffect(() => {
    if (!look) return;
    const head =
      prepared.root.getObjectByName("mixamorigHead") ||
      prepared.root.getObjectByName("mixamorig:Head") ||
      prepared.root.getObjectByName("Head");
    if (!head) return;

    // 骨骼空间是模型单位。用模型的缩放系数换算成米，
    // 不能读骨骼世界矩阵 —— 那时可能还没更新，读到 1 就缩成毫米级。
    const k = 1 / (prepared.s || 1);

    const g = new THREE.Group();
    g.name = "__look";
    let spinePatch: THREE.Mesh | null = null;
    const dark = new THREE.MeshStandardMaterial({ color: "#22282f", roughness: 0.5, metalness: 0.2 });
    const accent = new THREE.MeshStandardMaterial({ color: "#c9d4de", roughness: 0.6 });

    // 骨骼的局部轴不一定是"Y 朝上"，直接摆会歪。
    // 把配饰组反旋到世界朝向，之后就能按"Y 上、-Z 朝前"摆。
    prepared.root.updateWorldMatrix(true, true);
    const wq = new THREE.Quaternion();
    head.getWorldQuaternion(wq);
    g.quaternion.copy(wq).invert();

    if (look === "think") {
      // 毛线帽
      const beanie = new THREE.Mesh(
        new THREE.SphereGeometry(0.15 * k, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
        new THREE.MeshStandardMaterial({ color: "#31506b", roughness: 0.92 }),
      );
      beanie.position.set(0, 0.17 * k, 0);
      g.add(beanie);
      // 眼镜
      for (const sx of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.038 * k, 0.006 * k, 8, 20), dark);
        ring.position.set(sx * 0.052 * k, 0.16 * k, -0.13 * k);
        g.add(ring);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.02 * k, 0.008 * k, 0.008 * k), dark);
      bridge.position.set(0, 0.165 * k, -0.135 * k);
      g.add(bridge);
    } else if (look === "reception") {
      // 耳麦
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.1 * k, 0.011 * k, 8, 24, Math.PI), dark);
      band.position.set(0, 0.16 * k, 0);
      g.add(band);
      for (const sx of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.032 * k, 0.032 * k, 0.022 * k, 14), dark);
        cup.position.set(sx * 0.14 * k, 0.15 * k, 0);
        cup.rotation.z = Math.PI / 2;
        g.add(cup);
      }
      const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.006 * k, 0.006 * k, 0.09 * k, 8), accent);
      mic.position.set(0.12 * k, 0.12 * k, -0.09 * k);
      mic.rotation.set(0.5, 0, -0.6);
      g.add(mic);
    } else {
      // 鸭舌帽：帽身 + 帽檐（帽檐朝前 = -Z）
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15 * k, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), dark);
      dome.position.set(0, 0.16 * k, 0);
      g.add(dome);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.16 * k, 0.012 * k, 0.09 * k), dark);
      brim.position.set(0, 0.165 * k, -0.15 * k);
      g.add(brim);
      if (look === "courier") {
        const bag = new THREE.Mesh(new THREE.BoxGeometry(0.17 * k, 0.13 * k, 0.07 * k), dark);
        bag.position.set(0.17 * k, -0.55 * k, -0.04 * k);
        g.add(bag);
      }
    }

    // 背面标识：镜头一直在人背后，脸前的东西看不见
    const spine =
      prepared.root.getObjectByName("mixamorigSpine1") ||
      prepared.root.getObjectByName("mixamorigSpine2") ||
      prepared.root.getObjectByName("mixamorigSpine");
    if (spine) {
      const sq = new THREE.Quaternion();
      spine.getWorldQuaternion(sq);
      const patch = new THREE.Mesh(new THREE.BoxGeometry(0.19 * k, 0.22 * k, 0.02 * k), accent);
      patch.position.set(0, 0.1 * k, 0.12 * k);
      patch.quaternion.copy(sq).invert();
      spine.add(patch);
      spinePatch = patch;
    }

    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    head.add(g);
    return () => {
      head.remove(g);
      if (spinePatch) spinePatch.parent?.remove(spinePatch);
    };
  }, [look, prepared.root]);

  // 调试用：?forceClip=animation_2 会覆盖所有角色播同一个动作
  const forced = typeof location !== "undefined" ? new URLSearchParams(location.search).get("forceClip") : null;

  const mixer = useMemo(() => new THREE.AnimationMixer(prepared.root), [prepared.root]);
  const actions = useRef<Record<string, THREE.AnimationAction>>({});
  const current = useRef<THREE.AnimationAction | null>(null);
  const angryUntil = useRef(0);
  const outerRef = useRef<THREE.Group>(null);
  const hipsRef = useRef<THREE.Bone | null>(null);
  const _hipsW = new THREE.Vector3();

  // 手臂 IK：动作播完再把手腕掰到目标上
  const ikRef = useRef<{ rig: ArmIKPair; ready: boolean } | null>(null);
  const bakedRef = useRef(new BakedPose());
  const slamRef = useRef({ on: false, start: 0 });
  slamRef.current = { on: slamOn, start: slamStart };
  const bakeTick = useRef(0);
  const wantIK = !!ik;
  useEffect(() => {
    // 找髋骨，用来把屁股吸到坐垫上
    prepared.root.traverse((o) => {
      const b = o as THREE.Bone;
      if (!hipsRef.current && (b as unknown as { isBone?: boolean }).isBone && /hips/i.test(b.name)) {
        hipsRef.current = b;
      }
    });
    (window as unknown as Record<string, unknown>).__workerLoaded = true;

    // 登记进位置清单，探针才量得到这个角色
    if (devId) devRegister(devId, "character", outerRef.current);
    const myId = devId;

    if (!wantIK) {
      const dbg = ((window as unknown as Record<string, unknown>).__ikDbg ||= {}) as Record<string, unknown>;
      dbg[devId ?? "?"] = { built: false };
      return;
    }
    // 纯 CCD，不往骨架里插东西，录制模式也能用
    const pair = new ArmIKPair(prepared.root);
    ikRef.current = { rig: pair, ready: pair.ok };
    const dbg2 = ((window as unknown as Record<string, unknown>).__ikDbg ||= {}) as Record<string, unknown>;
    dbg2[devId ?? "?"] = { built: pair.ok, l: pair.left.ok, r: pair.right.ok };
    return () => {
      ikRef.current = null;
    };
  }, [prepared.root, wantIK]);

  useEffect(() => {
    const map: Record<string, THREE.AnimationAction> = {};
    for (const [name, clipData] of Object.entries(clipMap)) {
      map[name] = mixer.clipAction(clipData as THREE.AnimationClip);
    }
    actions.current = map;
    (window as unknown as { __clips?: string[] }).__clips = Object.keys(map);
    current.current = null;
    return () => {
      mixer.stopAllAction();
    };
  }, [mixer, clipMap]);
  useEffect(() => {
    const next = resolveClip(actions.current, forced || clip);
    if (!next || next === current.current) return;
    if (current.current) {
      current.current.fadeOut(0.22);
      next.reset().setEffectiveWeight(1).fadeIn(0.22).play();
    } else {
      // 第一下直接满权重，别留出 bind pose 的帧
      next.reset().setEffectiveWeight(1).play();
    }
    current.current = next;
  }, [clip, forced]);

  // 出错 → 整个身子红一下（比只红脸更明显）
  useEffect(() => {
    if (angry) angryUntil.current = Date.now() + 2600;
  }, [angry]);

  useFrame((_, dt) => {
    mixer.update(Math.min(dt, 0.1));

    // 动画跑完再做 IK，否则会被这一帧的动画覆盖
    const entry = ikRef.current;
    if (entry && entry.ready && ik && ik.points) {
      // 坐姿：把髋关节吸到坐垫高度，不受动作自带根位移影响
      if (ik.seatY !== undefined && hipsRef.current && outerRef.current) {
        hipsRef.current.getWorldPosition(_hipsW);
        const err = ik.seatY - _hipsW.y;
        if (Number.isFinite(err)) {
          outerRef.current.position.y = THREE.MathUtils.clamp(
            outerRef.current.position.y + err * 0.5,
            -1.5,
            1.5,
          );
          outerRef.current.updateWorldMatrix(false, true);
        }
      }
      try {
        const sl = slamRef.current;
        if (sl.on) {
          // 红温拍桌：举过头 → 高举停顿 → 猛砸下去 → 压住不动
          const t = (Date.now() - sl.start) / 1000;
          const T = 1.05; // 一拍 1.05 秒
          const cyc = (t % T) / T;

          // 桌面目标（原始位置）
          const base = ik.points[0].clone();
          const baseR = ik.points[1].clone();

          // 举高目标：手腕抬到肩膀以上，离身体近一点
          const up = base.clone();
          up.y = base.y + 0.72;
          up.z = base.z + 0.16;
          const upR = baseR.clone();
          upR.y = baseR.y + 0.7;
          upR.z = baseR.z + 0.16;

          let k: number; // 0 = 桌面，1 = 高举
          if (cyc < 0.42) {
            // 抬起：缓入，显得有蓄力
            const u = cyc / 0.42;
            k = u * u * (3 - 2 * u);
          } else if (cyc < 0.58) {
            // 举着停一下
            k = 1;
          } else if (cyc < 0.68) {
            // 砸下来：三帧之内到底
            const u = (cyc - 0.58) / 0.1;
            k = 1 - u * u;
          } else {
            // 压在桌上不动
            k = 0;
          }

          const p = base.clone().lerp(up, k);
          const q = baseR.clone().lerp(upR, k);
          // 砸到底的那一刻权重拉满，让动作有冲击
          const snap = cyc >= 0.58 && cyc < 0.72 ? 1 : 0.85;
          entry.rig.solve(p, q, 22, 1);

          // 上半身跟着前倾：砸下去的时候身体也压下去
          if (outerRef.current) {
            outerRef.current.rotation.x = k * 0.05 + (cyc > 0.58 && cyc < 0.8 ? 0.07 : 0);
          }
        } else {
          if (outerRef.current) outerRef.current.rotation.x = 0;
          // 平时：手落在目标上，但要加打字抖动，
          // 否则 IK 把手钉死，人看起来就僵住了
          // 用 Date.now：capture 模式会把虚拟时间写进去，帧序列可复现
          const t = Date.now() / 1000;
          const p = ik.points[0].clone();
          const q = ik.points[1].clone();
          p.x += Math.sin(t * 7.3) * 0.09;
          p.y += Math.abs(Math.sin(t * 9.1)) * 0.065;
          p.z += Math.cos(t * 5.7) * 0.02;
          q.x += Math.sin(t * 6.1 + 1.4) * 0.09;
          q.y += Math.abs(Math.sin(t * 8.3 + 2.1)) * 0.065;
          q.z += Math.cos(t * 4.9 + 0.8) * 0.02;
          // 每帧动画都会重置骨骼，所以这里必须满修正，
          // 只修 35% 的话手永远停在半路（实测差 23 厘米）
          entry.rig.solve(p, q, 18, 1);
        }
      } catch (e) {
        // IK 出问题就把它关掉，绝不能连累整个场景渲染
        entry.ready = false;
        (window as unknown as Record<string, unknown>).__ikError = String(e);
      }

      const dbg = ((window as unknown as Record<string, unknown>).__ikRun || { n: 0 }) as {
        n: number;
        dL?: number;
        dR?: number;
        hipsY?: number;
      };
      dbg.n += 1;
      if (dbg.n % 20 === 0) {
        const hl = entry.rig.left.handWorld(new THREE.Vector3());
        const hr = entry.rig.right.handWorld(new THREE.Vector3());
        dbg.dL = hl.distanceTo(ik.points[0]);
        dbg.dR = hr.distanceTo(ik.points[1]);
        if (hipsRef.current) {
          hipsRef.current.getWorldPosition(_hipsW);
          dbg.hipsY = _hipsW.y;
        }
      }
      (window as unknown as Record<string, unknown>).__ikRun = dbg;
    }

    const on = Date.now() < angryUntil.current;
    for (const m of prepared.mats) {
      m.emissive.setRGB(on ? 0.55 : 0, 0, 0);
      m.emissiveIntensity = on ? 1 : 0;
    }
  });

  return (
    <group ref={outerRef} scale={[mirror ? -prepared.s : prepared.s, prepared.s, prepared.s]}>
      <primitive object={prepared.root} position={prepared.offset} />
    </group>
  );
}
