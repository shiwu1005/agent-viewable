import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useOffice } from "../probe/model";
import { WorkerModel, useWorkerAvailable } from "./Character";
import { GenProp, useAvailableProps } from "./GenProp";
import { Workstation } from "./Workstation";
import { RoomDoor, DOOR_W } from "./RoomDoor";
import { TUNING } from "./tuning";
import { useTune } from "./tuneStore";
import { Controls } from "./Controls";
import { Conveyor, ThinkBox, RobotArms, ExitChute } from "./Machines";
import { devRegister, devUnregister } from "../dev/devkit";

/**
 * 四间小房间，一间一个功能，一间一个工人。
 *
 * 接单 → 思考 → 执行 → 交付
 *
 * 任务卡在房间之间的传递口上流动。
 */

export type RoomStage = "receive" | "think" | "execute" | "deliver";

const ROOMS: { key: RoomStage; label: string; tint: string }[] = [
  { key: "receive", label: "接单", tint: "#e8a33d" },
  { key: "think", label: "思考", tint: "#5fb8e8" },
  { key: "execute", label: "执行", tint: "#7bc96f" },
  { key: "deliver", label: "交付", tint: "#e8574a" },
];

/** 每间房的尺寸 */
const W = 2.9;
const D = 3.0;
const H = 2.7;
const GAP = 0.45;
/** 第 i 间房的中心 x */
const roomX = (i: number) => (i - 1.5) * (W + GAP);

/** 程序生成的地面贴图：木纹 / 水泥 / 地毯 / 钢板（不联网） */
function makeFloorTexture(kind: "wood" | "concrete" | "carpet" | "steel") {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

  if (kind === "wood") {
    ctx.fillStyle = "#8a6844";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(${rnd(60, 110) | 0}, ${rnd(40, 75) | 0}, ${rnd(20, 45) | 0}, 0.5)`;
      ctx.fillRect(0, i * (S / 6), S, S / 6 - 1);
      ctx.strokeStyle = "rgba(46, 30, 16, 0.22)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, i * (S / 6));
      ctx.lineTo(S, i * (S / 6));
      ctx.stroke();
    }
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(${rnd(40, 120) | 0}, ${rnd(25, 80) | 0}, ${rnd(10, 50) | 0}, ${rnd(0.05, 0.2)})`;
      ctx.fillRect(rnd(0, S), rnd(0, S), rnd(1, 3), rnd(4, 22));
    }
  } else if (kind === "concrete") {
    ctx.fillStyle = "#8c8a84";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const g = rnd(100, 180) | 0;
      ctx.fillStyle = `rgba(${g},${g},${g - 6},${rnd(0.05, 0.3)})`;
      ctx.fillRect(rnd(0, S), rnd(0, S), rnd(1, 4), rnd(1, 4));
    }
  } else if (kind === "carpet") {
    ctx.fillStyle = "#39434e";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 4000; i++) {
      const g = rnd(45, 85) | 0;
      ctx.fillStyle = `rgba(${g},${g + 6},${g + 14},${rnd(0.1, 0.35)})`;
      ctx.fillRect(rnd(0, S), rnd(0, S), rnd(1, 3), rnd(1, 3));
    }
  } else {
    ctx.fillStyle = "#69737a";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const g = rnd(80, 140) | 0;
      ctx.fillStyle = `rgba(${g},${g + 4},${g + 8},${rnd(0.05, 0.25)})`;
      ctx.fillRect(rnd(0, S), rnd(0, S), rnd(2, 26), rnd(1, 2));
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 每间房的后墙色调（亮/暗） */
const WALL_ON = ["#565c5e", "#525c62", "#545c5a", "#565a5e"];
const WALL_OFF = ["#1a2a31", "#1a2a31", "#1a2a31", "#1a2a31"];

/** 人物在房间里往左偏一点，别挡住物件 */
const OFF = [-0.35, -0.4, 0, 0];

/** 每间房的身份外观 */
const LOOK: Record<string, "think" | "reception" | "worker" | "courier"> = {
  receive: "reception",
  think: "think",
  execute: "worker",
  deliver: "courier",
};

/** 每间房的地面材质：水泥 / 木地板 / 地毯 / 钢板 */
const FLOOR = ["#8c8a84", "#8a6844", "#39434e", "#69737a"];
const FLOOR_KIND: ("wood" | "concrete" | "carpet" | "steel")[] = ["concrete", "wood", "carpet", "steel"];
const FLOOR_ROUGH = [0.95, 0.85, 1.0, 0.55];
const FLOOR_METAL = [0.0, 0.0, 0.0, 0.35];

/** 整排的总宽（含隔间） */
const TOTAL_W = 4 * W + 3 * (GAP + 0.16);

/* ---------------------------------------------------------------- 实体招牌 */

function makeSignTexture(num: number, label: string, tint: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(10, 18, 24, 0.92)";
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = tint;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 502, 150);
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.arc(84, 80, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0a1216";
  ctx.font = "bold 62px 'Microsoft YaHei', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(num), 84, 84);
  ctx.fillStyle = "#eef4fa";
  ctx.font = "bold 66px 'Microsoft YaHei', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label, 152, 84);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 后墙上的实体门牌，视频里也拍得到 */
function RoomSign({ i, tint, active }: { i: number; tint: string; active: boolean }) {
  const tex = useMemo(() => makeSignTexture(i + 1, ROOMS[i].label, tint), [i, tint]);
  return (
    <mesh position={[0, H - 0.45, -D / 2 + 0.02]}>
      <planeGeometry args={[1.15, 0.36]} />
      <meshBasicMaterial map={tex} toneMapped={false} transparent opacity={active ? 1 : 0.72} />
    </mesh>
  );
}

/** 房间之间的隔墙，中间留门洞 */
function Divider({ x }: { x: number }) {
  const doorW = 0.78;
  const doorH = 1.95;
  const side = (D - doorW) / 2;
  const wall = "#1b3038";
  return (
    <group position={[x, 0, 0]}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, H / 2, s * (doorW / 2 + side / 2)]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[side, H]} />
          <meshStandardMaterial color={wall} roughness={1} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* 门洞上方的过梁 */}
      <mesh position={[0, (H + doorH) / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[doorW, H - doorH]} />
        <meshStandardMaterial color={wall} roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* 门框 */}
      {[-1, 1].map((s) => (
        <mesh key={`f${s}`} position={[0, doorH / 2, s * (doorW / 2 + 0.03)]}>
          <boxGeometry args={[0.1, doorH, 0.06]} />
          <meshStandardMaterial color="#2c4a55" roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, doorH + 0.03, 0]}>
        <boxGeometry args={[0.1, 0.06, doorW + 0.12]} />
        <meshStandardMaterial color="#2c4a55" roughness={0.7} />
      </mesh>
    </group>
  );
}

