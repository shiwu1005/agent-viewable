import * as THREE from "three";

/**
 * 开发工具集：调试机位 + 数值探针 + 位置清单。
 *
 * 规则：改任何数字之前，先用这里量。不要靠截图猜。
 */

/* ------------------------------------------------------------ 调试机位 */

export type CamPreset = { pos: [number, number, number]; look: [number, number, number] };

export const CAM_PRESETS: Record<string, CamPreset> = {
  // 全景（正式镜头）
  wide: { pos: [2.9, 3.1, 6.0], look: [-0.2, 0.9, -1.8] },
  // 主桌侧面：看人和椅子的关系
  desk: { pos: [1.7, 1.15, 0.15], look: [0.35, 0.8, -1.7] },
  // 主桌正侧（更平，看有没有穿进桌子）
  deskside: { pos: [1.9, 0.95, -1.0], look: [0.4, 0.8, -1.3] },
  // 门口：看小人进出
  door: { pos: [-1.4, 1.45, 1.9], look: [-4.4, 0.95, -1.0] },
  // 流水线全景：同时框住四个工位
  pipe: { pos: [2.0, 3.0, 5.9], look: [-0.2, 0.8, -1.9] },
  // 休息区
  lounge: { pos: [1.2, 1.9, 4.6], look: [-2.2, 0.6, 2.2] },
};

export const CAM_KEYS = Object.keys(CAM_PRESETS);

/** ?cam=desk 指定机位；返回 null 表示用默认运镜 */
export function readCamPreset(): CamPreset | null {
  const name = new URLSearchParams(location.search).get("cam");
  if (!name) return null;
  return CAM_PRESETS[name] ?? null;
}

/* ------------------------------------------------------------ 登记表 */

export type DevEntry = {
  id: string;
  kind: string;
  obj: THREE.Object3D;
};

const registry = new Map<string, DevEntry>();

/** 硬切机位：设了就每帧把相机钉死在这里，不走运镜 */
let hardCam: CamPreset | null = null;
export function setHardCam(p: CamPreset | null) {
  hardCam = p;
}
export function getHardCam() {
  return hardCam;
}

/** 把一个物体登记进位置清单（组件里调用） */
export function devRegister(id: string, kind: string, obj: THREE.Object3D | null | undefined) {
  if (!obj) return;
  registry.set(id, { id, kind, obj });
}

export function devUnregister(id: string) {
  registry.delete(id);
}

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

function boxOf(obj: THREE.Object3D) {
  _box.setFromObject(obj);
  const size = _box.getSize(new THREE.Vector3());
  const center = _box.getCenter(new THREE.Vector3());
  const clean = (v: number) => Math.round(v * 1000) / 1000;
  return {
    min: _box.min.toArray().map(clean),
    max: _box.max.toArray().map(clean),
    size: size.toArray().map(clean),
    center: center.toArray().map(clean),
  };
}

/** 两个包围盒在 XZ 平面上重叠多少（米），负值 = 间距 */
function xzOverlap(a: THREE.Box3, b: THREE.Box3) {
  const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const oz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  return { x: +ox.toFixed(3), z: +oz.toFixed(3), overlap: ox > 0 && oz > 0 };
}

/* ------------------------------------------------------------ 探针 */

export type ProbeReport = {
  time: string;
  objects: Record<string, { kind: string; center: number[]; size: number[]; y: number[] }>;
  overlaps: { a: string; b: string; x: number; z: number }[];
  characters: {
    id: string;
    position: number[];
    hipsY?: number;
    scale: number[];
  }[];
};

/** 量一遍场景，返回结构化数据（不截图也能判断对错） */
export function probe(): ProbeReport {
  const objects: ProbeReport["objects"] = {};
  const boxes: { id: string; box: THREE.Box3 }[] = [];

  // 已经把物体从场景里摘掉的条目要清掉，否则会读到 (0,0,0) 的假数据
  for (const [id, e] of Array.from(registry)) {
    if (!e.obj.parent) registry.delete(id);
  }

  for (const [id, e] of registry) {
    const b = boxOf(e.obj);
    // 角色是蒙皮网格，包围盒停留在 T-pose，拿来判穿模会误报，
    // 所以只登记位置，不参与包围盒比较。
    const isChar = e.kind === "character";
    objects[id] = { kind: e.kind, center: b.center, size: b.size, y: [b.min[1], b.max[1]] };
    if (!isChar && b.size.some((n) => n > 0.001)) boxes.push({ id, box: _box.clone() });
  }

  // 只检查「同一高度范围内」的物体，避免拿吊灯和地板比
  const overlaps: ProbeReport["overlaps"] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const vertical = a.box.max.y > b.box.min.y && b.box.max.y > a.box.min.y;
      if (!vertical) continue;
      // 椅子本来就在桌子下面、人本来就坐在椅子上，这些不算穿模
      const kinds = [registry.get(a.id)?.kind, registry.get(b.id)?.kind].sort().join("+");
      const intended =
        kinds === "chair+desk" ||
        kinds === "chair+character" ||
        kinds === "desk+desk";
      if (intended) continue;

      const o = xzOverlap(a.box, b.box);
      // 允许家具之间有轻微接触，超过 5 厘米才算穿模
      if (o.overlap && o.x > 0.05 && o.z > 0.05) {
        overlaps.push({ a: a.id, b: b.id, x: o.x, z: o.z });
      }
    }
  }

  const characters: ProbeReport["characters"] = [];
  for (const [id, e] of registry) {
    if (e.kind !== "character") continue;
    let hipsY: number | undefined;
    e.obj.traverse((o) => {
      const b = o as THREE.Bone;
      if (hipsY === undefined && (b as unknown as { isBone?: boolean }).isBone && /hips/i.test(b.name)) {
        b.getWorldPosition(_v);
        hipsY = Math.round(_v.y * 1000) / 1000;
      }
    });
    characters.push({
      id,
      position: e.obj.position.toArray().map((n) => Math.round(n * 1000) / 1000),
      hipsY,
      scale: e.obj.scale.toArray().map((n) => Math.round(n * 1000) / 1000),
    });
  }

  return { time: new Date().toISOString(), objects, overlaps, characters };
}

/** 把探针挂到 window 上，用 __probe() 调 */
export function installProbe() {
  const w = window as unknown as Record<string, unknown>;
  w.__probe = probe;
  w.__devRegistry = () => Array.from(registry.keys());
  w.__devGet = (id: string) => registry.get(id)?.obj ?? null;
  w.__THREE = THREE;
  w.__setCam = (name: string | null) => setHardCam(name ? (CAM_PRESETS[name] ?? null) : null);
}
