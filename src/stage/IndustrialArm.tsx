import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { solveArmIk, ARM } from "./ik";
import { grab } from "./grabState";

/**
 * 工业机械臂（程序化，带真实关节）
 *
 *   底座 yaw ── 肩 pitch ── 上臂 ── 肘 pitch ── 前臂 ── 腕 ── 夹爪
 *
 * 动作是一个「取放」循环：俯身抓取 → 夹紧 → 抬起 → 横向移动 → 放下 → 松开
 * 每一段用 smoothstep 缓动，看起来像伺服电机到位。
 */

const DARK = new THREE.MeshStandardMaterial({ color: "#3a4048", metalness: 0.85, roughness: 0.32 });
const MID = new THREE.MeshStandardMaterial({ color: "#5a636e", metalness: 0.8, roughness: 0.4 });
const ORANGE = new THREE.MeshStandardMaterial({ color: "#e8892c", metalness: 0.5, roughness: 0.45 });
const STEEL = new THREE.MeshStandardMaterial({ color: "#aab4c0", metalness: 0.95, roughness: 0.2 });
const CABLE = new THREE.MeshStandardMaterial({ color: "#1a1e22", metalness: 0.2, roughness: 0.9 });
const LED = new THREE.MeshBasicMaterial({ color: "#5fd4ff", toneMapped: false });

/** 关节上的环形灯 */
function JointRing({ r = 0.075, color = LED }: { r?: number; color?: THREE.Material }) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[r, 0.008, 8, 24]} />
      <primitive object={color} attach="material" />
    </mesh>
  );
}

