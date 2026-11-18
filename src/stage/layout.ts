import * as THREE from "three";

/** 房间与工位的固定坐标，场景和道具共用，避免两个文件各写一套 */

export const DOOR = new THREE.Vector3(-4.62, 0, -1.1);
export const DOOR_OUT = new THREE.Vector3(-5.6, 0, -1.1);

/** 主智能体的工位（0 号） */
export const DESK = new THREE.Vector3(0.4, 0, -1.9);
export const DESK_BACK = new THREE.Vector3(0.4, 0, -0.95);

/** 被叫去审批时站的位置 */
export const APPROVAL_SPOT = new THREE.Vector3(-3.6, 0, 0.6);

/** 小人的工位：围着主桌散开，不挡镜头 */
export const SLOTS: [number, number][] = [
  [-3.3, -0.5],
  [-2.7, 1.0],
  [2.9, -0.7],
  [3.2, 0.6],
  [-1.7, -3.3],
  [0.4, -3.5],
  [1.4, -4.4],
];

/** 每个小人一种标记色（编号牌 + 地垫） */
export const AGENT_TAG = ["#e8574a", "#e8a33d", "#5fb8e8", "#7bc96f", "#b07be0", "#e07bb0", "#4fd1c5"];

/** 房间尺寸：一个人干活的小房间 */
export const ROOM = {
  w: 9.4,
  d: 8,
  h: 3.4,
  backZ: -4.0,
  leftX: -4.7,
  rightX: 4.7,
};
