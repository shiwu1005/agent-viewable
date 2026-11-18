import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useOffice } from "../probe/model";
import { GenProp, useAvailableProps } from "./GenProp";
import { IndustrialArm } from "./IndustrialArm";
/** 货的实时世界坐标，机械臂 IK 用 */
export const cargoWorld = new THREE.Vector3();
import { grab, resetGrab } from "./grabState";

/**
 * 一整条工厂流水线：
 *
 *   入口 ──▶ 传送带 ──▶ 处理箱（大屏）──▶ 机械臂工位 ──▶ 出口
 *   -9        -6          -2               +2.5          +7.5
 *
 * 同一件货从左走到右，走到哪一站，哪一站就亮起来干活。
 */

const metal = (c = "#3a4650", r = 0.5, m = 0.7) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
const glow = (c: string, o = 1) =>
  new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, toneMapped: false });

/** 墙上的警示牌：黄黑斜纹 + 符号 */
function makeSignTexture(kind: "warn" | "power" | "stop") {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  // 黄黑斜纹底
  g.fillStyle = "#e8c34a";
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "#161a1e";
  g.lineWidth = 26;
  for (let i = -256; i < 512; i += 52) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 256, 256);
    g.stroke();
  }
  // 中间的白底圆
  g.fillStyle = "rgba(14,18,22,0.88)";
  g.beginPath();
  g.arc(128, 128, 86, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = kind === "stop" ? "#e8574a" : "#f2e6c8";
  g.font = "bold 110px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(kind === "warn" ? "!" : kind === "power" ? "⚡" : "✕", 128, 134);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
/** 四个站位在 X 轴上的位置 */
const STATION_X = { receive: -6.0, think: -1.6, execute: 2.6, deliver: 7.0 } as const;
/** 回收站位置：执行与交付之间 */
const RECYCLE_X = 4.75;
const STATION_COLOR = {
  receive: "#e8a33d",
  think: "#5fb8e8",
  execute: "#7bc96f",
  deliver: "#e8574a",
} as const;
const LABEL = { receive: "① 接单", think: "② 思考", execute: "③ 执行", deliver: "④ 交付" } as const;

/** 皮带高度 */
const BELT_Y = 0.86;

/* ---------------------------------------------------------------- 传送带 */

function Belt({ has }: { has: boolean }) {
  const rollers = useRef<THREE.Group>(null);
  const activeStage = useOffice((s) => s.stage);

  useFrame((_, dt) => {
    if (!rollers.current) return;
    const speed = activeStage === "idle" ? 0.6 : 2.6;
    rollers.current.children.forEach((c) => {
      c.rotation.z -= dt * speed;
    });
  });

  // 精确拼接：每段实测 3.47 米长，按 3.47 的间隔排布，接缝严丝合缝
  if (has) {
    const SEG = 3.31; // 实测单段长 3.32，留 1 厘米重叠消除缝隙
    return (
      <group>
        {[-2, -1, 0, 1, 2].map((k) => (
          <GenProp
            key={k}
            id="conveyor"
            height={0.86}
            position={[k * SEG, 0, 0]}
            yaw={Math.PI / 2}
            folder="factory"
          />
        ))}
      </group>
    );
  }

  const count = 34;
  return (
    <group>
      {/* 皮带面 */}
      <mesh position={[0, BELT_Y, 0]} rotation={[0, 0, 0]}>
        <boxGeometry args={[17.2, 0.07, 0.86]} />
        <primitive object={new THREE.MeshStandardMaterial({ color: "#171b1f", roughness: 0.95 })} attach="material" />
      </mesh>
      {/* 两侧导轨 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, BELT_Y + 0.09, s * 0.46]}>
          <boxGeometry args={[17.4, 0.12, 0.05]} />
          <primitive object={metal("#59636e")} attach="material" />
        </mesh>
      ))}
      {/* 滚轮 */}
      <group ref={rollers}>
        {Array.from({ length: count }).map((_, i) => (
          <mesh key={i} position={[-8.4 + (i * 16.8) / (count - 1), BELT_Y - 0.07, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.075, 0.075, 0.82, 12]} />
            <primitive object={metal("#77848f", 0.35, 0.85)} attach="material" />
          </mesh>
        ))}
      </group>
      {/* 支腿 */}
      {[-8, -5.4, -2.7, 0, 2.7, 5.4, 8].map((x) => (
        <group key={x}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[x, (BELT_Y - 0.07) / 2, s * 0.3]}>
              <boxGeometry args={[0.07, BELT_Y - 0.07, 0.07]} />
              <primitive object={metal("#2c353d")} attach="material" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/* ---------------------------------------------------------------- 处理箱 + 大屏 */

function makeScreenTexture() {
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 360;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { canvas: c, tex };
}

function ThinkBox({ active, has }: { active: boolean; has: boolean }) {
  const { canvas, tex } = useMemo(makeScreenTexture, []);
  const seed = useRef(0);
  const lightRef = useRef<THREE.PointLight>(null);
  const scanRef = useRef<THREE.Mesh>(null);
  const scanLight = useRef<THREE.PointLight>(null);

  useFrame(() => {
    const t = Date.now() / 1000;
    if (lightRef.current) {
      lightRef.current.intensity = active ? 2.2 + Math.sin(t * 6) * 0.8 : 0.25;
    }
    const rate = active ? 14 : 2;
    if (Math.floor(t * rate) === seed.current) return;
    seed.current = Math.floor(t * rate);

    const g = canvas.getContext("2d")!;
    g.fillStyle = "#04090d";
    g.fillRect(0, 0, 640, 360);

    // 标题
    g.fillStyle = active ? "#6ff2c9" : "#2a4f49";
    g.font = "bold 26px monospace";
    g.fillText(active ? "▶ ANALYZING" : "· STANDBY", 22, 40);

    // 数据条
    for (let r = 0; r < 6; r++) {
      const y = 70 + r * 42;
      const w = active ? 90 + Math.random() * 380 : 50 + Math.random() * 70;
      g.fillStyle = active
        ? `rgba(${90 + Math.random() * 60},${225 + Math.random() * 30},${180},${0.35 + Math.random() * 0.5})`
        : "rgba(70,120,120,0.3)";
      g.fillRect(22, y, w, 16);
      if (active && Math.random() > 0.45) {
        g.fillStyle = "rgba(220,255,245,0.9)";
        g.font = "15px monospace";
        g.fillText(`${(Math.random() * 100).toFixed(1)}%`, 500, y + 14);
      }
    }
    // 波形
    if (active) {
      g.strokeStyle = "rgba(120,255,220,0.75)";
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x < 640; x += 8) {
        const yy = 320 + Math.sin((x + t * 900) * 0.03) * 14 * Math.random();
        if (x === 0) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.stroke();
      // 扫描线
      const sy = (t * 300) % 360;
      g.fillStyle = "rgba(120,255,220,0.12)";
      g.fillRect(0, sy, 640, 4);
    }
    tex.needsUpdate = true;
  });

  return (
    <group position={[STATION_X.think, 0, 0]}>
      {has ? (
        <GenProp id="processor" height={2.4} position={[0, 0, -1.24]} folder="factory" />
      ) : (
        <group>
          <mesh position={[0, 0.86, 0]}>
            <boxGeometry args={[1.5, 1.1, 1.25]} />
            <primitive object={metal("#5d6873", 0.6, 0.4)} attach="material" />
          </mesh>
        </group>
      )}
      {/* 加强筋 */}
      {[-0.5, 0.5].map((z) => (
        <mesh key={z} position={[0, 0.86, z]}>
          <boxGeometry args={[1.56, 0.07, 0.06]} />
          <primitive object={metal("#8d99a6", 0.35, 0.75)} attach="material" />
        </mesh>
      ))}
      <pointLight ref={lightRef} position={[0, 1.35, 0.55]} intensity={0} distance={3.2} decay={2} color="#5ff0c0" />
      {/* 扫描光带：只在处理时扫过 */}
      <mesh ref={scanRef} position={[0, 1.15, 0.55]}>
        <planeGeometry args={[0.1, 1.5]} />
        <meshBasicMaterial color="#7cffd8" transparent opacity={0} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <pointLight ref={scanLight} position={[0, 1.2, 0.6]} intensity={0} distance={2.4} decay={2} color="#7cffd8" />

      {/* 大屏：从顶部桁架吊下来的工位看板，不落地、不挡产线 */}
      {/* 吊杆 */}
      {[-0.75, 0.75].map((s) => (
        <mesh key={`rod${s}`} position={[s, 4.05, -1.1]}>
          <cylinderGeometry args={[0.018, 0.018, 1.6, 8]} />
          <primitive object={metal("#8d99a6", 0.4, 0.8)} attach="material" />
        </mesh>
      ))}
      {/* 顶部横梁 */}
      <mesh position={[0, 4.78, -1.1]}>
        <boxGeometry args={[1.9, 0.07, 0.07]} />
        <primitive object={metal("#5a636e")} attach="material" />
      </mesh>
      {/* 屏幕外壳 */}
      <group position={[0, 3.05, -1.1]} rotation={[-0.16, 0, 0]}>
        <mesh>
          <boxGeometry args={[2.5, 1.45, 0.07]} />
          <primitive object={metal("#20262c", 0.4, 0.5)} attach="material" />
        </mesh>
        <mesh position={[0, 0, 0.045]}>
          <planeGeometry args={[2.34, 1.3]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/* ---------------------------------------------------------------- 机械臂 */

function Arm({ side, active, phase }: { side: number; active: boolean; phase: number }) {
  const shoulder = useRef<THREE.Group>(null);
  const elbow = useRef<THREE.Group>(null);
  const grip = useRef<THREE.Group>(null);

  useFrame(() => {
    const t = Date.now() / 1000;
    const k = active ? 1 : 0.15;
    if (shoulder.current) {
      shoulder.current.rotation.x = -0.62 + Math.sin(t * 2.0 * k + phase) * 0.34 * k;
      shoulder.current.rotation.z = side * (0.14 + Math.sin(t * 1.4 + phase) * 0.12 * k);
    }
    if (elbow.current) {
      elbow.current.rotation.x = 1.15 + Math.sin(t * 2.7 * k + phase + 1.1) * 0.5 * k;
    }
    if (grip.current) {
      const g2 = 0.5 + Math.sin(t * 4.4 * k + phase) * 0.5;
      grip.current.children.forEach((c, i) => {
        c.position.x = (i === 0 ? -1 : 1) * (0.03 + g2 * 0.04);
      });
    }
  });

  return (
    <group position={[side * 0.75, 1.02, 0.55]}>
      <mesh position={[0, 0.07, 0]}>
        <cylinderGeometry args={[0.15, 0.19, 0.14, 16]} />
        <primitive object={metal("#4a5560")} attach="material" />
      </mesh>
      <group ref={shoulder} position={[0, 0.14, 0]}>
        <mesh>
          <sphereGeometry args={[0.085, 12, 12]} />
          <primitive object={metal("#98a4b0", 0.3, 0.85)} attach="material" />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[0.1, 0.58, 0.1]} />
          <primitive object={metal("#cfd8e2", 0.35, 0.6)} attach="material" />
        </mesh>
        <group ref={elbow} position={[0, 0.58, 0]}>
          <mesh>
            <sphereGeometry args={[0.07, 12, 12]} />
            <primitive object={metal("#98a4b0", 0.3, 0.85)} attach="material" />
          </mesh>
          <mesh position={[0, 0.24, 0]}>
            <boxGeometry args={[0.075, 0.46, 0.075]} />
            <primitive object={metal("#cfd8e2", 0.35, 0.6)} attach="material" />
          </mesh>
          <group ref={grip} position={[0, 0.5, 0]}>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.05, 0, 0]}>
                <boxGeometry args={[0.028, 0.13, 0.055]} />
                <primitive object={metal("#e8a33d", 0.4, 0.5)} attach="material" />
              </mesh>
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}

/** 伺服式动作：走到位、停一下、再走下一个，不是正弦抖动 */
function ArmBob({ x, active, phase, model }: { x: number; active: boolean; phase: number; model: string }) {
  const ref = useRef<THREE.Group>(null);
  const seg = useRef(0);
  const t0 = useRef(0);
  const PATH = [
    { z: 0.0, x: -0.12, hold: 0.5 },
    { z: 0.32, x: -0.32, hold: 0.35 },
    { z: 0.32, x: -0.32, hold: 0.45 },
    { z: -0.28, x: -0.18, hold: 0.4 },
    { z: 0.1, x: -0.4, hold: 0.5 },
  ];
  useFrame(() => {
    if (!ref.current) return;
    const now = Date.now() / 1000;
    if (t0.current === 0) t0.current = now + phase * 0.4;
    const speed = active ? 1 : 0.35;
    const cur = PATH[seg.current % PATH.length];
    const prev = PATH[(seg.current - 1 + PATH.length) % PATH.length];
    const t = Math.max(0, Math.min(1, (now - t0.current) / (cur.hold / speed)));
    const e = t * t * (3 - 2 * t);
    ref.current.rotation.z = prev.z + (cur.z - prev.z) * e;
    ref.current.rotation.x = prev.x + (cur.x - prev.x) * e;
    if (t >= 1) {
      t0.current = now;
      seg.current += 1;
    }
  });
  return (
    <group ref={ref} position={[x, 0.0, 1.35]}>
      <GenProp id={model} height={1.75} position={[0, 0, 0]} folder="factory" />
    </group>
  );
}
function RobotStation({ active, has, model, press = 0 }: { active: boolean; has: boolean; model: string; press?: number }) {
  const spark = useRef<THREE.PointLight>(null);
  useFrame(() => {
    if (!spark.current) return;
    spark.current.intensity = active ? 1.5 + Math.abs(Math.sin(Date.now() / 90)) * 3 : 0.05;
  });

  return (
    <group position={[STATION_X.execute, 0, 0]}>
      {/* 龙门架 */}
      {has ? (
        <group>
          {/* 两只机械臂，分居传送带两侧，交替作业 */}
          <IndustrialArm
            x={-0.85}
            z={0.86}
            active={active}
            phase={0}
            press={press}
            target={active ? cargoWorld : null}
            lift={grab.lift * 0.3}
          />
          <IndustrialArm
            x={0.85}
            z={-0.86}
            yawOffset={Math.PI}
            active={active}
            phase={1.6}
            press={0}
          />
          <pointLight ref={spark} position={[0, 1.7, 0.5]} intensity={0} distance={3} decay={2} color="#c8ecff" />
        </group>
      ) : (
        <group>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 1.15, 1.5, 0.6]}>
              <boxGeometry args={[0.09, 3.0, 0.09]} />
              <primitive object={metal("#333c45")} attach="material" />
            </mesh>
          ))}
          <mesh position={[0, 2.98, 0.6]}>
            <boxGeometry args={[2.4, 0.12, 0.12]} />
            <primitive object={metal("#3f4a55")} attach="material" />
          </mesh>
          <Arm side={-1} active={active} phase={0} />
          <Arm side={1} active={active} phase={1.9} />
          <Arm side={0} active={active} phase={3.4} />
          <pointLight ref={spark} position={[0, 1.7, 0.5]} intensity={0} distance={3} decay={2} color="#c8ecff" />
        </group>
      )}
    </group>
  );
}

/** 报错特效：扩散红环 + 火花迸射 */
function ErrorVfx() {
  const errAt = useOffice((s) => s.errorAt);
  const ringRef = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const sparks = useRef<THREE.Points>(null);
  const t0 = useRef(0);

  useFrame(() => {
    const now = Date.now();
    const since = errAt ? now - errAt : 1e9;
    if (errLight.current) errLight.current.intensity = errAt && since < 1200 ? 5 : 0;
    // 特效跟着货走
    if (followRef.current) {
      followRef.current.position.x = cargoWorld.x;
      followRef.current.position.z = cargoWorld.z;
    }
    if (since < 40) t0.current = now;

    // 红环扩散
    const k = Math.min(1, (now - t0.current) / 700);
    [ringRef.current, ring2Ref.current].forEach((r, i) => {
      if (!r) return;
      const kk = Math.max(0, Math.min(1, k - i * 0.18));
      const s = 0.6 + kk * 3.2;
      r.scale.set(s, s, s);
      const m = r.material as THREE.MeshBasicMaterial;
      m.opacity = errAt && since < 1400 ? (1 - kk) * 0.85 : 0;
    });

    // 火花
    if (sparks.current) {
      const g = sparks.current.geometry as THREE.BufferGeometry;
      const pos = g.attributes.position as THREE.BufferAttribute;
      const live = errAt && since < 1200;
      sparks.current.visible = !!live;
      if (live) {
        const tt = (now - t0.current) / 1000;
        for (let i = 0; i < pos.count; i++) {
          const a = (i / pos.count) * Math.PI * 2;
          const r = tt * (1.6 + (i % 7) * 0.22);
          const y = tt * (1.2 + (i % 5) * 0.3) - tt * tt * 3.2;
          pos.setXYZ(i, Math.cos(a) * r, Math.max(0.05, y + 0.5), Math.sin(a) * r * 0.6);
        }
        pos.needsUpdate = true;
        (sparks.current.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - since / 1200);
      }
    }
  });

  const sparkGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = 64;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr[i * 3 + 1] = 0.5;
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, []);

  const followRef = useRef<THREE.Group>(null);
  const errLight = useRef<THREE.PointLight>(null);

  return (
    <group ref={followRef} position={[cargoWorld.x, 0, cargoWorld.z]}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.9, 1.0, 48]} />
        <meshBasicMaterial color="#ff4a3c" transparent opacity={0} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2Ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
        <ringGeometry args={[0.9, 1.0, 48]} />
        <meshBasicMaterial color="#ffb03c" transparent opacity={0} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <points ref={sparks} geometry={sparkGeo}>
        <pointsMaterial color="#ffd27a" size={0.07} transparent opacity={0} toneMapped={false} />
      </points>
      <pointLight ref={errLight} intensity={0} distance={6} decay={2} color="#ff5a3c" />
    </group>
  );
}
/** 回收站：出错时货从这里退回思考站 */
function RecycleStation({ has }: { has: boolean }) {
  const stage = useOffice((s) => s.stage);
  const errAt = useOffice((s) => s.errorAt);
  const active = !!errAt && Date.now() - errAt < 2500;
  const ringRef = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 256;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#1b1f24";
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "#e8574a";
    g.lineWidth = 10;
    g.strokeRect(10, 10, 236, 236);
    g.fillStyle = "#e8574a";
    g.font = "bold 92px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("回收", 128, 110);
    // 向左的箭头（退回思考）
    g.beginPath();
    g.moveTo(196, 196);
    g.lineTo(76, 196);
    g.lineTo(76, 214);
    g.lineTo(40, 186);
    g.lineTo(76, 158);
    g.lineTo(76, 176);
    g.lineTo(196, 176);
    g.closePath();
    g.fill();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  useFrame(() => {
    if (!ringRef.current) return;
    const m = ringRef.current.material as THREE.MeshBasicMaterial;
    m.opacity = active ? 0.6 + Math.sin(Date.now() / 120) * 0.35 : 0.12;
  });

  return (
    <group position={[RECYCLE_X, 0, 0]}>
      {/* 地面回收圈 */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]}>
        <ringGeometry args={[0.95, 1.15, 48]} />
        <meshBasicMaterial color="#e8574a" transparent opacity={0.2} toneMapped={false} />
      </mesh>
      {/* 立柱 + 牌子 */}
      <mesh position={[0, 1.2, -1.5]}>
        <cylinderGeometry args={[0.04, 0.04, 2.4, 8]} />
        <primitive object={metal("#4a5560")} attach="material" />
      </mesh>
      <mesh position={[0, 2.1, -1.45]}>
        <planeGeometry args={[0.95, 0.95]} />
        <meshBasicMaterial map={tex} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <pointLight position={[0, 1.0, -1.2]} intensity={active ? 3 : 0.15} distance={3.2} decay={2} color="#ff6a4a" />
      {/* 生成的回收机 */}
      {has && <GenProp id="recycle" height={1.5} position={[0, 0, -1.05]} folder="factory" />}
    </group>
  );
}
/* ---------------------------------------------------------------- 出口 */

