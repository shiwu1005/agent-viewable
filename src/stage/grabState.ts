import * as THREE from "three";

/**
 * 抓取状态：机械臂夹爪与货之间唯一的通信点
 *
 *   夹爪每帧写入自己的世界坐标 → 货读它来决定「是否被拿起来」
 */
export const grab = {
  /** 夹爪世界坐标（由 IndustrialArm 每帧写） */
  grip: new THREE.Vector3(),
  /** 夹爪是否处于 IK 抓取模式 */
  ikActive: false,
  /** 货是否已被抓住 */
  held: false,
  /** 抓起后抬升的高度（0..1） */
  lift: 0,
  /** 抬起到位后的停留计时 */
  releaseT: 0,
};

// 便于调试观察
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__grab = grab;
}

export const resetGrab = () => {
  grab.held = false;
  grab.lift = 0;
  grab.releaseT = 0;
};