/* ---------------------------------------------------------------- 一间房 */

function RoomShell({ i, tint, active }: { i: number; tint: string; active: boolean }) {
  const floorTex = useMemo(() => makeFloorTexture(FLOOR_KIND[i]), [i]);
  const x = roomX(i);
  const halfW = W / 2;
  const halfD = D / 2;

  return (
    <group position={[x, 0, 0]}>
      {/* 踢脚线 */}
      <mesh position={[0, 0.045, -halfD + 0.035]}>
        <boxGeometry args={[W, 0.09, 0.05]} />
        <meshStandardMaterial color="#2b3a41" roughness={0.75} />
      </mesh>

      {/* 后墙面板：给每间房自己的色调 */}
      <mesh position={[0, H / 2, -halfD + 0.015]} receiveShadow>
        <planeGeometry args={[W - 0.04, H]} />
        <meshStandardMaterial
          color={active ? WALL_ON[i] : WALL_OFF[i]}
          roughness={0.95}
          emissive={tint}
          emissiveIntensity={active ? 0.05 : 0.01}
        />
      </mesh>

      {/* 地面材质：每间房不同（水泥 / 木地板 / 地毯 / 钢板） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} receiveShadow>
        <planeGeometry args={[W - 0.06, D - 0.06]} />
        <meshStandardMaterial
          map={floorTex}
          color="#ffffff"
          roughness={FLOOR_ROUGH[i]}
          metalness={FLOOR_METAL[i]}
        />
      </mesh>

      {/* 地脚灯带：当前这间房亮起来 */}
      <mesh position={[0, 0.02, halfD - 0.08]}>
        <boxGeometry args={[W - 0.3, 0.02, 0.06]} />
        <meshBasicMaterial color={tint} toneMapped={false} transparent opacity={active ? 1 : 0.25} />
      </mesh>

      {/* 侧补光，避免正面全黑 */}
      <pointLight
        position={[halfW * 0.7, 1.6, halfD * 0.8]}
        intensity={active ? 3.4 : 0.16}
        distance={6.5}
        decay={2}
        color={active ? "#ffcf9a" : "#5f7f96"}
      />
      {/* 顶上小灯 */}
      <pointLight
        position={[0, H - 0.4, -0.2]}
        intensity={active ? 4.2 : 0.35}
        distance={5}
        decay={2}
        color={active ? "#ffbe82" : "#4d6a80"}
      />

      <RoomSign i={i} tint={tint} active={active} />
      <RoomDoor x={TUNING.door.x} z={-halfD + TUNING.door.z + 1.5} open={active} tint={tint} />

      {/* 门牌 */}
      <Html position={[0, H + 0.42, -halfD + 0.1]} center distanceFactor={10} zIndexRange={[6, 0]}>
        <div className={`room-tag ${active ? "is-on" : ""}`} style={{ borderColor: tint, color: tint }}>
          <b>{i + 1}</b>
          <span>{ROOMS[i].label}</span>
        </div>
      </Html>
    </group>
  );
}