function ExitStation({ active, has }: { active: boolean; has: boolean }) {
  const shutterTex = useMemo(() => makeShutterTexture(), []);
  const glowRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!glowRef.current) return;
    const m = glowRef.current.material as THREE.MeshBasicMaterial;
    m.opacity = active ? 0.55 + Math.sin(Date.now() / 160) * 0.3 : 0.1;
  });

  return (
    <group position={[STATION_X.deliver, 0, 0]}>
      {has ? (
        <GenProp id="chute" height={1.0} position={[0, 0, -1.05]} folder="factory" />
      ) : (
        <group>
          <mesh position={[0, 0.72, -0.55]} rotation={[0.45, 0, 0]}>
            <boxGeometry args={[1.3, 0.08, 1.2]} />
            <primitive object={metal("#495460")} attach="material" />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.68, 0.82, -0.55]} rotation={[0.45, 0, 0]}>
              <boxGeometry args={[0.06, 0.16, 1.2]} />
              <primitive object={metal("#39434c")} attach="material" />
            </mesh>
          ))}
        </group>
      )}
      {/* 出口光 */}
      <mesh ref={glowRef} position={[0, 1.05, -1.15]}>
        <planeGeometry args={[1.2, 0.95]} />
        <primitive object={glow("#ff6a4a", 0.4)} attach="material" />
      </mesh>
      <pointLight position={[0, 1.1, -1.0]} intensity={active ? 2.6 : 0.2} distance={3.4} decay={2} color="#ff8358" />

      {/* 出口：卷帘门 + 门框 + 警示灯 */}
      <mesh position={[0, 1.55, -1.24]}>
        <planeGeometry args={[1.5, 2.6]} />
        <meshStandardMaterial map={shutterTex} roughness={0.6} metalness={0.55} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`f${s}`} position={[s * 0.82, 1.5, -1.22]}>
          <boxGeometry args={[0.14, 3.0, 0.16]} />
          <primitive object={metal("#39434c")} attach="material" />
        </mesh>
      ))}
      <mesh position={[0, 2.92, -1.22]}>
        <boxGeometry args={[1.9, 0.24, 0.2]} />
        <primitive object={metal("#4a5560")} attach="material" />
      </mesh>
      <mesh position={[0, 2.74, -1.1]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshBasicMaterial color="#ff5a3c" toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ---------------------------------------------------------------- 货（沿皮带移动） */

function Cargo({ has }: { has: boolean }) {
  const stage = useOffice((s) => s.stage);
  const ref = useRef<THREE.Group>(null);
  // 货的生命周期：spawn（在起点落下）→ ride（跟着阶段走）→ exit（滑进出口）→ gone
  const mode = useRef<"spawn" | "ride" | "exit" | "gone" | "return">("spawn");
  const lastErr = useRef(0);
  const x = useRef(STATION_X.receive);
  const exitT = useRef(0);
  const spawnT = useRef(0.35);
  const lastStage = useRef<string>("");
  const deliverT = useRef(0);
  const execHold = useRef(0);

  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const d = Math.min(dt, 0.05);
    const st = useOffice.getState().stage;

    // 每次进入「接单」= 一件新货在起点出生
    if (st !== lastStage.current) {
      const prev = lastStage.current;
      lastStage.current = st;
      if (st === "receive" && prev !== "") {
        resetGrab();
        mode.current = "spawn";
        spawnT.current = 0.35;
        x.current = STATION_X.receive;
        g.scale.setScalar(1)
        g.rotation.y = 0
        g.visible = true;
      }
      if (st === "deliver") deliverT.current = 0;
    }

    if (mode.current === "gone") {
      g.visible = false;
      return;
    }

    // 出错：货退回思考站重做（从 store 直读，避免闭包旧值）
    const errNow = useOffice.getState().errorAt;
    if (errNow && errNow !== lastErr.current) {
      lastErr.current = errNow;
      if (mode.current === "ride" || mode.current === "return") mode.current = "return";
    }
    if (mode.current === "return") {
      g.visible = true;
      g.scale.setScalar(1);
      x.current += (STATION_X.think - x.current) * Math.min(1, d * 2.4);
      g.position.x = x.current;
      g.position.z = Math.sin(Date.now() / 160) * 0.03;
      g.position.y = BELT_Y + 0.04;
      g.rotation.y = Math.sin(Date.now() / 120) * 0.12;
      cargoWorld.set(g.position.x, g.position.y + 0.19, g.position.z);
      if (Math.abs(x.current - STATION_X.think) < 0.1) mode.current = "ride";
      return;
    }

    // 出库动画：滑进出口并缩没
    if (mode.current === "exit") {
      exitT.current += d;
      const t = Math.min(1, exitT.current / 0.55);
      g.position.x = STATION_X.deliver + t * 0.3;
      g.position.z = -t * 1.4;
      g.position.y = BELT_Y + 0.06 - t * 0.3;
      g.scale.setScalar(Math.max(0.01, 1 - t));
      if (t >= 1) {
        mode.current = "gone";
        g.visible = false;
      }
      return;
    }

    // 出生：从上方落到皮带
    if (mode.current === "spawn") {
      spawnT.current -= d;
      const k = Math.max(0, spawnT.current / 0.35);
      g.position.x = STATION_X.receive;
      g.position.z = 0;
      g.position.y = BELT_Y + 0.04 + k * 0.65;
      g.visible = true;
      if (spawnT.current <= 0) mode.current = "ride";
      return;
    }

    // 在产线上随阶段推进（只往前，不倒退）
    const target = STATION_X[st as keyof typeof STATION_X] ?? STATION_X.receive;
    if (target > x.current) x.current += (target - x.current) * Math.min(1, d * 3.4);
    const moving = Math.abs(target - x.current) > 0.05;
    g.position.x = x.current;
    g.position.z = 0;
    g.position.y = BELT_Y + 0.04 + (moving ? Math.abs(Math.sin(Date.now() / 90)) * 0.012 : 0);
    g.rotation.y = moving ? Math.sin(Date.now() / 200) * 0.03 : 0;
    cargoWorld.set(g.position.x, g.position.y + 0.19, g.position.z);

    // 交付站：停留 0.9 秒后滑进出口
    if (st === "deliver") {
      deliverT.current += d;
      if (deliverT.current > 0.5) {
        mode.current = "exit";
        exitT.current = 0;
      }
    }
  });

  return (
    <group ref={ref} name="CARGO" position={[STATION_X.receive, BELT_Y + 0.04, 0]}>
      {has ? (
        <GenProp id="crate" height={0.34} position={[0, -0.16, 0]} folder="factory" />
      ) : (
        <>
          <mesh>
            <boxGeometry args={[0.42, 0.32, 0.42]} />
            <primitive object={new THREE.MeshStandardMaterial({ color: "#c99257", roughness: 0.85 })} attach="material" />
          </mesh>
          <mesh>
            <boxGeometry args={[0.44, 0.07, 0.44]} />
            <primitive object={new THREE.MeshStandardMaterial({ color: "#efe3c4", roughness: 0.7 })} attach="material" />
          </mesh>
        </>
      )}
      {/* 货上的指示灯 */}
      <mesh position={[0, 0.17, 0]}>
        <sphereGeometry args={[0.045, 10, 10]} />
        <primitive object={glow("#7cf0b6")} attach="material" />
      </mesh>
      <pointLight position={[0, 0.3, 0]} intensity={0.9} distance={1.6} decay={2} color="#7cf0b6" />
    </group>
  );
}

