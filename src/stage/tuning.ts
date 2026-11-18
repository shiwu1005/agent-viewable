/**
 * 场景调参表 —— 想改位置、动作、比例，改这一个文件就行。
 *
 * 单位：米 / 秒
 * 改完保存，浏览器会自动刷新。
 */

export const TUNING = {
  /* ---------------------------------------------------------- 房间 */
  room: {
    width: 2.9,
    depth: 3.0,
    height: 2.7,
    gap: 0.45,
  },

  /* ---------------------------------------------------------- 人 */
  worker: {
    height: 1.55,
    /** 进/出场走路速度（进度/秒），越大越快 */
    walkSpeed: 0.85,
    /** 进场用多久定格到工位（毫秒） */
    enterMs: 1300,
    exitMs: 1100,
    /** 呼吸起伏幅度 */
    breathe: 0.012,
    breatheSpeed: 1.6,
    /** 打字节奏起伏 */
    typingBob: 0.022,
    typingSpeed: 5.5,
  },

  /* ---------------------------------------------------------- 门口与走位 */
  door: {
    /** 门相对房间中心的 x 偏移 */
    x: -1.02,
    /** 门所在 z（后墙内表面稍前） */
    z: -1.44,
    width: 0.86,
    height: 2.05,
    /** 开门角度（弧度），负值向内开 */
    openAngle: -1.83,
    /** 开合速度 */
    speed: 6,
  },

  /**
   * 进门路线：门 → 沿墙 → 桌前 → 工位
   * 顺序不能乱，否则会穿过桌子
   */
  walk: {
    /** 绕过桌子时先走到这个 z（越大越靠镜头） */
    frontZ: 0.15,
  },

  /**
   * 每个房间：人在哪站、播什么动作
   * z    站位（房间中心为 0，越负越靠后墙）
   * xOff 相对房间中心的横向偏移
   */
  stations: {
    receive: { xOff: -0.35, z: -0.8, look: "reception" as const },
    think: { xOff: -0.4, z: -1.0, look: "think" as const },
    execute: { xOff: 0, z: -0.46, look: "worker" as const },
    deliver: { xOff: 0, z: -0.25, look: "courier" as const },
  },

  /**
   * 三拍动作：开场 / 持续（可轮换） / 收尾
   * 片段名必须来自动作库，见 scripts/probe-anims.mjs
   */
  beats: {
    receive: { intro: "Interact", hold: ["Interact", "Idle_Talking_Loop"], outro: "Idle_Loop" },
    think: { intro: "Idle_Talking_Loop", hold: ["Idle_FoldArms_Loop", "Interact"], outro: "Interact" },
    execute: { intro: "Interact", hold: ["Interact"], outro: "Idle_Loop" },
    deliver: { intro: "Interact", hold: ["Interact"], outro: "Idle_Loop" },
  },

  /** 开场 / 收尾各占多久（秒） */
  beatTiming: { introSec: 1.1, outroSec: 0.9 },

  /** 红温时的动作和持续时间 */
  rage: {
    clip: "OverhandThrow",
    ms: 2300,
    /** 镜头钉在执行房的时长 */
    pinMs: 2400,
  },

  /** 执行房：键盘位置（相对房间中心） */
  desk: {
    x: 0,
    z: -0.95,
    topY: 1.0,
    keyboardY: 1.017,
    keyboardZ: -0.72,
  },

  /** 相机：3/4 侧后方近景 */
  camera: {
    xOff: 1.15,
    y: 2.08,
    z: 4.35,
    lookAtY: 1.02,
    lookAtZ: -0.95,
    fov: 38,
    /** 跟随速度，越大切换房间越快 */
    follow: 6.5,
  },
};
