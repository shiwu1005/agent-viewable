import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, useGLTF } from "@react-three/drei";
import { useOffice, type AgentView, propOf } from "../probe/model";
import { WorkerModel, useWorkerAvailable } from "./Character";
import { Studio } from "./Studio";
import { getPos, setPos } from "./registry";
import { CaptureDriver } from "./CaptureDriver";
import { Rooms } from "./Rooms";
import { Factory } from "./Factory";
import { STATION_POS, STATION_YAW, STATION_CLIP, STAGE_LABEL } from "./pipeline";
import { CAM_KEYS, CAM_PRESETS, readCamPreset, devRegister, devUnregister, getHardCam, type CamPreset } from "../dev/devkit";

/* ------------------------------------------------------------------ 布局 */

const DOOR = new THREE.Vector3(-6.84, 0, -1.1);
const DOOR_OUT = new THREE.Vector3(-8.0, 0, -1.1);

const SLOTS: [number, number][] = [
  [-3.3, -0.5],
  [-2.7, 1.0],
  [2.9, -0.7],
  [3.2, 0.6],
  [-1.7, -3.3],
  [2.1, -3.4],
  [1.4, -4.4],
];

const DESK = new THREE.Vector3(0.4, 0, -1.9);
// 坐的位置 = 桌子中心 + 椅子偏移(0,0,+1.0)，正好落在椅子上
const DESK_BACK = new THREE.Vector3(0.4, 0, -1.42);
const APPROVAL_SPOT = new THREE.Vector3(-3.6, 0, 0.6);

const WALK_MS = 950;
/** 坐下时整个人抬多高（坐垫高度） */
const SEAT_LIFT = 0; // 站立工位，不需要抬
/** 同时派活时，每个人晚一点进门，形成排队效果 */
const SPAWN_GAP = 170;

/** 角度插值（走最短路径），避免转身时转一整圈 */
function dampAngle(cur: number, target: number, lambda: number) {
  let d = (target - cur) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return cur + d * Math.min(1, lambda * 0.06);
}

const PALETTE = ["#e8574a", "#e8a33d", "#5fb8e8", "#7bc96f", "#b07be0", "#e07bb0", "#4fd1c5"];

const PROP_COLOR: Record<string, string> = {
  search: "#f2c14e",
  exec: "#7bd0ff",
  file: "#ffffff",
  deliver: "#ffd166",
  misc: "#9aa4b2",
};

function bezier(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) {
  const it = 1 - t;
  out.set(
    it * it * a.x + 2 * it * t * c.x + t * t * b.x,
    it * it * a.y + 2 * it * t * c.y + t * t * b.y,
    it * it * a.z + 2 * it * t * c.z + t * t * b.z,
  );
  return out;
}

/* -------------------------------------------------- 小人的身份标记 */

/** 每个小人一种标记色（编号牌 + 地垫） */
const AGENT_TAG = ["#e8574a", "#e8a33d", "#5fb8e8", "#7bc96f", "#b07be0", "#e07bb0", "#4fd1c5"];

const tagCache = new Map<string, THREE.Texture>();

function tagTexture(n: number, color: string) {
  const key = `${n}-${color}`;
  const hit = tagCache.get(key);
  if (hit) return hit;

  const S = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;
  ctx.beginPath();
  ctx.roundRect(4, 24, S - 8, S - 48, 26);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 62px ui-monospace, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n).padStart(2, "0"), S / 2, S / 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tagCache.set(key, tex);
  return tex;
}

