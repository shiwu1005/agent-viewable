import { create } from "zustand";
import { TUNING } from "./tuning";

/**
 * 实时调参（不写回代码）。
 *
 * 面板上改的值存在这里，场景每帧读这里，所以拖动即时生效。
 * 调好之后把 JSON 复制出来，回填到 tuning.ts 就固化了。
 */

export type RoomTune = { xOff: number; z: number; clip: string };

const DEFAULT_ROOMS: Record<string, RoomTune> = {
  receive: { xOff: TUNING.stations.receive.xOff, z: TUNING.stations.receive.z, clip: "Interact" },
  think: { xOff: TUNING.stations.think.xOff, z: TUNING.stations.think.z, clip: "Idle_FoldArms_Loop" },
  execute: { xOff: TUNING.stations.execute.xOff, z: TUNING.stations.execute.z, clip: "Idle_Loop" },
  deliver: { xOff: TUNING.stations.deliver.xOff, z: TUNING.stations.deliver.z, clip: "Interact" },
};

export const CLIPS = [
  "Idle_Loop",
  "Interact",
  "Interact2",
  "Idle_FoldArms_Loop",
  "Idle_Talking_Loop",
  "Sitting_Idle_Loop",
  "Chest_Open",
  "PickUp_Table",
  "OverhandThrow",
  "Push_Loop",
  "Fixing_Kneeling",
] as const;

type CamTune = {
  xOff: number;
  y: number;
  z: number;
  fov: number;
  /** 绕当前房间的水平角（弧度），鼠标拖动改它 */
  yaw: number;
  /** 俯仰角（弧度） */
  pitch: number;
};

type TuneState = {
  rooms: Record<string, RoomTune>;
  cam: CamTune;
  selected: string;
  setRoom: (key: string, patch: Partial<RoomTune>) => void;
  setCam: (patch: Partial<CamTune>) => void;
  select: (key: string) => void;
  reset: () => void;
  snapshot: () => string;
};

const WIN = window as unknown as { __TUNE?: { rooms: Record<string, RoomTune>; cam: CamTune } };
if (!WIN.__TUNE) {
  WIN.__TUNE = { rooms: JSON.parse(JSON.stringify(DEFAULT_ROOMS)), cam: { xOff: TUNING.camera.xOff, y: TUNING.camera.y, z: TUNING.camera.z, fov: TUNING.camera.fov, yaw: 0, pitch: 0.18 } };
}

export const useTune = create<TuneState>((set, get) => ({
  rooms: WIN.__TUNE!.rooms,
  cam: WIN.__TUNE!.cam,
  selected: "execute",
  setRoom: (key, patch) => {
    const next = { ...WIN.__TUNE!.rooms[key], ...patch };
    WIN.__TUNE!.rooms[key] = next;
    set((s) => ({ rooms: { ...s.rooms, [key]: next } }));
  },
  setCam: (patch) => {
    Object.assign(WIN.__TUNE!.cam, patch);
    set((s) => ({ cam: { ...WIN.__TUNE!.cam } }));
  },
  select: (key) => set({ selected: key }),
  reset: () => set({ rooms: JSON.parse(JSON.stringify(DEFAULT_ROOMS)) }),
  snapshot: () => {
    const s = get();
    return JSON.stringify({ rooms: s.rooms, cam: s.cam }, null, 2);
  },
}));
