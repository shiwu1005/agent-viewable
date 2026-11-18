import { useEffect, useState } from "react";
import * as THREE from "three";

/* ------------------------------------------------------- 角色位置共享表 */

/**
 * 角色位置是每个组件在自己的 useFrame 里算的，
 * 镜头要跟随就必须能读到 —— 用一个模块级表当黑板。
 */
export const positions = new Map<string, THREE.Vector3>();

export function setPos(key: string, v: THREE.Vector3) {
  const e = positions.get(key);
  if (e) e.copy(v);
  else positions.set(key, v.clone());
}

export function getPos(key: string): THREE.Vector3 | undefined {
  return positions.get(key);
}

export function clearPos(prefix: string) {
  for (const k of [...positions.keys()]) if (k.startsWith(prefix)) positions.delete(k);
}

/* ------------------------------------------------------------ 真实时间 */

/** 每 20 秒读一次真实时钟 */
export function useRealClock(intervalMs = 20000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export type SkyPhase = "dawn" | "day" | "dusk" | "night";

export function skyPhaseOf(d: Date): SkyPhase {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 5 && h < 8.5) return "dawn";
  if (h >= 8.5 && h < 17) return "day";
  if (h >= 17 && h < 19.5) return "dusk";
  return "night";
}

/** 各时段的环境光强度与色温 */
export const SKY_MOOD: Record<SkyPhase, { ambient: number; tint: string; window: string; label: string }> = {
  dawn: { ambient: 1.15, tint: "#d8d2e4", window: "#e8a978", label: "清晨" },
  day: { ambient: 1.75, tint: "#e6eefc", window: "#bfe0ff", label: "白天" },
  dusk: { ambient: 1.35, tint: "#e0cfc4", window: "#ff9e6b", label: "黄昏" },
  night: { ambient: 1.05, tint: "#b9c6dd", window: "#7fb0e8", label: "深夜" },
};