function NumberTag({ n, color, callId }: { n: number; color: string; callId: string }) {
  const tex = useMemo(() => tagTexture(n, color), [n, color]);
  const setFollowKey = useOffice((s) => s.setFollowKey);
  const setCameraMode = useOffice((s) => s.setCameraMode);
  return (
    <sprite
      position={[0, 2.35, 0]}
      scale={[0.46, 0.46, 1]}
      onClick={(e) => {
        e.stopPropagation();
        setFollowKey(callId);
        setCameraMode("follow");
      }}
    >
      <spriteMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

/* ------------------------------------------------------------------ 房间 */

function Room() {
  const screenMat = useRef<THREE.MeshBasicMaterial>(null!);
  const lampRef = useRef<THREE.PointLight>(null!);
  const ambRef = useRef<THREE.AmbientLight>(null!);
  const phase = useOffice((s) => s.phase);
  const stage = useOffice((s) => s.stage);
  const errorCount = useOffice((s) => s.errorCount);
  const deliverCount = useOffice((s) => s.deliverCount);
  const flashAt = useRef(0);
  useEffect(() => {
    if (errorCount > 0) flashAt.current = Date.now();
  }, [errorCount]);
  useFrame(() => {
    if (!screenMat.current) return;
    const since = flashAt.current ? (Date.now() - flashAt.current) / 1000 : 99;
    if (since < 2.6) {
      // 蓝屏
      const k = 1 - since / 2.6;
      screenMat.current.color.setRGB(0.08 + k * 0.1, 0.18 + k * 0.25, 0.55 + k * 0.3);
    } else if (deliverCount > 0) {
      screenMat.current.color.set("#6fd3a0");
    } else {
      screenMat.current.color.set("#3d7ea6");
    }
  });

  const sky = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, "#0e1b2e");
    g.addColorStop(0.65, "#1d3350");
    g.addColorStop(1, "#3a5a7a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }, []);

  return (
    <group>
      {/* 地板 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 13]} />
        <meshStandardMaterial color="#2b3040" roughness={0.95} />
      </mesh>

      {/* 地毯 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 1.4]}>
        <planeGeometry args={[8.4, 5.2]} />
        <meshStandardMaterial color="#2b303d" roughness={1} />
      </mesh>

      {/* 后墙 */}
      <mesh position={[0, 2.3, -5.4]}>
        <planeGeometry args={[14, 4.6]} />
        <meshStandardMaterial color="#2c3242" roughness={1} />
      </mesh>

      {/* 左墙 */}
      <mesh position={[-6.9, 2.3, 0.5]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[13, 4.6]} />
        <meshStandardMaterial color="#262c3a" roughness={1} />
      </mesh>

      {/* 门框 */}
      <group position={[DOOR.x - 0.03, 0, DOOR.z]} rotation={[0, Math.PI / 2, 0]}>
        <mesh position={[0, 1.15, -0.85]}>
          <boxGeometry args={[0.12, 2.3, 0.14]} />
          <meshStandardMaterial color="#3a4152" />
        </mesh>
        <mesh position={[0, 1.15, 0.85]}>
          <boxGeometry args={[0.12, 2.3, 0.14]} />
          <meshStandardMaterial color="#3a4152" />
        </mesh>
        <mesh position={[0, 2.3, 0]}>
          <boxGeometry args={[0.12, 0.14, 1.84]} />
          <meshStandardMaterial color="#3a4152" />
        </mesh>
        {/* 门洞里的光 */}
        <mesh position={[0.05, 1.1, 0]} rotation={[0, 0, 0]}>
          <planeGeometry args={[1.55, 2.14]} />
          <meshStandardMaterial color="#2b3345" roughness={0.85} />
        </mesh>
        <mesh position={[0.12, 1.05, 0.62]}>
          <boxGeometry args={[0.06, 0.06, 0.18]} />
          <meshStandardMaterial color="#c9a45a" />
        </mesh>
        <pointLight position={[0.6, 1.4, 0]} color="#7fb6ff" intensity={2.2} distance={6} decay={2} />
      </group>

      {/* 窗户 */}
      <group position={[-3.4, 2.4, -5.36]}>
        <mesh>
          <planeGeometry args={[2.6, 1.5]} />
          <meshBasicMaterial map={sky} />
        </mesh>
        <mesh position={[0, 0, 0.01]}>
          <planeGeometry args={[2.6, 0.06]} />
          <meshStandardMaterial color="#2b3241" />
        </mesh>
        <mesh position={[0, 0, 0.01]}>
          <planeGeometry args={[0.06, 1.5]} />
          <meshStandardMaterial color="#2b3241" />
        </mesh>
      </group>

      {/* 工位 */}
      <group position={[DESK.x, 0, DESK.z]}>
        <mesh position={[0, 0.74, 0]}>
          <boxGeometry args={[3.0, 0.09, 1.35]} />
          <meshStandardMaterial color="#3b4152" roughness={0.7} />
        </mesh>
        {[
          [-1.36, -0.56],
          [1.36, -0.56],
          [-1.36, 0.56],
          [1.36, 0.56],
        ].map(([x, z], i) => (
          <mesh key={i} position={[x, 0.36, z]}>
            <boxGeometry args={[0.1, 0.72, 0.1]} />
            <meshStandardMaterial color="#2a2f3b" />
          </mesh>
        ))}

        {/* 显示器 */}
        <group position={[-0.55, 0.78, -0.25]}>
          <mesh position={[0, 0.32, 0]}>
            <boxGeometry args={[1.05, 0.64, 0.05]} />
            <meshStandardMaterial color="#0f1218" />
          </mesh>
          <mesh position={[0, 0.32, 0.032]}>
            <planeGeometry args={[0.98, 0.57]} />
            <meshBasicMaterial ref={screenMat} color="#3d7ea6" />
          </mesh>
          <mesh position={[0, 0.06, 0]}>
            <boxGeometry args={[0.08, 0.14, 0.08]} />
            <meshStandardMaterial color="#2a2f3b" />
          </mesh>
        </group>


        {/* 台灯 */}
        <group position={[1.1, 0.78, -0.2]}>
          <mesh position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.12, 0.14, 0.04, 12]} />
            <meshStandardMaterial color="#2a2f3b" />
          </mesh>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.56, 8]} />
            <meshStandardMaterial color="#3a4152" />
          </mesh>
          <mesh position={[0, 0.6, 0]} rotation={[0.5, 0, 0]}>
            <coneGeometry args={[0.18, 0.2, 12, 1, true]} />
            <meshStandardMaterial color="#4a5163" side={THREE.DoubleSide} />
          </mesh>
          <pointLight ref={lampRef} position={[0, 0.5, 0.1]} color="#ffcf8f" intensity={3.2} distance={7} decay={2} />
        </group>

        {/* 椅子（挪到桌子后面，别挡人） */}
        <group position={[-0.1, 0, -1.05]}>
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.6, 0.08, 0.55]} />
            <meshStandardMaterial color="#33384a" />
          </mesh>
          <mesh position={[0, 0.85, -0.26]}>
            <boxGeometry args={[0.6, 0.7, 0.08]} />
            <meshStandardMaterial color="#33384a" />
          </mesh>
        </group>
      </group>

      {/* 墙上的大屏 */}
      <group position={[4.6, 2.5, -5.34]}>
        <mesh>
          <planeGeometry args={[3.0, 1.7]} />
          <meshStandardMaterial color="#0b0f16" emissive="#1b3a52" emissiveIntensity={1.1} />
        </mesh>
      </group>

      {/* 档案柜 */}
      <group position={[-4.4, 0, -4.9]}>
        <mesh position={[0, 0.8, 0]}>
          <boxGeometry args={[1.1, 1.6, 0.5]} />
          <meshStandardMaterial color="#333c4e" />
        </mesh>
        {[0.35, 0.8, 1.25].map((y) => (
          <mesh key={y} position={[0, y, 0.27]}>
            <boxGeometry args={[0.92, 0.035, 0.02]} />
            <meshStandardMaterial color="#4d5a70" />
          </mesh>
        ))}
      </group>

      {/* 纸箱 */}
      <mesh position={[-5.0, 0.3, 1.7]} rotation={[0, 0.4, 0]}>
        <boxGeometry args={[0.6, 0.6, 0.6]} />
        <meshStandardMaterial color="#a8845a" />
      </mesh>
      <mesh position={[-4.55, 0.83, 1.55]} rotation={[0, -0.25, 0]}>
        <boxGeometry args={[0.45, 0.45, 0.45]} />
        <meshStandardMaterial color="#b89268" />
      </mesh>

      {/* 盆栽 */}
      <group position={[3.7, 0, -4.7]}>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.27, 0.21, 0.4, 12]} />
          <meshStandardMaterial color="#7d5a44" />
        </mesh>
        <mesh position={[0, 0.78, 0]}>
          <icosahedronGeometry args={[0.52, 0]} />
          <meshStandardMaterial color="#3f7d52" flatShading />
        </mesh>
      </group>

      <ambientLight ref={ambRef} intensity={1.55} color="#b6c8e0" />
      <directionalLight position={[5, 9, 7]} intensity={2.0} color="#cfe0ff" />
      <pointLight position={[0.5, 3.6, 6]} intensity={1.1} color="#9fb6d8" distance={20} decay={2} />
    </group>
  );
}

