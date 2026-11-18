import * as THREE from "three";

/**
 * 双骨骼 IK 求解（肩 + 肘）
 *
 * 机械臂的链：
 *   肩关节 (shoulder)  ──上臂 L1──▶  肘 (elbow)  ──前臂 L2──▶  腕 (wrist) ──工具 T──▶ 夹爪
 *
 * 做法：
 *   1. 底座 yaw 对准目标方位角
 *   2. 在「竖直平面」里用余弦定理反解肩、肘两个俯仰角
 *
 * 约定（与 IndustrialArm 的关节朝向一致）：
 *   - 机械臂局部前方是 -Z
 *   - shoulder.rotation.x 为负 → 上臂倒向 -Z
 */

export const ARM = {
  /** 上臂长（肩到肘） */
  L1: 0.68,
  /** 前臂长（肘到腕） */
  L2: 0.6,
  /** 腕到夹爪中心 */
  TOOL: 0.22,
  /** 肩关节离地高度 */
  SHOULDER_Y: 0.4,
};

export type IkSolution = {
  yaw: number;
  shoulder: number;
  elbow: number;
  /** 腕或夹爪到目标还差多少（用于调试） */
  error: number;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * 求一个解，让夹爪末端碰到 worldTarget。
 *
 * @param base  底座世界坐标（机械臂落地点）
 * @param target 目标世界坐标（一般是货箱顶面中心）
 * @param reachable 若目标超出臂展，会自动收在可达边界上
 */
export function solveArmIk(base: THREE.Vector3, target: THREE.Vector3): IkSolution {
  const dx = target.x - base.x;
  const dz = target.z - base.z;
  const h = Math.hypot(dx, dz);

  // 底座 yaw：让局部 -Z 指向目标
  const yaw = Math.atan2(-dx, -dz);

  // 目标在竖直平面里的坐标（水平距离 h，竖直落差 v）
  const v = target.y - (base.y + ARM.SHOULDER_Y);

  // 夹爪要从腕再延伸 TOOL，先把「腕该到的点」算出来：
  // 假设夹爪竖直向下，则腕比目标高 TOOL
  const wristV = v + ARM.TOOL;

  const L = clamp(Math.hypot(h, wristV), Math.abs(ARM.L1 - ARM.L2) + 0.02, ARM.L1 + ARM.L2 - 0.02);

  // 余弦定理
  const cosShoulder = (ARM.L1 * ARM.L1 + L * L - ARM.L2 * ARM.L2) / (2 * ARM.L1 * L);
  const cosElbow = (ARM.L1 * ARM.L1 + ARM.L2 * ARM.L2 - L * L) / (2 * ARM.L1 * ARM.L2);

  const a1 = Math.acos(clamp(cosShoulder, -1, 1));
  const a2 = Math.acos(clamp(cosElbow, -1, 1));

  // 目标方位角：从「正上方」量起，朝 -Z 为正
  const baseAngle = Math.atan2(h, wristV);

  // 肩：上臂朝 -Z 倒 → 负角
  const shoulder = -(baseAngle - a1);
  // 肘：反向弯
  const elbow = -(Math.PI - a2);

  // 用正算验算末端位置，得到误差
  const err = forwardError(v, h, shoulder, elbow);

  return {
    yaw,
    shoulder,
    elbow,
    error: +err.toFixed(3),
  };
}

/** 正算末端位置，返回与实际目标的偏差 */
function forwardError(v: number, h: number, shoulder: number, elbow: number) {
  // 上臂方向
  const p1 = new THREE.Vector2(Math.sin(shoulder), Math.cos(shoulder)); // (z, y) 平面
  const e1: [number, number] = [-p1.x * ARM.L1, p1.y * ARM.L1]; // z 取负号：肩负角朝 -Z
  // 前臂方向 = 上臂方向再叠加肘角
  const total = shoulder + elbow;
  const p2 = new THREE.Vector2(Math.sin(total), Math.cos(total));
  const e2: [number, number] = [-p2.x * ARM.L2, p2.y * ARM.L2];
  // 工具竖直向下
  const ez = 0;
  const ey = -ARM.TOOL;

  const endZ = e1[0] + e2[0] + ez;
  const endY = e1[1] + e2[1] + ey;

  // 目标在 (z=-h, y=v)
  return Math.hypot(endZ - -h, endY - v);
}

/* ---------------------------------------------------------------- 旧接口（人物 IK，已停用） */

/** 人物手臂的骨骼对（当前场景不用人物，保留接口避免其它模块引用报错） */
export class ArmIKPair {
  ok = false;
  left = { ok: false, upper: null as any, fore: null as any, hand: null as any, handWorld: null as any };
  right = { ok: false, upper: null as any, fore: null as any, hand: null as any, handWorld: null as any };
  constructor(_root?: unknown) {}
  solve(..._args: unknown[]) { return 0; }
}

/** 烘焙姿势缓存（占位） */
export class BakedPose {
  save() {}
  restore() {}
}