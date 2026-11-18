import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useOffice } from "../probe/model";
import * as THREE from "three";
import { GenProp, useAvailableProps } from "./GenProp";

/**
 * 一体工位：桌 + 显示器 + 键盘 + 杯子。
 *
 * 关键点：屏幕的摆放位置**不是写死的**，而是运行时量出桌子的包围盒，
 * 再把显示器放到桌面正中、靠后 28% 的位置、底面正好落在桌面上。
 * 换任何桌子模型都不会再出现悬空或陷进桌面。
 */

const MON_W = 0.86;
const MON_H = 0.5;
const MUG_H = 0.11;

export function Workstation({
  id = "standingdesk",
  height = 1.0,
  position = [0, 0, 0],
}: {
  id?: string;
  height?: number;
  position?: [number, number, number];
}) {
  const deskGen = useAvailableProps([id], "roomset");
  const propGen = useAvailableProps(["mug"]);
  const gen: Record<string, boolean> = { ...deskGen, ...propGen };
  const deskRef = useRef<THREE.Group>(null);
  const outerRef = useRef<THREE.Group>(null);
  const screenRef = useRef<THREE.MeshBasicMaterial>(null);
  const hotRef = useRef<THREE.PointLight>(null);
  const [metrics, setMetrics] = useState<{ top: number; back: number; front: number } | null>(null);

  // 桌子是异步加载的，量不到就定期再量
  useEffect(() => {
    let alive = true;
    const measure = () => {
      if (!alive || !deskRef.current) return;
      const box = new THREE.Box3().setFromObject(deskRef.current);
      const size = box.getSize(new THREE.Vector3());
      if (size.y < 0.2) return; // 还没加载出来
      // 量出来是世界坐标，要减掉这组自身的世界位置，否则偏移会算两次
      const wp = new THREE.Vector3();
      outerRef.current?.getWorldPosition(wp);
      setMetrics({ top: box.max.y - wp.y, back: box.min.z - wp.z, front: box.max.z - wp.z });
    };
    measure();
    const timer = window.setInterval(measure, 900);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [gen[id]]);

  const errorAt = useOffice((s) => s.errorAt);

  useFrame((state) => {
    const since = errorAt ? Date.now() - errorAt : 1e9;
    const hot = since < 2300;
    const pulse = hot ? 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 18) : 0;
    const mat = screenRef.current;
    if (mat) mat.color.setRGB(hot ? 0.85 : 0.29, hot ? 0.12 + pulse * 0.1 : 0.52, hot ? 0.1 : 0.72);
    if (hotRef.current) hotRef.current.intensity = pulse * 6;
  });

  const top = metrics?.top ?? height;
  const back = metrics?.back ?? -0.32;
  const front = metrics?.front ?? 0.32;
  const depth = front - back;
  const monZ = back + depth * 0.28;
  const kbZ = back + depth * 0.72;

  return (
    <group ref={outerRef} position={position}>
      <group ref={deskRef}>
        {gen[id] ? (
          <GenProp id={id} height={height} folder="roomset" />
        ) : (
          // 没生成模型时的兜底：一张素桌
          <group>
            <mesh position={[0, height - 0.02, 0]}>
              <boxGeometry args={[1.3, 0.04, 0.65]} />
              <meshStandardMaterial color="#c9a675" roughness={0.8} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.58, (height - 0.04) / 2, 0]}>
                <boxGeometry args={[0.06, height - 0.04, 0.06]} />
                <meshStandardMaterial color="#22282e" roughness={0.6} />
              </mesh>
            ))}
          </group>
        )}
      </group>

      {/* 显示器：底面落在桌面上 */}
      <group position={[0, 0, monZ]}>
        <mesh position={[0, top + 0.02 + MON_H / 2, 0]}>
          <boxGeometry args={[MON_W, MON_H, 0.035]} />
          <meshStandardMaterial color="#14181d" roughness={0.4} metalness={0.2} />
        </mesh>
        <mesh position={[0, top + 0.02 + MON_H / 2, 0.019]}>
          <planeGeometry args={[MON_W * 0.93, MON_H * 0.9]} />
          <meshBasicMaterial ref={screenRef} color="#4a86b8" toneMapped={false} />
        </mesh>
        <mesh position={[0, top + 0.011, 0.02]}>
          <boxGeometry args={[0.3, 0.022, 0.19]} />
          <meshStandardMaterial color="#1b2026" roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[0, top + 0.06, 0.02]}>
          <boxGeometry args={[0.07, 0.09, 0.06]} />
          <meshStandardMaterial color="#1b2026" roughness={0.5} metalness={0.3} />
        </mesh>
      </group>

      {/* 键盘 */}
      <group position={[0, 0, kbZ]}>
        <mesh position={[0, top + 0.014, 0]}>
          <boxGeometry args={[0.62, 0.028, 0.19]} />
          <meshStandardMaterial color="#1c2126" roughness={0.7} />
        </mesh>
        {Array.from({ length: 4 }).map((_, r) =>
          Array.from({ length: 13 }).map((__, c) => (
            <mesh key={`${r}-${c}`} position={[-0.26 + c * 0.043, top + 0.031, -0.06 + r * 0.038]}>
              <boxGeometry args={[0.036, 0.008, 0.03]} />
              <meshStandardMaterial color="#2b3238" roughness={0.8} />
            </mesh>
          )),
        )}
      </group>

      {/* 杯子 */}
      {gen.mug && (
        <group position={[MON_W / 2 + 0.2, top, monZ + 0.24]}>
          <GenProp id="mug" height={MUG_H} />
        </group>
      )}

      {/* 红温：屏幕闪红 + 一盏红光 */}
      <pointLight ref={hotRef} position={[0, top + 0.35, monZ + 0.5]} intensity={0} distance={3} decay={2} color="#ff3a2a" />
      {/* 屏幕照在桌面上的一层冷光 */}
      <pointLight position={[0, top + 0.3, monZ + 0.45]} intensity={0.9} distance={2.0} decay={2} color="#7fbde8" />

      {/* 让调试面板量得到 */}
      {metrics && (
        <mesh visible={false} position={[0, top, 0]}>
          <boxGeometry args={[MON_W, 0.001, depth]} />
        </mesh>
      )}
    </group>
  );
}