function Pad({ x, z, i }: { x: number; z: number; i: number }) {
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    devRegister(`pad:${i + 1}`, "pad", ref.current);
    return () => devUnregister(`pad:${i + 1}`);
  }, [i]);
  return (
    <group ref={ref} position={[x, 0, z]}>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.42, 24]} />
        <meshStandardMaterial color="#1d2b33" roughness={1} transparent opacity={0.35} />
      </mesh>
      <mesh position={[0, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.41, 0.435, 24]} />
        <meshBasicMaterial color={AGENT_TAG[i % AGENT_TAG.length]} transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

function SlotPads() {
  return (
    <group>
      {SLOTS.map(([x, z], i) => (
        <Pad key={i} x={x} z={z} i={i} />
      ))}
    </group>
  );
}

/* ---------------------------------------------------------------- 四段流水线 */

const STAGE_TINT: Record<string, string> = {
  receive: "#e8a33d",
  think: "#5fb8e8",
  execute: "#7bc96f",
  deliver: "#e8574a",
};

function Stations() {
  const stage = useOffice((s) => s.stage);
  return (
    <group>
      {(["receive", "think", "execute", "deliver"] as const).map((k, i) => {
        const p = STATION_POS[k];
        const active = stage === k;
        const color = STAGE_TINT[k];
        return (
          <group key={k} position={[p.x, 0, p.z]}>
            {/* 地面站位圈 */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]}>
              <ringGeometry args={[0.46, 0.52, 32]} />
              <meshBasicMaterial color={color} transparent opacity={active ? 0.95 : 0.22} toneMapped={false} />
            </mesh>
            {/* 序号牌 */}
            <Html position={[0, 2.05, 0]} center distanceFactor={12} zIndexRange={[6, 0]}>
              <div className={`stage-tag ${active ? "is-on" : ""}`} style={{ borderColor: color, color }}>
                <b>{i + 1}</b>
                <span>{STAGE_LABEL[k]}</span>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

/* ---------------------------------------------------------------- 主角 */

function Protagonist() {
  const grp = useRef<THREE.Group>(null!);
  const packetRef = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null!);
  const head = useRef<THREE.Mesh>(null!);
  const headMat = useRef<THREE.MeshStandardMaterial>(null!);
  const phase = useOffice((s) => s.phase);
  const stage = useOffice((s) => s.stage);
  const bubble = useOffice((s) => s.bubble);
  const errorCount = useOffice((s) => s.errorCount);
  const workerReady = useWorkerAvailable();
  const [angry, setAngry] = useState(false);
  const [typing, setTyping] = useState(true);

  // 换工位时先播走路，到站后切成该工位的动作
  const [walking, setWalking] = useState(false);
  useEffect(() => {
    if (stage === "idle") {
      setWalking(false);
      return;
    }
    setWalking(true);
    const t = window.setTimeout(() => setWalking(false), 1250);
    return () => window.clearTimeout(t);
  }, [stage]);

  // 干活时是"敲一会儿 → 靠回去想想"的节奏
  useEffect(() => {
    if (phase !== "working") {
      setTyping(true);
      return;
    }
    const id = window.setInterval(() => setTyping((v) => !v), 4200);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (errorCount <= 0) return;
    setAngry(true);
    const t = window.setTimeout(() => setAngry(false), 2600);
    return () => window.clearTimeout(t);
  }, [errorCount]);

  // 砸键盘：双手抡起来（0~0.18s）→ 砸下去（0.18~0.30s）→ 收回
  const [slamLift, setSlamLift] = useState(0);
  useEffect(() => {
    if (errorCount <= 0) return;
    const start = Date.now();
    const id = window.setInterval(() => {
      const t = (Date.now() - start) / 1000;
      if (t > 0.75) {
        setSlamLift(0);
        window.clearInterval(id);
        return;
      }
      if (t < 0.2) setSlamLift((t / 0.2) * 0.55); // 抡起
      else if (t < 0.32) setSlamLift(0.55 * (1 - (t - 0.2) / 0.12)); // 砸下
      else setSlamLift(0);
    }, 33);
    return () => window.clearInterval(id);
  }, [errorCount]);

  const errAt = useRef(0);
  useEffect(() => {
    if (errorCount > 0) errAt.current = Date.now();
  }, [errorCount]);

  const pos = useRef(new THREE.Vector3().copy(DESK_BACK));
  const target = useRef(new THREE.Vector3().copy(DESK_BACK));
  const rotY = useRef(0);
  const targetRot = useRef(0);

  useFrame((state, dt) => {
    const now = Date.now();
    const t = state.clock.elapsedTime;
    const d = Math.min(dt, 0.1);

    // 四段流水线：按阶段走到对应工位
    const st = stage === "idle" ? "execute" : stage;
    target.current.copy(STATION_POS[st]);
    targetRot.current = STATION_YAW[st];

    // 走动速度：切换工位要快，别让观众等
    const speed = 5.2;
    pos.current.x = THREE.MathUtils.damp(pos.current.x, target.current.x, speed, d);
    pos.current.z = THREE.MathUtils.damp(pos.current.z, target.current.z, speed, d);
    rotY.current = THREE.MathUtils.damp(rotY.current, targetRot.current, 3.2, d);

    if (grp.current) {
      // 只有在执行工位才坐进椅子
      const seated = stage === "execute" || stage === "idle";
      grp.current.position.set(pos.current.x, seated ? SEAT_LIFT : 0, pos.current.z);
      grp.current.rotation.y = rotY.current;
      // 登记自己的位置，否则 "跟随主角" 永远取不到点、一直退回全景
      setPos("main", grp.current.position);
    }

    // 打字时的上下抖动 / 待机时的呼吸 / 下班后的趴桌
    const working = phase === "working";
    const idle = phase === "idle";
    const done = phase === "done";
    const bob = working ? Math.abs(Math.sin(t * 9)) * 0.045 : Math.sin(t * 1.6) * 0.018;
    const slump = done ? 0.2 : 0;

    if (body.current) body.current.position.y = 0.62 + bob - slump * 0.6;
    if (head.current) {
      head.current.position.y = 1.36 + bob - slump;
      head.current.position.z = done ? 0.12 : 0;
      head.current.rotation.z = working ? Math.sin(t * 9) * 0.03 : Math.sin(t * 0.9) * 0.06;
      // 摸鱼时低头看手机
      head.current.rotation.x = idle ? 0.34 + Math.sin(t * 1.3) * 0.03 : done ? 0.5 : 0;
    }

    // 刚出错 → 脸红
    const since = (now - errAt.current) / 1000;
    const red = errAt.current && since < 4 ? Math.max(0, 1 - since / 4) : 0;
    if (headMat.current) {
      headMat.current.color.setRGB(0.93 + red * 0.07, 0.79 - red * 0.45, 0.68 - red * 0.42);
      headMat.current.emissive.setRGB(red * 0.35, 0, 0);
      headMat.current.emissiveIntensity = red;
    }
  });

  const showBubble = bubble && Date.now() - bubble.at < 6000;

  return (
    <group ref={grp} position={[DESK_BACK.x, 0, DESK_BACK.z]}>
      {/* 手里的任务卡：一张发光的小方块，跟着工位一路传下去 */}
      {stage !== "idle" && (
        <group ref={packetRef} position={[0.26, 1.02, 0.24]}>
          <mesh>
            <boxGeometry args={[0.2, 0.02, 0.14]} />
            <meshBasicMaterial color="#ffe9a8" toneMapped={false} />
          </mesh>
          <pointLight intensity={0.9} distance={1.8} decay={2} color="#ffd98a" />
        </group>
      )}

      {workerReady && (
        <Suspense fallback={null}>
          <WorkerModel
            clip={walking ? "Walk_Carry_Loop" : STATION_CLIP[stage === "idle" ? "execute" : stage]}
            height={1.58}
            angry={angry}
            devId="char:main"
            ik={
              !walking && (stage === "execute" || stage === "idle")
                ? {
                    // 坐在主桌前双手按键盘
                    points: [
                      new THREE.Vector3(0.31, 0.79 + slamLift, -1.7),
                      new THREE.Vector3(0.49, 0.79 + slamLift, -1.7),
                    ],
                    pole: new THREE.Vector3(0.4, 0.5, -0.7),
                    // 射线实测坐垫面 = 0.55
                    seatY: 0.565,
                  }
                : null
            }
          />
        </Suspense>
      )}


      <group visible={!workerReady}>
      <mesh ref={body} position={[0, 0.62, 0]}>
        <boxGeometry args={[0.68, 1.05, 0.44]} />
        <meshStandardMaterial color="#5c6d92" roughness={0.8} />
      </mesh>
      <mesh ref={head} position={[0, 1.36, 0]}>
        <boxGeometry args={[0.52, 0.5, 0.5]} />
        <meshStandardMaterial ref={headMat} color="#f5c6a0" roughness={0.75} />
      </mesh>

      {/* 摸鱼时手里的手机 */}
      {phase === "idle" && (
        <mesh position={[0.3, 0.95, 0.28]} rotation={[0.5, 0.3, 0.15]}>
          <boxGeometry args={[0.16, 0.27, 0.025]} />
          <meshStandardMaterial color="#1b2130" emissive="#6f9bff" emissiveIntensity={0.85} />
        </mesh>
      )}
      {/* 眼睛 */}
      <mesh position={[-0.11, 1.39, 0.26]}>
        <boxGeometry args={[0.08, 0.08, 0.03]} />
        <meshBasicMaterial color="#1a1a22" />
      </mesh>
      <mesh position={[0.11, 1.39, 0.26]}>
        <boxGeometry args={[0.08, 0.08, 0.03]} />
        <meshBasicMaterial color="#1a1a22" />
      </mesh>
      </group>

      {showBubble && (
        <Html position={[0, 2.25, 0]} center distanceFactor={9} zIndexRange={[6, 0]}>
          <div className="bubble">{bubble!.text}</div>
        </Html>
      )}
    </group>
  );
}

/* ---------------------------------------------------------------- 小人 */

function Actor({ agent }: { agent: AgentView }) {
  const grp = useRef<THREE.Group>(null!);
  const packetRef = useRef<THREE.Group>(null);
  const hand = useRef<THREE.Mesh>(null!);
  const workerReady = useWorkerAvailable();

  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    if (agent.state === "out" || agent.state === "kick") {
      setArrived(false);
      return;
    }
    const left = Math.max(0, agent.walkMs + SPAWN_GAP * agent.slot - (Date.now() - agent.bornAt));
    const t = window.setTimeout(() => setArrived(true), left);
    return () => window.clearTimeout(t);
  }, [agent.bornAt, agent.state, agent.walkMs, agent.slot]);

  const slotPos = useMemo(() => {
    const [x, z] = SLOTS[agent.slot % SLOTS.length];
    return new THREE.Vector3(x, 0, z);
  }, [agent.slot]);

  const ctrlIn = useMemo(
    () =>
      new THREE.Vector3(
        (DOOR.x + slotPos.x) / 2 - 0.2,
        0,
        // 固定走桌子前面那条走廊，别穿桌子也别穿沙发
        1.0,
      ),
    [slotPos],
  );
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const color = PALETTE[agent.slot % PALETTE.length];
  const propColor = PROP_COLOR[propOf(agent.tool)] || "#9aa4b2";

  useFrame((state) => {
    const now = Date.now();
    const t = state.clock.elapsedTime;
    if (!grp.current) return;

    // bornAt 可能在未来（排队进场），必须夹住，否则算负缩放会把人塞进地板
    const scaleIn = Math.max(0, Math.min(1, (now - agent.bornAt) / 180));

    if (agent.state === "in" || agent.state === "work") {
      // 出生时间可以晚于现在（排队进场），所以进度要夹在 0 以上
      const p = Math.max(0, Math.min(1, (now - agent.bornAt) / agent.walkMs));
      bezier(DOOR, ctrlIn, slotPos, p, tmp);
      tmp.y = Math.abs(Math.sin(p * Math.PI * 4)) * 0.05;
      grp.current.position.copy(tmp);
      const faceMove = Math.atan2(slotPos.x - DOOR.x, slotPos.z - DOOR.z);
      const faceStand = Math.PI * 0.72;
      const wantYaw = p < 0.92 ? faceMove : faceStand;
      grp.current.rotation.y = dampAngle(grp.current.rotation.y, wantYaw, 6);
      if (p >= 1) {
        grp.current.position.y = Math.abs(Math.sin(t * 7)) * 0.04;
        // 站定后转成 3/4 侧身，别把后背留给镜头
        grp.current.rotation.y = Math.PI * 0.72 + Math.sin(t * 2) * 0.12;
      }
    } else if (agent.state === "out") {
      const p = Math.min(1, (now - (agent.endAt ?? now)) / agent.walkMs);
      bezier(slotPos, ctrlIn, DOOR, p, tmp);
      tmp.y = Math.abs(Math.sin(p * Math.PI * 4)) * 0.05;
      grp.current.position.copy(tmp);
      grp.current.rotation.y = Math.atan2(DOOR.x - slotPos.x, DOOR.z - slotPos.z);
      grp.current.scale.setScalar(Math.max(0.001, 1 - Math.max(0, p - 0.85) / 0.15));
      if (p >= 1) grp.current.visible = false;
    } else {
      // 被踢：不是倒地当尸体，是缩着脑袋小跑出门（走快一点、身子往前倾）
      const p = Math.min(1, (now - (agent.endAt ?? now)) / (agent.walkMs * 0.55));
      bezier(slotPos, ctrlIn, DOOR_OUT, p, tmp);
      tmp.y = Math.abs(Math.sin(p * Math.PI * 3)) * 0.03;
      grp.current.position.copy(tmp);
      grp.current.rotation.y = dampAngle(
        grp.current.rotation.y,
        Math.atan2(DOOR_OUT.x - slotPos.x, DOOR_OUT.z - slotPos.z),
        9,
      );
      // 前倾一点，看得出是在"逃"
      grp.current.rotation.x = 0.16 * Math.min(1, p * 3);
      grp.current.scale.setScalar(Math.max(0.001, 1 - Math.max(0, p - 0.82) / 0.18));
      if (p >= 1) grp.current.visible = false;
    }

    // 有 GLB 时按真人比例（1.58），否则用方块的小比例
    const base = workerReady ? 1 : 0.52;
    if (agent.state !== "out" && agent.state !== "kick") grp.current.scale.setScalar(base * scaleIn);
    if (hand.current) hand.current.position.y = 0.34 + Math.sin(t * 12) * 0.03;
    setPos("agent:" + agent.callId, grp.current.position);
  });

  return (
    <group ref={grp} scale={0.001}>
      {workerReady && (
        <Suspense fallback={null}>
          <WorkerModel
            clip={agent.state === "out" ? (agent.isError ? "Idle_Loop" : "Walk_Carry_Loop") : !arrived ? "Walk_Carry_Loop" : agent.workClip}
            height={1.58}
            tint={AGENT_TAG[agent.slot % AGENT_TAG.length]}
            prop={PROP_COLOR[propOf(agent.tool)] || "#9aa4b2"}
            devId={`char:agent:${agent.callId}`}
          />
        </Suspense>
      )}
      {workerReady && <NumberTag n={agent.slot + 1} color={AGENT_TAG[agent.slot % AGENT_TAG.length]} callId={agent.callId} />}

      <group visible={!workerReady}>
        <mesh position={[0, 0.23, 0]}>
          <boxGeometry args={[0.34, 0.44, 0.26]} />
          <meshStandardMaterial color={color} roughness={0.75} />
        </mesh>
        <mesh position={[0, 0.55, 0]}>
          <boxGeometry args={[0.3, 0.28, 0.28]} />
          <meshStandardMaterial color="#f0d3b8" roughness={0.8} />
        </mesh>
        <mesh ref={hand} position={[0.19, 0.34, 0.06]}>
          <boxGeometry args={[0.12, 0.16, 0.1]} />
          <meshStandardMaterial color={propColor} emissive={propColor} emissiveIntensity={0.35} />
        </mesh>
      </group>
    </group>
  );
}

function Agents() {
  const agents = useOffice((s) => s.agents);
  const gc = useOffice((s) => s.gc);
  useFrame(() => gc(Date.now()));
  return (
    <>
      {agents.map((a) => (
        <Actor key={a.callId} agent={a} />
      ))}
    </>
  );
}

/* ---------------------------------------------------------------- 标示 */

function HangingProps() {
  const agents = useOffice((s) => s.agents);
  const tokens = useOffice((s) => s.tokens);
  const toolCount = useOffice((s) => s.toolCount);
  const active = agents.filter((a) => a.state === "in" || a.state === "work").length;

  return (
    <>
      {/* 门框计数器 */}
      <Html position={[DOOR.x + 0.3, 2.65, DOOR.z]} center distanceFactor={11} zIndexRange={[6, 0]}>
        <div className={`counter ${active > 0 ? "on" : ""}`}>
          <span className="counter-n">{active}</span>
          <span className="counter-k">在跑</span>
        </div>
      </Html>

      {/* 墙上大屏 */}
      <Html position={[4.6, 2.5, -5.3]} center distanceFactor={13} zIndexRange={[6, 0]}>
        <div className="screen">
          <div className="screen-row">
            <span>token</span>
            <b>{tokens.toLocaleString()}</b>
          </div>
          <div className="screen-row">
            <span>工具</span>
            <b>{toolCount}</b>
          </div>
          <div className="screen-row">
            <span>并行</span>
            <b>{active}</b>
          </div>
        </div>
      </Html>
    </>
  );
}

/* ---------------------------------------------------------------- 相机 */

function CameraRig() {
  const { camera } = useThree();
  const mode = useOffice((s) => s.cameraMode);
  const followKey = useOffice((s) => s.followKey);
  const phase = useOffice((s) => s.phase);
  const stage = useOffice((s) => s.stage);

  const desiredPos = useRef(new THREE.Vector3(4.9, 3.6, 7.4));

  // 调试机位：?cam=desk / deskside / door / lounge / wide，数字键 1-5 现场切换
  const [preset, setPreset] = useState<CamPreset | null>(() => readCamPreset());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = Number(e.key);
      if (!Number.isFinite(i) || i < 1 || i > CAM_KEYS.length) return;
      setPreset(CAM_PRESETS[CAM_KEYS[i - 1]]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!preset) return;
    camera.position.set(preset.pos[0], preset.pos[1], preset.pos[2]);
    camera.lookAt(preset.look[0], preset.look[1], preset.look[2]);
  }, [camera, preset]);
  const desiredTarget = useRef(new THREE.Vector3(-0.4, 1.15, -1.2));
  const target = useRef(new THREE.Vector3(-0.4, 1.15, -1.2));
  const inited = useRef(false);

  useEffect(() => {
    if (inited.current || preset) return;
    inited.current = true;
    camera.position.set(6.2, 4.2, 8.8);
    camera.lookAt(-0.4, 1.15, -1.2);
  }, [camera, preset]);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.1);
    // 硬切机位（录制时按分镜表切镜头）
    const hard = getHardCam();
    if (hard) {
      camera.position.set(hard.pos[0], hard.pos[1], hard.pos[2]);
      camera.lookAt(hard.look[0], hard.look[1], hard.look[2]);
      return;
    }
    if (preset) return; // 调试机位锁死，别被运镜覆盖
    if (mode === "orbit") return; // 交给 OrbitControls

    if (mode === "follow" && followKey) {
      const p = getPos(followKey);
      if (p) {
        // 站在目标斜后方，略微俯视
        desiredPos.current.set(p.x + 2.6, p.y + 1.9, p.z + 3.4);
        desiredTarget.current.set(p.x, p.y + 0.95, p.z);
      } else {
        // 这个 agent 已经走了，退回导演运镜
        desiredPos.current.set(4.9, 3.6, 7.4);
        desiredTarget.current.set(-0.4, 1.15, -1.2);
      }
    } else if (phase === "approval") {
      desiredPos.current.set(-0.9, 2.3, 4.9);
      desiredTarget.current.set(-3.4, 1.2, 0.6);
    } else {
      const t = state.clock.elapsedTime;
      const sway = Math.sin(t * 0.18) * 0.4;
      desiredPos.current.set(4.9 + sway, 3.6, 7.4);
      desiredTarget.current.set(-0.4, 1.15, -1.2);
    }

    const lam = mode === "follow" ? 2.2 : 1.4;
    camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredPos.current.x, lam, d);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredPos.current.y, lam, d);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredPos.current.z, lam, d);

    target.current.x = THREE.MathUtils.damp(target.current.x, desiredTarget.current.x, 2.0, d);
    target.current.y = THREE.MathUtils.damp(target.current.y, desiredTarget.current.y, 2.0, d);
    target.current.z = THREE.MathUtils.damp(target.current.z, desiredTarget.current.z, 2.0, d);

    camera.lookAt(target.current);
  });

  if (mode === "orbit") {
    return (
      <OrbitControls
        makeDefault
        enablePan
        minDistance={3}
        maxDistance={26}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 1.15, -1.2]}
        enableDamping
        dampingFactor={0.08}
      />
    );
  }
  return null;
}

