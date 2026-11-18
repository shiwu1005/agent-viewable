import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

/**
 * 四台机器，对应四个阶段：
 *   ① 接单 — 传送带把货送进来
 *   ② 思考 — 货进箱子，箱子上的大屏刷信息
 *   ③ 执行 — 一排机械臂在工位上干活
 *   ④ 交付 — 货从滑道送出口
 */

const metal = (c = "#3a4650", r = 0.55, m = 0.65) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });

const rubber = (c = "#22262b") =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0.05 });

/* ---------------------------------------------------------------- ① 传送带 */

export function Conveyor({ active }: { active: boolean }) {
  const rollers = useRef<THREE.Group>(null);
  const crates = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    const speed = active ? 1 : 0.25;
    if (rollers.current) {
      rollers.current.children.forEach((c) => {
        c.rotation.x += dt * 6 * speed;
      });
    }
    // 货往前走，走出画面就从后面再来一个
    if (crates.current) {
      crates.current.children.forEach((c, i) => {
        c.position.z += dt * 0.55 * speed;
        if (c.position.z > 1.15) c.position.z = -1.0 - i * 0.5;
      });
    }
  });

  return (
    <group position={[0, 0, -0.2]}>
      {/* 皮带 */}
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[1.9, 0.06, 0.56]} />
        <primitive object={rubber("#191d21")} attach="material" />
      </mesh>
      {/* 侧挡板 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.98, 0.83, 0]}>
          <boxGeometry args={[0.05, 0.11, 0.6]} />
          <primitive object={metal("#4d5a66")} attach="material" />
        </mesh>
      ))}
      {/* 滚轮 */}
      <group ref={rollers}>
        {Array.from({ length: 9 }).map((_, i) => (
          <mesh key={i} position={[0, 0.72, -0.52 + i * 0.13]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 1.86, 10]} />
            <primitive object={metal("#6a7885", 0.4, 0.8)} attach="material" />
          </mesh>
        ))}
      </group>
      {/* 支腿 */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 0.8, 0.38, sz * 0.22]}>
            <boxGeometry args={[0.06, 0.76, 0.06]} />
            <primitive object={metal("#2c353d")} attach="material" />
          </mesh>
        )),
      )}
      {/* 货箱 */}
      <group ref={crates}>
        {[0, 1, 2].map((i) => (
          <group key={i} position={[0, 0.93, -1.0 + i * 0.55]}>
            <mesh>
              <boxGeometry args={[0.3, 0.28, 0.3]} />
              <primitive object={new THREE.MeshStandardMaterial({ color: "#c08b52", roughness: 0.85 })} attach="material" />
            </mesh>
            {/* 打包带 */}
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[0.32, 0.06, 0.32]} />
              <primitive object={new THREE.MeshStandardMaterial({ color: "#e8d9b0", roughness: 0.7 })} attach="material" />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/* ---------------------------------------------------------------- ② 箱子 + 大屏 */

function makeScreenTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 288;
  return { canvas: c, tex: new THREE.CanvasTexture(c) };
}

export function ThinkBox({ active }: { active: boolean }) {
  const { canvas, tex } = useMemo(makeScreenTexture, []);
  const screenRef = useRef<THREE.Mesh>(null);
  const seed = useRef(0);

  useFrame((state) => {
    const t = Date.now() / 1000;
    // 只在激活时高频刷新，待命时慢下来
    const rate = active ? 12 : 2;
    if (Math.floor(t * rate) === seed.current) return;
    seed.current = Math.floor(t * rate);

    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#07121a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 顶部标题行
    ctx.fillStyle = active ? "#5ff0c0" : "#2b5a52";
    ctx.font = "bold 20px monospace";
    ctx.fillText(active ? "THINKING..." : "STANDBY", 16, 30);

    // 随机数据条
    for (let r = 0; r < 7; r++) {
      const y = 56 + r * 30;
      const w = active ? 60 + Math.random() * 380 : 40 + Math.random() * 90;
      ctx.fillStyle = active
        ? `rgba(${80 + Math.random() * 60}, ${230 + Math.random() * 25}, ${180}, ${0.35 + Math.random() * 0.5})`
        : "rgba(70,120,120,0.35)";
      ctx.fillRect(16, y, w, 12);
      // 右侧数字
      if (active && Math.random() > 0.4) {
        ctx.fillStyle = "rgba(200,255,240,0.85)";
        ctx.font = "13px monospace";
        ctx.fillText(`${(Math.random() * 100).toFixed(1)}%`, 400, y + 11);
      }
    }
    // 扫描线
    if (active) {
      const sy = (t * 260) % canvas.height;
      ctx.fillStyle = "rgba(120,255,220,0.10)";
      ctx.fillRect(0, sy, canvas.width, 3);
    }
    tex.needsUpdate = true;
  });

  return (
    <group position={[0, 0, -0.55]}>
      {/* 大箱子 */}
      <mesh position={[0, 0.46, -0.2]}>
        <boxGeometry args={[0.92, 0.92, 0.78]} />
        <primitive object={new THREE.MeshStandardMaterial({ color: "#6b7683", roughness: 0.7, metalness: 0.35 })} attach="material" />
      </mesh>
      {/* 箱体上的加强筋 */}
      {[-0.3, 0.3].map((z) => (
        <mesh key={z} position={[0, 0.46, -0.2 + z]}>
          <boxGeometry args={[0.96, 0.06, 0.05]} />
          <primitive object={metal("#8d99a6", 0.4, 0.7)} attach="material" />
        </mesh>
      ))}
      {/* 箱子里透出来的光 */}
      <pointLight position={[0, 0.85, 0.35]} intensity={active ? 1.6 : 0.25} distance={2.2} decay={2} color="#5ff0c0" />

      {/* 支架 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.55, 1.0, -0.1]}>
          <boxGeometry args={[0.06, 1.1, 0.06]} />
          <primitive object={metal("#39434c")} attach="material" />
        </mesh>
      ))}

      {/* 大屏：后仰一点，正对镜头 */}
      <group position={[0, 1.82, -0.02]} rotation={[-0.22, 0, 0]}>
        <mesh>
          <boxGeometry args={[1.62, 0.94, 0.05]} />
          <primitive object={metal("#12171c", 0.5, 0.4)} attach="material" />
        </mesh>
        <mesh ref={screenRef} position={[0, 0, 0.03]}>
          <planeGeometry args={[1.5, 0.84]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/* ---------------------------------------------------------------- ③ 机械臂 */

function Arm({ side, active, phase }: { side: number; active: boolean; phase: number }) {
  const shoulder = useRef<THREE.Group>(null);
  const elbow = useRef<THREE.Group>(null);
  const grip = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    const t = Date.now() / 1000;
    const k = active ? 1 : 0.18;
    if (shoulder.current) {
      shoulder.current.rotation.x = -0.75 + Math.sin(t * 1.9 * k + phase) * 0.3 * k;
      shoulder.current.rotation.z = side * (0.12 + Math.sin(t * 1.3 + phase) * 0.1 * k);
    }
    if (elbow.current) {
      elbow.current.rotation.x = 1.35 + Math.sin(t * 2.6 * k + phase + 1.2) * 0.45 * k;
    }
    if (grip.current) {
      const g = 0.5 + Math.sin(t * 4.1 * k + phase) * 0.5;
      grip.current.children.forEach((c, i) => {
        c.position.x = (i === 0 ? -1 : 1) * (0.03 + g * 0.035);
      });
    }
    void dt;
  });

  return (
    <group position={[side * 0.62, 0.95, -0.35]}>
      {/* 底座 */}
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.13, 0.16, 0.12, 16]} />
        <primitive object={metal("#4a5560")} attach="material" />
      </mesh>
      {/* 肩关节 */}
      <group ref={shoulder} position={[0, 0.12, 0]}>
        <mesh>
          <sphereGeometry args={[0.075, 12, 12]} />
          <primitive object={metal("#8d99a6", 0.35, 0.8)} attach="material" />
        </mesh>
        {/* 上臂 */}
        <mesh position={[0, 0.26, 0]}>
          <boxGeometry args={[0.09, 0.5, 0.09]} />
          <primitive object={metal("#c8d2dc", 0.4, 0.6)} attach="material" />
        </mesh>
        {/* 肘 */}
        <group ref={elbow} position={[0, 0.5, 0]}>
          <mesh>
            <sphereGeometry args={[0.065, 12, 12]} />
            <primitive object={metal("#8d99a6", 0.35, 0.8)} attach="material" />
          </mesh>
          {/* 前臂 */}
          <mesh position={[0, 0.21, 0]}>
            <boxGeometry args={[0.07, 0.4, 0.07]} />
            <primitive object={metal("#c8d2dc", 0.4, 0.6)} attach="material" />
          </mesh>
          {/* 夹爪 */}
          <group ref={grip} position={[0, 0.43, 0]}>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.05, 0, 0]}>
                <boxGeometry args={[0.025, 0.11, 0.05]} />
                <primitive object={metal("#e0a13c", 0.45, 0.5)} attach="material" />
              </mesh>
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}