export function IndustrialArm({
  x,
  active,
  phase = 0,
  press = 0,
  target = null,
  lift = 0,
  z = 0.86,
  yawOffset = 0,
}: {
  x: number;
  active: boolean;
  phase?: number;
  /** 0..1：是否俯身去抓皮带上的货 */
  press?: number;
  /** 世界坐标目标点（可变对象，每帧读最新值）：给了就用 IK 反解 */
  target?: THREE.Vector3 | null;
  /** 抓取后抬升高度 */
  lift?: number;
  /** 底座在 z 方向的位置（传送带两侧） */
  z?: number;
  /** 整体朝向偏移：0 = 面向 -Z，Math.PI = 面向 +Z */
  yawOffset?: number;
}) {
  const baseYaw = useRef<THREE.Group>(null);
  const shoulder = useRef<THREE.Group>(null);
  const elbow = useRef<THREE.Group>(null);
  const wrist = useRef<THREE.Group>(null);
  const gripGroup = useRef<THREE.Group>(null);
  const gripL = useRef<THREE.Mesh>(null);
  const gripR = useRef<THREE.Mesh>(null);
  const t0 = useRef(0);
  const pressAmt = useRef(0);
  const rootRef = useRef<THREE.Group>(null);

  // 一个取放循环 = 5 段，每段时长（秒）
  const SEG = [0.75, 0.35, 0.65, 0.6, 0.5, 0.7];
  // 每段结束时的姿态 { yaw, sh, el, wr, grip }
  const POSE = [
    { yaw: -0.5, sh: 0.85, el: -1.1, wr: -0.5, grip: 0.075 }, // 俯身够到货
    { yaw: -0.5, sh: 0.85, el: -1.1, wr: -0.5, grip: 0.022 }, // 夹紧
    { yaw: -0.45, sh: 0.45, el: -0.7, wr: -0.35, grip: 0.022 }, // 抬起
    { yaw: 0.35, sh: 0.5, el: -0.75, wr: -0.4, grip: 0.022 }, // 横移到工位
    { yaw: 0.35, sh: 0.8, el: -1.0, wr: -0.5, grip: 0.022 }, // 放下
    { yaw: 0.3, sh: 0.5, el: -0.8, wr: -0.4, grip: 0.075 }, // 松开、回位
  ];

  useFrame(() => {
    const now = Date.now() / 1000;
    if (t0.current === 0) t0.current = now + phase;
    const speed = active ? 1 : 0.3;
    let elapsed = (now - t0.current) * speed;
    const total = SEG.reduce((a, b) => a + b, 0);
    if (elapsed < 0) elapsed = 0;
    const loop = elapsed % total;

    // 找到当前段和进度
    let acc = 0;
    let i = 0;
    for (; i < SEG.length; i++) {
      if (loop < acc + SEG[i]) break;
      acc += SEG[i];
    }
    const local = Math.min(1, (loop - acc) / SEG[i]);
    // smoothstep
    const e = local * local * (3 - 2 * local);
    const from = POSE[(i - 1 + POSE.length) % POSE.length];
    const to = POSE[i % POSE.length];
    const mix = (a: number, b: number) => a + (b - a) * e;

    // 抓取叠加：俯身到皮带上方的货
    pressAmt.current += ((press ? 1 : 0) - pressAmt.current) * 0.06;
    const pa = pressAmt.current;
    // 有目标点、且在臂展内才走 IK，否则回落到预设循环
    const reachLimit = ARM.L1 + ARM.L2 - 0.05;
    // 底座世界坐标（父组带偏移，不能用局部 x）
    const baseWorld = new THREE.Vector3();
    if (rootRef.current) rootRef.current.getWorldPosition(baseWorld);
    else baseWorld.set(x, 0, z);
    const shoulderWorld = new THREE.Vector3(baseWorld.x, baseWorld.y + ARM.SHOULDER_Y, baseWorld.z);
    if (x === 0) (window as unknown as Record<string, unknown>).__ikGate = { hasTarget: !!target, active, x, d: target ? +new THREE.Vector3(target.x, target.y + 0.06 + lift, target.z).distanceTo(shoulderWorld).toFixed(2) : -1, reachLimit: +reachLimit.toFixed(2) };
    const ikOk = target
      ? new THREE.Vector3(target.x, target.y + 0.06 + lift, target.z).distanceTo(shoulderWorld) < reachLimit
      : false;
    if (target && ikOk) {
      const base = baseWorld;
      const tgt = new THREE.Vector3(target.x, target.y + 0.06 + lift, target.z);
      const sol = solveArmIk(base, tgt);
      const k = 0.14; // 平滑跟随
      if (baseYaw.current) baseYaw.current.rotation.y += (sol.yaw - yawOffset - baseYaw.current.rotation.y) * k;
      if (shoulder.current) shoulder.current.rotation.x += (sol.shoulder - shoulder.current.rotation.x) * k;
      if (elbow.current) elbow.current.rotation.x += (sol.elbow - elbow.current.rotation.x) * k;
      if (wrist.current) wrist.current.rotation.x += (0 - wrist.current.rotation.x) * k;
      const g0 = mix(from.grip, to.grip);
      if (gripL.current) gripL.current.position.z = g0;
      if (gripR.current) gripR.current.position.z = -g0;
      // 把夹爪世界坐标交给抓取系统
      if (gripGroup.current && x === 0) {
        gripGroup.current.getWorldPosition(grab.grip);
        grab.ikActive = true;
      }
      return;
    }

    if (x === 0) grab.ikActive = false;
    if (baseYaw.current) baseYaw.current.rotation.y = mix(from.yaw, to.yaw) + pa * 0.45;
    if (shoulder.current) shoulder.current.rotation.x = -(mix(from.sh, to.sh) + pa * 0.85);
    if (elbow.current) elbow.current.rotation.x = -(mix(from.el, to.el) - pa * 0.45);
    if (wrist.current) wrist.current.rotation.x = mix(from.wr, to.wr) + pa * 0.45;
    const g = mix(from.grip, to.grip);
    if (gripL.current) gripL.current.position.z = g;
    if (gripR.current) gripR.current.position.z = -g;
  });

  return (
    <group ref={rootRef} name="ARM" position={[x, 0, z]} rotation={[0, yawOffset, 0]}>
      {/* ── 底座 ── */}
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.3, 0.34, 0.12, 28]} />
        <primitive object={DARK} attach="material" />
      </mesh>
      <mesh position={[0, 0.13, 0]}>
        <cylinderGeometry args={[0.26, 0.28, 0.05, 28]} />
        <primitive object={ORANGE} attach="material" />
      </mesh>

      {/* ── 回转体 ── */}
      <group ref={baseYaw} position={[0, 0.16, 0]}>
        <mesh position={[0, 0.11, 0]}>
          <cylinderGeometry args={[0.2, 0.23, 0.22, 24]} />
          <primitive object={MID} attach="material" />
        </mesh>
        <JointRing r={0.2} />

        {/* ── 肩 ── */}
        <group ref={shoulder} position={[0, 0.24, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.11, 0.11, 0.3, 20]} />
            <primitive object={DARK} attach="material" />
          </mesh>
          <mesh position={[0.16, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.09, 0.09, 0.03, 20]} />
            <primitive object={ORANGE} attach="material" />
          </mesh>

          {/* 上臂：朝上 */}
          <mesh position={[0, 0.34, 0]}>
            <cylinderGeometry args={[0.075, 0.09, 0.68, 18]} />
            <primitive object={MID} attach="material" />
          </mesh>
          {/* 上臂两侧的线束 */}
          <mesh position={[0.085, 0.34, 0.02]}>
            <cylinderGeometry args={[0.018, 0.018, 0.6, 8]} />
            <primitive object={CABLE} attach="material" />
          </mesh>

          {/* ── 肘 ── */}
          <group ref={elbow} position={[0, 0.68, 0]}>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.095, 0.095, 0.26, 20]} />
              <primitive object={DARK} attach="material" />
            </mesh>
            <JointRing r={0.105} />

            {/* 前臂 */}
            <mesh position={[0, 0.3, 0]}>
              <cylinderGeometry args={[0.055, 0.072, 0.6, 16]} />
              <primitive object={MID} attach="material" />
            </mesh>
            <mesh position={[0, 0.16, 0.07]}>
              <cylinderGeometry args={[0.014, 0.014, 0.42, 8]} />
              <primitive object={CABLE} attach="material" />
            </mesh>

            {/* ── 腕 ── */}
            <group ref={wrist} position={[0, 0.6, 0]}>
              <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.07, 0.07, 0.18, 16]} />
                <primitive object={DARK} attach="material" />
              </mesh>

              {/* 法兰 */}
              <mesh position={[0, 0.06, 0]}>
                <cylinderGeometry args={[0.075, 0.075, 0.05, 20]} />
                <primitive object={STEEL} attach="material" />
              </mesh>

              {/* 夹爪 */}
              <group ref={gripGroup} name="GRIP" position={[0, 0.12, 0]}>
                {[1, -1].map((s) => (
                  <mesh
                    key={s}
                    ref={s === 1 ? gripL : gripR}
                    position={[0, 0.05, s * 0.05]}
                  >
                    <boxGeometry args={[0.05, 0.14, 0.022]} />
                    <primitive object={STEEL} attach="material" />
                  </mesh>
                ))}
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