/* ---------------------------------------------------------------- 场景 */

/* ---------------------------------------------------------------- 爆点 */

// 键盘的真实位置（和 Desk 里的一致）
const KEYBOARD_POS = new THREE.Vector3(0.4, 0.8, -1.7);
const MONITOR_POS = new THREE.Vector3(-0.15, 1.12, -2.19);
const FLY_TO = new THREE.Vector3(1.6, 2.6, 6.4);
const SHARD_COUNT = 10;
const PUFF_COUNT = 7;
/** 主角头顶，冒烟从这里出来 */
const HEAD_POS = new THREE.Vector3(0.4, 1.6, -1.42);

function Drama() {
  const errorCount = useOffice((s) => s.errorCount);
  const deliverCount = useOffice((s) => s.deliverCount);

  const kbRef = useRef<THREE.Mesh>(null!);
  const fileRef = useRef<THREE.Mesh>(null!);
  const shardRefs = useRef<(THREE.Mesh | null)[]>([]);
  const kb = useRef({ active: false, t: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
  const shards = useRef(
    Array.from({ length: SHARD_COUNT }, () => ({
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      r: new THREE.Euler(),
      life: 0,
    })),
  );
  const file = useRef({ active: false, t: 0 });
  const lastErr = useRef(0);
  const lastDeliver = useRef(0);

  // 冒烟：红温时头顶往外喷白烟，比染色更好读
  const puffRefs = useRef<(THREE.Mesh | null)[]>([]);
  const puffs = useRef(
    Array.from({ length: PUFF_COUNT }, () => ({
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      life: 0,
      size: 1,
    })),
  );

  useEffect(() => {
    if (errorCount <= lastErr.current) return;
    lastErr.current = errorCount;
    puffs.current.forEach((q, i) => {
      q.p.copy(HEAD_POS).add(
        new THREE.Vector3((Math.random() - 0.5) * 0.28, Math.random() * 0.12, (Math.random() - 0.5) * 0.2),
      );
      q.v.set((Math.random() - 0.5) * 0.22, 0.32 + Math.random() * 0.2, (Math.random() - 0.5) * 0.18);
      q.life = 1;
      q.size = 0.5 + i * 0.12;
    });
  });

  useEffect(() => {
    if (errorCount <= lastErr.current) return;
    lastErr.current = errorCount;
    kb.current.active = true;
    kb.current.t = 0;
    kb.current.vel.set(0.9 + Math.random() * 0.7, 2.9, 0.7);
    kb.current.spin.set(6, 4, 9);
    for (const s of shards.current) {
      s.p.copy(KEYBOARD_POS).add(new THREE.Vector3((Math.random() - 0.5) * 0.55, 0, (Math.random() - 0.5) * 0.2));
      s.v.set((Math.random() - 0.5) * 3.4, 1.6 + Math.random() * 2.8, (Math.random() - 0.5) * 2.6);
      s.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      s.r.set(0, 0, 0);
      s.life = 1.5;
    }
  }, [errorCount]);

  useEffect(() => {
    if (deliverCount <= lastDeliver.current) return;
    lastDeliver.current = deliverCount;
    file.current.active = true;
    file.current.t = 0;
  }, [deliverCount]);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    const k = kb.current;

    if (kbRef.current) {
      if (k.active) {
        k.t += d;
        if (k.t < 1.7) {
          k.vel.y -= 10.5 * d;
          kbRef.current.position.addScaledVector(k.vel, d);
          kbRef.current.rotation.x += k.spin.x * d;
          kbRef.current.rotation.y += k.spin.y * d;
          kbRef.current.rotation.z += k.spin.z * d;
          kbRef.current.visible = true;
        } else {
          kbRef.current.visible = false;
          if (k.t > 3.4) {
            k.active = false;
            kbRef.current.position.copy(KEYBOARD_POS);
            kbRef.current.rotation.set(0, 0, 0);
            kbRef.current.visible = true;
          }
        }
      } else {
        kbRef.current.position.copy(KEYBOARD_POS);
        kbRef.current.visible = true;
      }
    }

    for (let i = 0; i < shards.current.length; i++) {
      const s = shards.current[i];
      const m = shardRefs.current[i];
      if (!m) continue;
      if (s.life > 0) {
        s.life -= d;
        s.v.y -= 11 * d;
        s.p.addScaledVector(s.v, d);
        s.r.x += s.spin.x * d;
        s.r.y += s.spin.y * d;
        s.r.z += s.spin.z * d;
        m.position.copy(s.p);
        m.rotation.copy(s.r);
        m.visible = s.p.y > -0.1 && s.life > 0;
      } else {
        m.visible = false;
      }
    }

    // 烟：往上飘、边飘边变大变淡
    for (let i = 0; i < puffs.current.length; i++) {
      const q = puffs.current[i];
      const m = puffRefs.current[i];
      if (!m) continue;
      if (q.life > 0) {
        q.life -= d * 0.42;
        q.v.y += 0.35 * d;
        q.p.addScaledVector(q.v, d);
        m.position.copy(q.p);
        const grow = (1.6 - q.life) * 0.16;
        m.scale.setScalar(Math.max(0.01, (q.size + grow) * 0.5));
        m.visible = q.life > 0;
        (m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, q.life * 1.2) * 0.55;
      } else {
        m.visible = false;
      }
    }

    const f = file.current;
    if (fileRef.current) {
      if (f.active) {
        f.t += d;
        const p = Math.min(1, f.t / 1.5);
        fileRef.current.visible = true;
        fileRef.current.position.lerpVectors(MONITOR_POS, FLY_TO, p);
        fileRef.current.rotation.y = p * 2.6;
        fileRef.current.scale.setScalar(0.5 * (1 - p * 0.35));
        if (p >= 1) {
          f.active = false;
          fileRef.current.visible = false;
        }
      } else {
        fileRef.current.visible = false;
      }
    }
  });

  return (
    <>
      <mesh ref={kbRef} position={KEYBOARD_POS} visible>
        <boxGeometry args={[0.78, 0.05, 0.26]} />
        <meshStandardMaterial color="#20242e" />
      </mesh>
      {Array.from({ length: SHARD_COUNT }).map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            shardRefs.current[i] = el;
          }}
          visible={false}
        >
          <boxGeometry args={[0.07, 0.045, 0.07]} />
          <meshStandardMaterial color="#8b93a6" />
        </mesh>
      ))}
      {Array.from({ length: PUFF_COUNT }).map((_, i) => (
        <mesh
          key={`puff${i}`}
          ref={(m) => {
            puffRefs.current[i] = m;
          }}
          visible={false}
        >
          <sphereGeometry args={[0.16, 10, 8]} />
          <meshBasicMaterial color="#eef3f6" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
      <mesh ref={fileRef} visible={false}>
        <boxGeometry args={[0.34, 0.44, 0.02]} />
        <meshStandardMaterial color="#ffffff" emissive="#fff6cc" emissiveIntensity={0.7} />
      </mesh>
    </>
  );
}

/* ------------------------------------------------------------ 门外排队的 */

function Queued() {
  const queued = useOffice((s) => s.queued);
  const shown = queued.slice(0, 5);
  return (
    <group>
      {shown.map((q, i) => (
        <group key={q.callId} position={[DOOR.x + 0.45, 0, DOOR.z - 1.5 + i * 0.62]}>
          <mesh position={[0, 1.42, 0]}>
            <boxGeometry args={[0.22, 0.22, 0.22]} />
            <meshStandardMaterial color="#f0c9a8" />
          </mesh>
        </group>
      ))}
      {queued.length > shown.length && (
        <Html position={[DOOR.x + 0.7, 2.05, DOOR.z + 0.5]} center distanceFactor={11} zIndexRange={[6, 0]}>
          <div className="queue-tag">门外还有 {queued.length - shown.length}</div>
        </Html>
      )}
    </group>
  );
}
function RoomPreview() {
  const src = new URLSearchParams(location.search).get("room") === "shell" ? "/models/room-shell.glb" : "/models/room.glb";
  const { scene } = useGLTF(src);
  const { camera } = useThree();

  const prep = useMemo(() => {
    const root = scene.clone(true);
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = 12 / Math.max(size.x, size.z);
    return {
      root,
      s,
      offset: new THREE.Vector3(-center.x, -box.min.y, -center.z),
      half: (Math.max(size.x, size.z) * s) / 2,
      h: size.y * s,
    };
  }, [scene]);

  useEffect(() => {
    // 按缩放后的真实尺寸摆相机，别钻到房间里
    camera.position.set(0, prep.h * 0.95, prep.half * 1.75);
    camera.lookAt(0, prep.h * 0.35, 0);
    (window as unknown as Record<string, unknown>).__roomDbg = {
      half: prep.half,
      h: prep.h,
      cam: camera.position.toArray(),
    };
  }, [camera, prep]);

  return (
    <group>
      <ambientLight intensity={2.2} />
      <directionalLight position={[6, 12, 8]} intensity={2.2} />
      <group scale={prep.s}>
        <primitive object={prep.root} position={prep.offset} />
      </group>
    </group>
  );
}

export function Scene() {
  const capture = new URLSearchParams(location.search).has("capture");
  const roomParam = new URLSearchParams(location.search).get("room");
  const roomOnly = roomParam !== null;
  // 四间房的流水线模式（默认开）
  const useRooms = new URLSearchParams(location.search).get("mode") !== "studio";
  return (
    <Canvas
      frameloop={capture ? "never" : "always"}
      dpr={[1, 1.4]}
      shadows
      gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }}
      camera={{ position: [4.9, 3.5, 7.2], fov: 34, near: 0.4, far: 80 }}
      onCreated={({ gl, scene, camera }) => {
        (window as unknown as { __scene: THREE.Scene }).__scene = scene;
        (window as unknown as { __gl: THREE.WebGLRenderer }).__gl = gl;
        (window as unknown as { __camera: THREE.Camera }).__camera = camera;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.35;
        gl.shadowMap.enabled = true;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
    >
      <color attach="background" args={["#0a0d14"]} />
      <fog attach="fog" args={["#0a0d14", 18, 46]} />
      {roomOnly ? <RoomPreview /> : <Factory />}
      {!roomOnly && !useRooms && <Stations />}
      {!roomOnly && !useRooms && <Protagonist />}
      {!roomOnly && !useRooms && <Drama />}
      {!roomOnly && !useRooms && <Queued />}
      {!roomOnly && !useRooms && <HangingProps />}
      {!roomOnly && !useRooms && <CameraRig />}
      {capture && <CaptureDriver />}
    </Canvas>
  );
}
