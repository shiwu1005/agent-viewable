import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

/**
 * 房间的门。
 *
 * 装在每间房的后墙上：门框固定，门扇绕左侧铰链开合。
 * 人从门后走进来，门再关上。
 */

export const DOOR_W = 0.86;
export const DOOR_H = 2.05;

export function RoomDoor({
  x,
  z,
  open,
  tint,
}: {
  x: number;
  z: number;
  open: boolean;
  tint: string;
}) {
  const panelRef = useRef<THREE.Group>(null);
  const [angle, setAngle] = useState(0);

  // 目标角度：关 0，开 -105°
  const target = open ? -1.83 : 0;

  useFrame((_, dt) => {
    setAngle((a) => {
      const next = a + (target - a) * Math.min(1, dt * 6);
      if (panelRef.current) panelRef.current.rotation.y = next;
      return next;
    });
  });

  useEffect(() => {
    if (panelRef.current) panelRef.current.rotation.y = angle;
  });

  return (
    <group position={[x, 0, z]}>
      {/* 门洞：把墙"挖"出来的效果用一块深色面板贴住 */}
      <mesh position={[0, DOOR_H / 2, 0.01]}>
        <planeGeometry args={[DOOR_W, DOOR_H]} />
        <meshStandardMaterial color="#070c10" roughness={1} />
      </mesh>

      {/* 门框 */}
      <mesh position={[-DOOR_W / 2 - 0.04, DOOR_H / 2, 0.04]}>
        <boxGeometry args={[0.08, DOOR_H + 0.08, 0.1]} />
        <meshStandardMaterial color="#2c4a55" roughness={0.7} />
      </mesh>
      <mesh position={[DOOR_W / 2 + 0.04, DOOR_H / 2, 0.04]}>
        <boxGeometry args={[0.08, DOOR_H + 0.08, 0.1]} />
        <meshStandardMaterial color="#2c4a55" roughness={0.7} />
      </mesh>
      <mesh position={[0, DOOR_H + 0.04, 0.04]}>
        <boxGeometry args={[DOOR_W + 0.24, 0.08, 0.1]} />
        <meshStandardMaterial color="#2c4a55" roughness={0.7} />
      </mesh>

      {/* 门扇：绕左侧铰链转 */}
      <group ref={panelRef} position={[-DOOR_W / 2, 0, 0.02]}>
        <mesh position={[DOOR_W / 2, DOOR_H / 2, 0]}>
          <boxGeometry args={[DOOR_W - 0.04, DOOR_H - 0.04, 0.04]} />
          <meshStandardMaterial color="#3d5560" roughness={0.6} metalness={0.1} />
        </mesh>
        {/* 门上的小窗 */}
        <mesh position={[DOOR_W / 2, DOOR_H * 0.68, 0.03]}>
          <boxGeometry args={[DOOR_W * 0.46, DOOR_H * 0.3, 0.01]} />
          <meshStandardMaterial color="#8fb3c4" roughness={0.2} metalness={0.4} />
        </mesh>
        {/* 门把手 + 房间色条 */}
        <mesh position={[DOOR_W - 0.12, 1.02, 0.05]}>
          <boxGeometry args={[0.05, 0.16, 0.04]} />
          <meshStandardMaterial color={tint} roughness={0.4} metalness={0.5} />
        </mesh>
      </group>
    </group>
  );
}