export function RobotArms({ active }: { active: boolean }) {
  const sparkRef = useRef<THREE.PointLight>(null);

  useFrame(() => {
    if (!sparkRef.current) return;
    const t = Date.now() / 1000;
    sparkRef.current.intensity = active ? 1.2 + Math.sin(t * 22) * 1.0 + Math.random() * 1.6 : 0.05;
  });

  return (
    <group position={[0, 0, -0.6]}>
      {/* 工作台 */}
      <mesh position={[0, 0.88, -0.1]}>
        <boxGeometry args={[1.7, 0.08, 0.7]} />
        <primitive object={metal("#59636e", 0.6, 0.5)} attach="material" />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 0.75, 0.44, sz * 0.25]}>
            <boxGeometry args={[0.07, 0.88, 0.07]} />
            <primitive object={metal("#333c45")} attach="material" />
          </mesh>
        )),
      )}
      {/* 台面上的工件 */}
      <mesh position={[0, 0.94, -0.05]}>
        <boxGeometry args={[0.34, 0.1, 0.28]} />
        <primitive object={new THREE.MeshStandardMaterial({ color: "#c08b52", roughness: 0.85 })} attach="material" />
      </mesh>

      {/* 三只机械臂 */}
      <Arm side={-1} active={active} phase={0} />
      <Arm side={1} active={active} phase={1.7} />
      <Arm side={0} active={active} phase={3.1} />

      {/* 焊接火花 */}
      <pointLight ref={sparkRef} position={[0, 1.55, -0.35]} intensity={0} distance={2.4} decay={2} color="#bfe8ff" />
    </group>
  );
}