/** 皮带上流动的在制品（装饰用） */
function FlowItems() {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.children.forEach((ch, i) => {
      ch.position.x += dt * 0.9;
      if (ch.position.x > 8.2) ch.position.x = -8.2 - i * 0.4;
    });
  });
  const xs = [-7.6, -5.2, -3.4, 1.1, 4.4, 6.2];
  return (
    <group ref={ref}>
      {xs.map((x, i) => (
        <group key={i} position={[x, BELT_Y + 0.06, 0]}>
          <mesh>
            <boxGeometry args={[0.34, 0.3, 0.34]} />
            <primitive object={new THREE.MeshStandardMaterial({ color: "#dcd6cc", roughness: 0.75 })} attach="material" />
          </mesh>
          <mesh>
            <boxGeometry args={[0.36, 0.05, 0.36]} />
            <primitive object={new THREE.MeshStandardMaterial({ color: "#c2483c", roughness: 0.6 })} attach="material" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
/* ---------------------------------------------------------------- 站位标记 */

function StationMark({ k }: { k: keyof typeof STATION_X }) {
  const active = useOffice((s) => s.stage === k);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!ringRef.current) return;
    const m = ringRef.current.material as THREE.MeshBasicMaterial;
    m.opacity = active ? 0.85 : 0.22;
  });

  return (
    <group name="STATION" position={[STATION_X[k], 0, 0]}>
      <mesh ref={ringRef} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.95, 1.15, 48]} />
        <primitive object={glow(STATION_COLOR[k], 0.3)} attach="material" />
      </mesh>
      <pointLight position={[0, 0.6, 0]} intensity={active ? 1.4 : 0.1} distance={3} decay={2} color={STATION_COLOR[k]} />
    </group>
  );
}