/* ---------------------------------------------------------------- 房内布置 */

function RoomFurniture({ i, active }: { i: number; active: boolean }) {
  // 四间房全部换成机器：传送带 / 箱子+大屏 / 机械臂 / 出口滑道
  switch (ROOMS[i].key) {
    case "receive":
      return <Conveyor active={active} />;
    case "think":
      return <ThinkBox active={active} />;
    case "execute":
      return <RobotArms active={active} />;
    default:
      return <ExitChute active={active} />;
  }
}

/* ---------------------------------------------------------------- 工人 */

function Worker({ i, active, stage }: { i: number; active: boolean; stage: string }) {
  const ready = useWorkerAvailable();
  const key = ROOMS[i].key;
  const x = roomX(i);

  // 站位：每间房都面向自己的物件（-z，背对镜头）
  const POSE: Record<string, { z: number; clip: string; idleClip: string }> = {
    receive: { z: -0.8, clip: "Interact", idleClip: "Idle_Loop" },
    think: { z: -1.0, clip: "Idle_Talking_Loop", idleClip: "Idle_Loop" },
    execute: { z: -0.46, clip: "Interact", idleClip: "Interact" },
    deliver: { z: -0.25, clip: "OverhandThrow", idleClip: "Idle_Loop" },
  };
  const errorAt = useOffice((s) => s.errorAt);
  const [, forceRedraw] = useState(0);
  useEffect(() => {
    if (!errorAt) return;
    const id = window.setInterval(() => forceRedraw((v) => v + 1), 120);
    const stop = window.setTimeout(() => window.clearInterval(id), 2600);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [errorAt]);
  const slamming = errorAt > 0 && Date.now() - errorAt < 2300;
  const pose = POSE[key];
  const r = ROOMS[i];
  const yaw = Math.PI;
  const z = pose.z;
  void z;

  const stageAt = useOffice((s) => s.stageAt);
  void stageAt;

  // 动作简化：每间房一个固定片段，只有进场/红温是特例。
  // 之前搞了三拍 + 轮换 + 随机相位，切换太频繁，看起来就是错乱的。
  const STABLE: Record<string, string> = {
    receive: "Interact",
    think: "Idle_FoldArms_Loop",
    execute: "Idle_Loop",
    deliver: "Interact",
  };
  // 每 200ms 抖一下，保证能读到 window 上的最新参数（避开 HMR 双实例问题）
  const [, bump] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => bump((v) => v + 1), 200);
    return () => window.clearInterval(id);
  }, []);
  const tuned = useTune((s) => s.rooms[key]);
  const winRoom = (window as unknown as { __TUNE?: { rooms: Record<string, { xOff: number; z: number; clip: string }> } }).__TUNE?.rooms?.[key];
  const clip = winRoom?.clip ?? tuned?.clip ?? STABLE[key] ?? "Idle_Loop";
  const offX = winRoom?.xOff ?? tuned?.xOff ?? OFF[i];
  const standZ = winRoom?.z ?? tuned?.z ?? pose.z;
  const loopMode = "repeat" as const;

  const grp = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!grp.current || !active) return;
    const t = state.clock.elapsedTime + i * 1.7;
    // 呼吸：轻微上下 + 左右重心转移
    grp.current.position.y = Math.sin(t * 1.6) * 0.012 + Math.abs(Math.sin(t * 5.5)) * 0.022;
    grp.current.rotation.z = Math.sin(t * 0.8) * 0.016;
    grp.current.rotation.x = Math.sin(t * 5.5) * 0.02;
  });

  // 生命周期：待命时房间是空的；有任务才从门里走进来
  const [phase, setPhase] = useState<"out" | "enter" | "work" | "exit">("out");
  // 红温时阶段已经切到交付房，但要让人留在执行房砸桌子
  const forcedRage = key === "execute" && slamming;
  const effectiveActive = active || forcedRage;
  useEffect(() => {
    if (effectiveActive) {
      setPhase(forcedRage ? "work" : "enter");
    } else {
      setPhase((p) => (p === "out" ? "out" : "exit"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveActive, forcedRage, stage]);

  useEffect(() => {
    if (phase === "enter") {
      const id = window.setTimeout(() => setPhase("work"), 1300);
      return () => window.clearTimeout(id);
    }
    if (phase === "exit") {
      const id = window.setTimeout(() => setPhase("out"), 1100);
      return () => window.clearTimeout(id);
    }
  }, [phase]);

  // 进门路线要绕过桌子：门 → 沿后墙走 → 走到桌前 → 横向到位
  const DOOR_X = x + TUNING.door.x;
  const DOOR_POS = new THREE.Vector3(DOOR_X, 0, -D / 2 + 0.2);
  const STAND_POS = new THREE.Vector3(x + offX, 0, standZ);
  const FRONT_Z = TUNING.walk.frontZ;
  const PATH = [
    DOOR_POS.clone(),
    new THREE.Vector3(DOOR_X, 0, FRONT_Z),
    new THREE.Vector3(x + offX, 0, FRONT_Z),
    STAND_POS.clone(),
  ];
  const posRef = useRef(new THREE.Vector3().copy(DOOR_POS));
  const progRef = useRef(0);
  const samplePath = (t: number, out2: THREE.Vector3) => {
    const segs = PATH.length - 1;
    const clamped = Math.min(0.999, Math.max(0, t));
    const f = clamped * segs;
    const i0 = Math.floor(f);
    return out2.copy(PATH[i0]).lerp(PATH[i0 + 1], f - i0);
  };
  useFrame((_, dt) => {
    if (!grp.current) return;
    if (phase === "enter") progRef.current = Math.min(1, progRef.current + dt * 0.85);
    else if (phase === "exit") progRef.current = Math.max(0, progRef.current - dt * 1.05);
    else if (phase === "out") progRef.current = 0;
    else progRef.current = Math.min(1, progRef.current + dt * 1.5);
    if (forcedRage) progRef.current = 1;
    samplePath(progRef.current, posRef.current);
    grp.current.position.x = posRef.current.x;
    grp.current.position.z = posRef.current.z;
  });

  if (!ready || (phase === "out" && !forcedRage)) return null;
  return (
    <group ref={grp} name={`CHAR:${key}`} position={[x + offX, 0, standZ]} rotation={[0, yaw, 0]}>
      <Suspense fallback={null}>
        <WorkerModel
          clip={phase === "enter" || phase === "exit" ? "Walk_Formal_Loop" : slamming ? "OverhandThrow" : clip}
          loop="repeat"
          height={1.55}
          devId={`char:room${i}`}
          look={LOOK[key]}
          tint={r.tint}
          hueShift={0}
          slamOn={key === "execute" ? slamming : false}
          slamStart={errorAt}
          ik={null}
        />
      </Suspense>
    </group>
  );
}

/* ---------------------------------------------------------------- 任务卡 */

function Packet() {
  const stage = useOffice((s) => s.stage);
  const ref = useRef<THREE.Mesh>(null);
  const cur = useRef(new THREE.Vector3(roomX(0), 1.0, -0.5));

  useFrame((_, dt) => {
    const idx = Math.max(0, ROOMS.findIndex((r) => r.key === stage));
    const target = new THREE.Vector3(roomX(stage === "idle" ? 0 : idx), 1.05, -0.6);
    cur.current.lerp(target, Math.min(1, dt * 3.2));
    if (ref.current) {
      ref.current.position.copy(cur.current);
      ref.current.rotation.y += dt * 1.6;
    }
  });

  if (stage === "idle") return null;
  return (
    <mesh ref={ref} position={[roomX(0), 1.0, -0.5]}>
      <boxGeometry args={[0.26, 0.02, 0.18]} />
      <meshBasicMaterial color="#ffe9a8" toneMapped={false} />
    </mesh>
  );
}

/* ---------------------------------------------------------------- 整排 */

export function Rooms() {
  const stage = useOffice((s) => s.stage);
  const { camera } = useThree();
  const camTune = useTune((s) => s.cam);

  // 镜头跟着当前这间房：换阶段时平移过去，人始终看得清
  const camX = useRef(roomX(0));
  useFrame((_, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.fov !== 38) {
      cam.fov = 38;
      cam.updateProjectionMatrix();
    }
    // 红温时镜头钉在执行房，让人看得见拍电脑
    const eAt = useOffice.getState().errorAt;
    const raging = eAt > 0 && Date.now() - eAt < 2400;
    const idx = Math.max(0, ROOMS.findIndex((r) => r.key === stage));
    const want = roomX(raging ? 2 : stage === "idle" ? 1 : idx);
    camX.current += (want - camX.current) * Math.min(1, dt * TUNING.camera.follow);
    // 3/4 侧后方近景：太远、太正，动作全被身体挡住
    // 球坐标摆相机：拖动改 yaw/pitch，滚轮改距离
    const shared = (window as unknown as { __TUNE?: { cam: { xOff: number; y: number; z: number; fov: number; yaw: number; pitch: number } } }).__TUNE;
    const liveCam = shared?.cam ?? camTune;
    const dist = liveCam.z * 1.2;
    const target = new THREE.Vector3(camX.current, TUNING.camera.lookAtY, TUNING.camera.lookAtZ);
    const yaw = liveCam.yaw + Math.atan2(liveCam.xOff, Math.max(0.2, liveCam.z));
    const pitch = liveCam.pitch;
    const horiz = Math.cos(pitch) * dist;
    cam.position.set(
      target.x + Math.sin(yaw) * horiz,
      target.y + Math.sin(pitch) * dist + 0.35,
      target.z + Math.cos(yaw) * horiz,
    );
    if (cam.fov !== camTune.fov) {
      cam.fov = camTune.fov;
      cam.updateProjectionMatrix();
    }
    cam.lookAt(target.x - 0.1, target.y, target.z);
  });
  const base = useAvailableProps(["desk2", "chair", "plant", "mug", "bookstack"]);
  const roomgen = useAvailableProps(["counter", "whiteboard", "standingdesk", "dropbox", "workstation"], "roomset");
  const gen = { ...base, ...roomgen };

  return (
    <group>
      <ambientLight intensity={0.55} color="#a8c2d0" />
      <directionalLight
        position={[5.2, 7.4, 3.6]}
        intensity={2.6}
        color="#ffe8cc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={-0.0006}
      />

      {/* 共享地板：一整块，不是四块拼的 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[TOTAL_W, D]} />
        <meshStandardMaterial color="#8a6844" roughness={0.85} />
      </mesh>

      {/* 共享后墙：一条贯穿 */}
      <mesh position={[0, H / 2, -D / 2]}>
        <planeGeometry args={[TOTAL_W, H]} />
        <meshStandardMaterial color="#22414b" roughness={1} />
      </mesh>

      {/* 顶部横梁，把四间连成一栋 */}
      <mesh position={[0, H + 0.07, -D / 2 + 0.12]}>
        <boxGeometry args={[TOTAL_W, 0.16, 0.26]} />
        <meshStandardMaterial color="#2a4650" roughness={0.8} />
      </mesh>
      <mesh position={[0, H + 0.07, D / 2]}>
        <boxGeometry args={[TOTAL_W, 0.16, 0.26]} />
        <meshStandardMaterial color="#2a4650" roughness={0.8} />
      </mesh>

      {/* 房间之间的隔墙（带门洞） */}
      {[0, 1, 2].map((k) => (
        <Divider key={`dv${k}`} x={roomX(k) + (W + GAP + 0.16) / 2} />
      ))}
      {/* 最外侧两面墙 */}
      <mesh position={[-TOTAL_W / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[D, H]} />
        <meshStandardMaterial color="#1b3038" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[TOTAL_W / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[D, H]} />
        <meshStandardMaterial color="#1b3038" roughness={1} side={THREE.DoubleSide} />
      </mesh>

      {ROOMS.map((r, i) => (
        <group key={r.key}>
          <RoomShell i={i} tint={r.tint} active={stage === r.key} />
          <group position={[roomX(i), 0, 0]}>
            <RoomFurniture i={i} active={stage === r.key} />
          </group>
          {/* 纯机械流水线：不渲染小人 */}
        </group>
      ))}

      <Packet />
      <Controls />
    </group>
  );
}