/* ---------------------------------------------------------------- ④ 出口 */

export function ExitChute({ active }: { active: boolean }) {
  const items = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Mesh>(null);

  useFrame((_, dt) => {
    if (items.current) {
      items.current.children.forEach((c, i) => {
        c.position.z -= dt * (active ? 1.1 : 0.2);
        if (c.position.z < -1.5) c.position.z = 0.9 - i * 0.45;
      });
    }
    if (glow.current) {
      const m = glow.current.material as THREE.MeshBasicMaterial;
      m.opacity = active ? 0.55 + Math.sin(Date.now() / 180) * 0.25 : 0.12;
    }
  });

  return (
    <group position={[0, 0, -0.3]}>
      {/* 斜滑道 */}
      <mesh position={[0, 0.82, 0]} rotation={[0.3, 0, 0]}>
        <boxGeometry args={[1.1, 0.06, 1.5]} />
        <primitive object={metal("#495460", 0.55, 0.6)} attach="material" />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.57, 0.9, 0]} rotation={[0.3, 0, 0]}>
          <boxGeometry args={[0.05, 0.14, 1.5]} />
          <primitive object={metal("#39434c")} attach="material" />
        </mesh>
      ))}
      {/* 滑道上的货 */}
      <group ref={items}>
        {[0, 1].map((i) => (
          <mesh key={i} position={[0, 0.94, 0.9 - i * 0.45]}>
            <boxGeometry args={[0.26, 0.22, 0.26]} />
            <primitive object={new THREE.MeshStandardMaterial({ color: "#c08b52", roughness: 0.85 })} attach="material" />
          </mesh>
        ))}
      </group>
      {/* 出口发光 */}
      <mesh ref={glow} position={[0, 0.9, -0.78]}>
        <planeGeometry args={[1.0, 0.7]} />
        <meshBasicMaterial color="#ff6a4a" transparent opacity={0.4} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 1.0, -0.7]} intensity={active ? 1.8 : 0.2} distance={2.6} decay={2} color="#ff8358" />
    </group>
  );
}