/* ---------------------------------------------------------------- 厂房 */

function Sign({ x, y, kind }: { x: number; y: number; kind: "warn" | "power" | "stop" }) {
  const tex = useMemo(() => makeSignTexture(kind), [kind]);
  return (
    <mesh position={[x, y, -5.14]}>
      <planeGeometry args={[0.85, 0.85]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

/** 出口卷帘门：横向帘片 */
function makeShutterTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2f373e";
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) {
    const grad = g.createLinearGradient(0, y, 0, y + 16);
    grad.addColorStop(0, "#4a545d");
    grad.addColorStop(0.5, "#39424a");
    grad.addColorStop(1, "#232a30");
    g.fillStyle = grad;
    g.fillRect(0, y, 256, 14);
    g.fillStyle = "rgba(120,132,142,0.25)";
    g.fillRect(0, y, 256, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
function makePanelTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  // 底
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "#8f9aa4");
  grad.addColorStop(1, "#77828d");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  // 板缝
  g.strokeStyle = "rgba(40,48,56,0.55)";
  g.lineWidth = 3;
  for (let y = 0; y <= 512; y += 128) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
  }
  for (let x = 0; x <= 512; x += 170) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 512);
    g.stroke();
  }
  // 铆钉
  for (let y = 16; y < 512; y += 32) {
    for (let x = 16; x < 512; x += 34) {
      g.fillStyle = "rgba(210,220,228,0.55)";
      g.beginPath();
      g.arc(x, y, 2.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(50,58,66,0.35)";
      g.beginPath();
      g.arc(x + 1, y + 1.4, 1.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 污渍
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(60,66,72,${0.02 + Math.random() * 0.05})`;
    g.beginPath();
    g.ellipse(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 70, 12 + Math.random() * 40, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}
function WallPanels() {
  const tex = useMemo(() => makePanelTexture(), []);
  return (
    <group>
      {[[-8.5, 1.6], [-3.2, 1.2], [2.1, 1.5], [7.3, 1.3]].map(([x, w], i) => (
        <mesh key={i} position={[x, 2.6, -5.12]}>
          <planeGeometry args={[w * 2.4, 3.2]} />
          <meshStandardMaterial map={tex} roughness={0.72} metalness={0.45} />
        </mesh>
      ))}
    </group>
  );
}

function Hall() {
  return (
    <group>
      {/* 地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[26, 14]} />
        <primitive object={new THREE.MeshStandardMaterial({ color: "#6c757e", roughness: 0.35, metalness: 0.35 })} attach="material" />
      </mesh>
      {/* 厂区标线：皮带两侧的黄色安全线 */}
      {[-1.1, 1.1].map((z) => (
        <mesh key={`y${z}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, z]}>
          <planeGeometry args={[19, 0.14]} />
          <primitive object={new THREE.MeshBasicMaterial({ color: "#e8c34a", toneMapped: false })} attach="material" />
        </mesh>
      ))}
      {/* 站位前后的斑马线 */}
      {[-5.2, 0.4, 4.6].map((x) => (
        <group key={`z${x}`} position={[x, 0, 0]}>
          {Array.from({ length: 7 }).map((_, i) => (
            <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, -1.5 + i * 0.5]}>
              <planeGeometry args={[0.22, 0.24]} />
              <primitive object={new THREE.MeshBasicMaterial({ color: "#d8dde3", toneMapped: false })} attach="material" />
            </mesh>
          ))}
        </group>
      ))}
      {/* 地面轨道缝 */}
      {[-3.2, 3.2].map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, z]}>
          <planeGeometry args={[26, 0.08]} />
          <primitive object={glow("#4a5560", 0.5)} attach="material" />
        </mesh>
      ))}
      {/* 后墙 */}
      <mesh position={[0, 3.5, -5.2]}>
        <planeGeometry args={[26, 7]} />
        <primitive object={new THREE.MeshStandardMaterial({ color: "#9aa4ad", roughness: 0.9 })} attach="material" />
      </mesh>
      {/* 后墙钢板 */}
      <WallPanels />
      {/* 墙上的管道 */}
      {[4.6, 5.35].map((y, k) => (
        <mesh key={`p${k}`} position={[0, y, -5.1]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.09, 0.09, 24, 12]} />
          <primitive object={metal(k === 0 ? "#5d6873" : "#7a5a3c", 0.6, 0.4)} attach="material" />
        </mesh>
      ))}
      {/* 管道吊架 */}
      {[-6, -2, 2, 6].map((x) => (
        <mesh key={`h${x}`} position={[x, 4.95, -5.02]}>
          <boxGeometry args={[0.07, 1.0, 0.07]} />
          <primitive object={metal("#333c45")} attach="material" />
        </mesh>
      ))}
      {/* 墙上的警示牌 */}
      <Sign x={-4.4} y={2.3} kind="warn" />
      <Sign x={1.4} y={2.3} kind="power" />
      <Sign x={6.2} y={2.3} kind="stop" />
      {/* 配电箱 */}
      {[-3.0, 4.2].map((x) => (
        <group key={`c${x}`} position={[x, 1.1, -4.9]}>
          <mesh>
            <boxGeometry args={[1.1, 1.6, 0.5]} />
            <primitive object={metal("#4a5560")} attach="material" />
          </mesh>
          <mesh position={[0, 0.35, 0.26]}>
            <boxGeometry args={[0.5, 0.3, 0.02]} />
            <primitive object={new THREE.MeshBasicMaterial({ color: "#7cf0b6", toneMapped: false })} attach="material" />
          </mesh>
        </group>
      ))}
      {/* 顶部桁架 */}
      {[-4, 0, 4].map((z) => (
        <mesh key={z} position={[0, 5.4, z]}>
          <boxGeometry args={[26, 0.16, 0.16]} />
          <primitive object={metal("#333c45")} attach="material" />
        </mesh>
      ))}
      {/* 吊灯 */}
      {[-7, -2.5, 2, 6.5].map((x) => (
        <group key={x} position={[x, 4.6, 0.6]}>
          <mesh position={[0, 0.9, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 1.8, 6]} />
            <primitive object={metal("#4a5560")} attach="material" />
          </mesh>
          <mesh>
            <coneGeometry args={[0.34, 0.26, 16, 1, true]} />
            <primitive object={metal("#6b7683", 0.5, 0.6)} attach="material" />
          </mesh>
          <pointLight position={[0, -0.2, 0]} intensity={7.5} distance={12} decay={2} color="#eaf4ff" />
        </group>
      ))}
    </group>
  );
}

