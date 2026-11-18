import { useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { useTune } from "./tuneStore";

/**
 * 鼠标操作：
 *   按住小人拖动 → 在房间里挪动他
 *   按住空白处拖动 → 绕当前房间转视角
 *   滚轮 → 拉近拉远
 *
 * 参数写到 window.__TUNE，场景每帧读它（避开 HMR 双实例问题）。
 */

type WinTune = {
  rooms: Record<string, { xOff: number; z: number; clip: string }>;
  cam: { xOff: number; y: number; z: number; fov: number; yaw: number; pitch: number };
};

const ROOM_SPAN = 3.35;
const roomCenterX = (key: string) => {
  const i = ["receive", "think", "execute", "deliver"].indexOf(key);
  return i < 0 ? 0 : (i - 1.5) * ROOM_SPAN;
};

export function Controls() {
  const { camera, gl, scene } = useThree();

  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();

    let mode: "none" | "orbit" | "move" = "none";
    let moveKey: string | null = null;
    let lastX = 0;
    let lastY = 0;

    const tune = () => (window as unknown as { __TUNE?: WinTune }).__TUNE;

    const setNdc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    };

    /** 找到鼠标下的角色（往上找带 CHAR: 前缀的组） */
    const pickChar = (): string | null => {
      const targets: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o.name.startsWith("CHAR:")) targets.push(o);
      });
      if (!targets.length) return null;
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(targets, true);
      if (!hits.length) return null;
      let node: THREE.Object3D | null = hits[0].object;
      while (node) {
        if (node.name.startsWith("CHAR:")) return node.name.slice(5);
        node = node.parent;
      }
      return null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!el.contains(e.target as Node)) return;
      setNdc(e);
      lastX = e.clientX;
      lastY = e.clientY;
      const key = pickChar();
      if (key) {
        mode = "move";
        moveKey = key;
        el.style.cursor = "grabbing";
      } else {
        mode = "orbit";
        el.style.cursor = "grabbing";
      }
    };

    const onMove = (e: PointerEvent) => {
      if (mode === "none") return;
      const t = tune();
      if (!t) return;

      if (mode === "orbit") {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        t.cam.yaw -= dx * 0.006;
        t.cam.pitch = Math.max(-0.1, Math.min(0.8, t.cam.pitch + dy * 0.004));
        return;
      }

      // 拖人：把鼠标投到地面，换算成房间内的局部坐标
      setNdc(e);
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(floor, hit)) return;
      if (!moveKey) return;
      const cx = roomCenterX(moveKey);
      const room = t.rooms[moveKey];
      if (!room) return;
      room.xOff = Math.max(-1.2, Math.min(1.2, hit.x - cx));
      room.z = Math.max(-1.5, Math.min(0.5, hit.z));
    };

    const onUp = () => {
      mode = "none";
      moveKey = null;
      el.style.cursor = "";
    };

    const onWheel = (e: WheelEvent) => {
      const t = tune();
      if (!t) return;
      e.preventDefault();
      t.cam.z = Math.max(1.8, Math.min(9, t.cam.z * (1 + e.deltaY * 0.0012)));
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [camera, gl, scene]);

  return null;
}
