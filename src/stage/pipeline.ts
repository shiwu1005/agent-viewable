import * as THREE from "three";

/**
 * 四段流水线：接单 → 思考 → 执行 → 交付。
 *
 * 一个人在小房间里按顺序走到四个工位，
 * 手里那张发光的"任务卡"跟着他一路传下去。
 */

export type Stage = "idle" | "receive" | "think" | "execute" | "deliver";

export const STAGE_ORDER: Stage[] = ["receive", "think", "execute", "deliver"];

export const STAGE_LABEL: Record<Stage, string> = {
  idle: "待命",
  receive: "接单",
  think: "思考",
  execute: "执行",
  deliver: "交付",
};

/** 四个工位站的位置（房间内） */
export const STATION_POS: Record<Exclude<Stage, "idle">, THREE.Vector3> = {
  // 左边：接单
  receive: new THREE.Vector3(-2.7, 0, -0.9),
  // 左后：看着白板思考
  think: new THREE.Vector3(-2.7, 0, -3.3),
  // 中间：主桌前执行
  execute: new THREE.Vector3(0.4, 0, -1.42),
  // 右边：交付口
  deliver: new THREE.Vector3(2.9, 0, -0.9),
};

/** 每个工位朝向（弧度） */
export const STATION_YAW: Record<Exclude<Stage, "idle">, number> = {
  receive: -Math.PI / 2,
  think: Math.PI,
  execute: Math.PI,
  deliver: Math.PI / 2,
};

/** 到站后播什么动作 */
export const STATION_CLIP: Record<Exclude<Stage, "idle">, string> = {
  receive: "Interact",
  think: "Idle_FoldArms_Loop",
  execute: "Sitting_Idle_Loop",
  deliver: "OverhandThrow",
};

/**
 * 每段动作拆成三拍：开场 → 持续 → 收尾。
 * 片段都是"只播一次"，播完停在最后一帧，所以不会看到循环。
 */
export const STAGE_BEATS: Record<
  Exclude<Stage, "idle">,
  { intro: string; hold: string[]; outro: string }
> = {
  // hold 是一个池子：持续阶段在几种工作动作里轮换，避免看出循环节拍
  receive: { intro: "Interact", hold: ["Interact", "Idle_Talking_Loop"], outro: "Idle_Loop" },
  think: { intro: "Idle_Talking_Loop", hold: ["Idle_FoldArms_Loop", "Interact", "Idle_Talking_Loop"], outro: "Interact" },
  // 执行阶段只用「手在身前操作」的动作，这样不靠 IK 也能对上桌面
  execute: { intro: "Chest_Open", hold: ["Interact"], outro: "Idle_Loop" },
  // 交付不投掷：抛掷动作前倾太大，会埋进交付台
  // 收尾不能用走路动作：人在原地"走"，看起来就是往前飘
  deliver: { intro: "Interact", hold: ["Interact"], outro: "Idle_Loop" },
};