/* ---------------------------------------------------------------- 镜头 */

function LineCamera() {
  const stage = useOffice((s) => s.stage);
  const { camera } = useThree();
  const x = useRef(STATION_X.receive);

  useFrame((_, dt) => {
    const target = stage === "idle" ? -4 : STATION_X[stage as keyof typeof STATION_X] ?? -4;
    x.current += (target - x.current) * Math.min(1, dt * 2.2);
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.fov !== 42) {
      cam.fov = 42;
      cam.updateProjectionMatrix();
    }
    // 3/4 侧后方，跟着当前站位走
    cam.position.set(x.current + 3.4, 3.1, 6.4);
    cam.lookAt(x.current - 0.4, 1.35, -0.2);
  });
  return null;
}
export function Factory() {
  const stage = useOffice((s) => s.stage);
  const keys = Object.keys(STATION_X) as (keyof typeof STATION_X)[];
  // 有生成模型就用生成的，没有就回退到手拼件
  const gen = useAvailableProps(["conveyor", "processor", "robotarm", "crate", "chute", "recycle"], "factory");

  return (
    <group>
      <ambientLight intensity={2.6} color="#cfe0ee" />
      <hemisphereLight args={["#e8f2fa", "#8894a0", 2.2]} />
      <directionalLight position={[6, 12, 8]} intensity={2.8} color="#ffffff" castShadow shadow-mapSize={[2048, 2048]} />
      <Hall />
      <Belt has={!!gen.conveyor} />
      {/* 背景平行产线：只放皮带做纵深 */}
      <group position={[0, 0, -3.1]}>
        <Belt has={!!gen.conveyor} />
      </group>
      {keys.map((k) => (
        <StationMark key={k} k={k} />
      ))}
      <ThinkBox active={stage === "think"} has={!!gen.processor} />
      <RobotStation active={stage === "execute"} has={!!(gen.robotarm || true)} model="robotarm2" press={stage === "execute" ? 1 : 0} />
      <RecycleStation has={!!gen.recycle} />
      <ErrorVfx />
      <ExitStation active={stage === "deliver"} has={!!gen.chute} />
      <Cargo has={!!gen.crate} />
      <LineCamera />
    </group>
  );
}

export { LABEL, STATION_X, STATION_COLOR };
