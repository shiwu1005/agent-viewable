import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

/**
 * Lux3D 生成的家具。
 * 文件在 public/models/props/<id>.glb，用脚本 scripts/gen-props.mjs 生成。
 * 没有就返回 null，调用方继续用程序化方块兜底。
 */

const cache = new Map<string, boolean>();
const pending = new Map<string, Promise<boolean>>();

export function probeProp(id: string, folder = "props"): Promise<boolean> {
  const key = folder + "/" + id;
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  if (pending.has(key)) return pending.get(key)!;

  const p = (async () => {
    try {
      const res = await fetch(`/models/${folder}/${id}.glb`, { headers: { Range: "bytes=0-3" } });
      if (!res.ok) return false;
      const b = new Uint8Array(await res.arrayBuffer());
      const ok = b.length >= 4 && b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46;
      cache.set(key, ok);
      return ok;
    } catch {
      cache.set(key, false);
      return false;
    }
  })();
  pending.set(key, p);
  return p;
}

/** 一次问清楚哪些道具已经有模型了 */
export function useAvailableProps(ids: string[], folder = "props") {
  const [ready, setReady] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(ids.map(async (id) => [id, await probeProp(id, folder)] as const)).then((pairs) => {
      if (!alive) return;
      setReady(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [ids.join(","), folder]);
  return ready;
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

export function GenProp({
  id,
  height,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  yaw = 0,
  folder = "props",
  stretch = [1, 1],
}: {
  id: string;
  height: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  yaw?: number;
  folder?: "props" | "roomset" | "factory";
  /** XZ 拉伸，传送带拉长用 */
  stretch?: [number, number];
}) {
  const { scene } = useGLTF(`/models/${folder}/${id}.glb`);

  const prepared = useMemo(() => {
    const root = scene.clone(true);
    root.name = `ROOMSET:${id}`;
    root.updateWorldMatrix(true, true);
    _box.setFromObject(root);
    _box.getSize(_size);
    _box.getCenter(_center);
    const s = height / Math.max(_size.y, 1e-4);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    return {
      root,
      s,
      offset: new THREE.Vector3(-_center.x, -_box.min.y, -_center.z),
    };
  }, [scene, height]);

  return (
    <group position={position} rotation={[rotation[0], yaw, rotation[2]]}>
      <group scale={[prepared.s * stretch[0], prepared.s, prepared.s * stretch[1]]}>
        <primitive object={prepared.root} position={prepared.offset} />
      </group>
    </group>
  );
}
