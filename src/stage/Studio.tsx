import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useOffice } from "../probe/model";
import { DOOR, DESK, ROOM } from "./layout";
import { useRealClock, skyPhaseOf, SKY_MOOD, type SkyPhase } from "./registry";
import { GenProp, useAvailableProps } from "./GenProp";
import { devRegister, devUnregister } from "../dev/devkit";

/* ---------------------------------------------------------------- 贴图 */

function makeCanvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 暖色木地板 */
function floorTexture() {
  return makeCanvas(512, 512, (ctx) => {
    ctx.fillStyle = "#6b4c33";
    ctx.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 8; row++) {
      const y = row * 64;
      const shade = 0.88 + Math.random() * 0.24;
      ctx.fillStyle = `rgb(${Math.round(150 * shade)}, ${Math.round(108 * shade)}, ${Math.round(70 * shade)})`;
      ctx.fillRect(0, y + 2, 512, 60);
      ctx.strokeStyle = "rgba(60,38,22,0.22)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const yy = y + 8 + Math.random() * 46;
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.bezierCurveTo(170, yy + 3, 340, yy - 3, 512, yy);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(40,26,16,0.5)";
      ctx.fillRect(0, y, 512, 2);
    }
  });
}

/** 地毯：蓝白锯齿 */
function rugTexture() {
  return makeCanvas(256, 256, (ctx) => {
    ctx.fillStyle = "#e9e4d6";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#1f4a63";
    for (let y = -64; y < 320; y += 64) {
      for (let x = -64; x < 320; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 64, y + 32);
        ctx.lineTo(x + 64, y + 64);
        ctx.lineTo(x, y + 32);
        ctx.closePath();
        ctx.fill();
      }
    }
  });
}

/** 窗外：夜/昼都画，按时段选 */
const SKY_PALETTE: Record<SkyPhase, { top: string; mid: string; low: string; litRatio: number }> = {
  dawn: { top: "#2a3560", mid: "#8a6a8f", low: "#e9a878", litRatio: 0.2 },
  day: { top: "#8fc0ea", mid: "#bcd8ee", low: "#d9e6f2", litRatio: 0.05 },
  dusk: { top: "#1f2a52", mid: "#a4557a", low: "#f2925a", litRatio: 0.45 },
  night: { top: "#0a1425", mid: "#12233f", low: "#1d3a5c", litRatio: 0.6 },
};

function cityTexture(phase: SkyPhase) {
  const pal = SKY_PALETTE[phase];
  return makeCanvas(512, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, pal.top);
    g.addColorStop(0.6, pal.mid);
    g.addColorStop(1, pal.low);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 24; i++) {
      const w = 14 + Math.random() * 30;
      const h = 40 + Math.random() * 120;
      const x = Math.random() * 512;
      const y = 256 - h;
      ctx.fillStyle = `rgba(8,16,28,${0.4 + Math.random() * 0.35})`;
      ctx.fillRect(x, y, w, h);
      for (let wy = y + 6; wy < 250; wy += 10) {
        for (let wx = x + 4; wx < x + w - 3; wx += 9) {
          if (Math.random() < pal.litRatio) {
            ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,214,140,0.8)" : "rgba(150,200,255,0.6)";
            ctx.fillRect(wx, wy, 3, 4);
          }
        }
      }
    }
  });
}

/** 墙上海报 */
function posterTexture(hue: number, kind: number) {
  return makeCanvas(256, 360, (ctx) => {
    ctx.fillStyle = `hsl(${hue}, 30%, 22%)`;
    ctx.fillRect(0, 0, 256, 360);
    if (kind === 0) {
      // 骷髅/图案风
      ctx.fillStyle = `hsl(${hue}, 60%, 78%)`;
      ctx.beginPath();
      ctx.arc(128, 130, 62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsl(${hue}, 30%, 22%)`;
      ctx.beginPath();
      ctx.arc(104, 118, 15, 0, Math.PI * 2);
      ctx.arc(152, 118, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsl(${hue}, 60%, 78%)`;
      ctx.fillRect(70, 210, 116, 10);
      ctx.fillRect(70, 234, 80, 8);
    } else {
      // 字块风
      ctx.fillStyle = `hsl(${(hue + 40) % 360}, 55%, 65%)`;
      for (let i = 0; i < 6; i++) ctx.fillRect(28, 60 + i * 34, 120 + Math.random() * 80, 16);
      ctx.strokeStyle = `hsl(${hue}, 50%, 70%)`;
      ctx.lineWidth = 6;
      ctx.strokeRect(16, 40, 224, 280);
    }
  });
}

/** 阳光落在地上的光斑 */
function sunPatchTexture() {
  return makeCanvas(256, 256, (ctx) => {
    ctx.clearRect(0, 0, 256, 256);
    // 百叶窗投下来的条纹
    for (let i = 0; i < 256; i += 34) {
      const g = ctx.createLinearGradient(0, i, 0, i + 22);
      g.addColorStop(0, "rgba(255,222,168,0)");
      g.addColorStop(0.5, "rgba(255,228,180,0.9)");
      g.addColorStop(1, "rgba(255,222,168,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, i, 256, 22);
    }
    // 四边淡出，别出现硬边
    const fade = ctx.createRadialGradient(128, 128, 40, 128, 128, 150);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, "rgba(0,0,0,1)");
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 256, 256);
    ctx.globalCompositeOperation = "source-over";
  });
}

/* ---------------------------------------------------------------- 家具 */

const PROP_IDS = [
  "mug",
  "bookstack",
  "speaker",
  "desk",
  "desk2",
  "chair",
  "monitor",
  "bookshelf",
  "plant",
  "printer",
  "sofa",
  "armchair",
  "coffeetable",
  "coffeetable2",
];

function Desk({
  pos,
  rotY = 0,
  screenMat,
  lampRef,
  wide = 3.0,
  genDesk = false,
  genChair = false,
  chair = true,
  showKeyboard = true,
  deskId = "desk",
  devId = "main",
  facing = -1,
}: {
  pos: [number, number, number];
  rotY?: number;
  screenMat?: React.RefObject<THREE.MeshBasicMaterial>;
  lampRef?: React.RefObject<THREE.PointLight>;
  wide?: number;
  genDesk?: boolean;
  genChair?: boolean;
  chair?: boolean;
  showKeyboard?: boolean;
  deskId?: string;
  devId?: string;
  /** 人坐哪一侧：1 = 靠镜头这侧，-1 = 靠墙那侧 */
  facing?: 1 | -1;
}) {
  const f = facing;
  const chairRef = useRef<THREE.Group>(null);
  const deskRef = useRef<THREE.Group>(null);
  const deskModelRef = useRef<THREE.Group>(null);
  useEffect(() => {
    devRegister(`desk:${devId}`, "desk", deskModelRef.current);
    devRegister(`chair:${devId}`, "chair", chairRef.current);
    return () => {
      devUnregister(`desk:${devId}`);
      devUnregister(`chair:${devId}`);
    };
  });
  useEffect(() => {
    if (!chairRef.current) return;
    const box = new THREE.Box3().setFromObject(chairRef.current);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    (window as unknown as Record<string, unknown>).__chairBox = {
      min: box.min.toArray(),
      max: box.max.toArray(),
      size: size.toArray(),
      center: center.toArray(),
      seatTopGuess: box.min.y + size.y * 0.45,
    };
  });
  // 显示器在最里面，屏幕朝向坐的人；键盘夹在人和显示器中间
  // 桌子实测：深 0.51（半深 0.255），宽 1.36
  const monZ = -0.14 * f;
  const monYaw = f > 0 ? 0 : Math.PI;
  const kbZ = 0.2 * f;
  const paperZ = -0.02 * f;
  const lampZ = -0.1 * f;
  // 椅子收在桌子右端，不占人站的位置
  // 坐垫中心比椅子包围盒中心靠前约 0.06，补偿掉，人才坐正在坐垫上
  // 实测：坐垫中心在椅子中心前 0.13，靠背前表面在后 0.1
  const chairZ = 0.62 * f;

  return (
    <group ref={deskRef} position={pos} rotation={[0, rotY, 0]}>
      {genDesk ? (
        <group ref={deskModelRef}>
          <GenProp id={deskId} height={deskId === "desk2" ? 0.75 : 0.78} />
        </group>
      ) : (
        <>
          <mesh position={[0, 0.74, 0]}>
            <boxGeometry args={[wide, 0.08, 1.3]} />
            <meshStandardMaterial color="#b98a55" roughness={0.55} />
          </mesh>
          {[
            [-wide / 2 + 0.16, -0.55],
            [wide / 2 - 0.16, -0.55],
            [-wide / 2 + 0.16, 0.55],
            [wide / 2 - 0.16, 0.55],
          ].map(([x, z], i) => (
            <mesh key={i} position={[x, 0.36, z]}>
              <boxGeometry args={[0.08, 0.72, 0.08]} />
              <meshStandardMaterial color="#2a2119" />
            </mesh>
          ))}
        </>
      )}

      {/* 显示器：居中，屏幕朝向坐的人 */}
      <group position={[0, 0.78, monZ]} rotation={[0, monYaw, 0]}>
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[1.0, 0.6, 0.045]} />
          <meshStandardMaterial color="#12161c" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.3, 0.03]}>
          <planeGeometry args={[0.94, 0.54]} />
          <meshBasicMaterial ref={screenMat} color="#3d7ea6" />
        </mesh>
        <mesh position={[0, 0.05, 0]}>
          <boxGeometry args={[0.07, 0.12, 0.07]} />
          <meshStandardMaterial color="#262c34" />
        </mesh>
      </group>

      {/* 键盘：在人和显示器之间，正面朝上（主桌的键盘由 Drama 负责，这里不画） */}
      <group visible={showKeyboard} position={[0, 0.79, kbZ]} rotation={[0, monYaw, 0]}>
        <mesh>
          <boxGeometry args={[0.66, 0.026, 0.2]} />
          <meshStandardMaterial color="#1b2026" roughness={0.6} />
        </mesh>
        {/* 键帽：两排小方块，远看有键盘的质感 */}
        {Array.from({ length: 21 }).map((_, i) => (
          <mesh key={i} position={[-0.27 + (i % 7) * 0.09, 0.016, -0.045 + Math.floor(i / 7) * 0.045]}>
            <boxGeometry args={[0.062, 0.008, 0.032]} />
            <meshStandardMaterial color="#333c44" />
          </mesh>
        ))}
      </group>

      {/* 纸张 */}
      <mesh position={[0.62, 0.788, paperZ]} rotation={[-Math.PI / 2, 0, 0.28]}>
        <planeGeometry args={[0.3, 0.4]} />
        <meshStandardMaterial color="#e6e0d2" />
      </mesh>

      {/* 台灯 */}
      <group position={[wide / 2 - 0.42, 0.78, lampZ]}>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.11, 0.13, 0.04, 12]} />
          <meshStandardMaterial color="#2a2119" />
        </mesh>
        <mesh position={[0, 0.28, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 0.52, 8]} />
          <meshStandardMaterial color="#3a2f22" />
        </mesh>
        <mesh position={[0, 0.56, 0]} rotation={[0.5, 0, 0]}>
          <coneGeometry args={[0.17, 0.19, 14, 1, true]} />
          <meshStandardMaterial color="#7a5a3a" side={THREE.DoubleSide} emissive="#ffb36b" emissiveIntensity={0.4} />
        </mesh>
        <pointLight ref={lampRef} position={[0, 0.46, 0.1]} color="#ffb877" intensity={2.4} distance={6} decay={2} />
      </group>

      {/* 椅子 */}
      {!chair ? null : genChair ? (
        <group ref={chairRef}>
          <GenProp id="chair" height={1.05} position={[0, 0, chairZ]} yaw={monYaw + Math.PI} />
        </group>
      ) : (
        <group position={[0, 0, chairZ]}>
          <mesh position={[0, 0.44, 0]}>
            <boxGeometry args={[0.56, 0.08, 0.5]} />
            <meshStandardMaterial color="#3a2f24" />
          </mesh>
          <mesh position={[0, 0.82, 0.24 * f]}>
            <boxGeometry args={[0.56, 0.66, 0.08]} />
            <meshStandardMaterial color="#3a2f24" />
          </mesh>
        </group>
      )}
    </group>
  );
}
function PendantLamp({ pos, on }: { pos: [number, number, number]; on: boolean }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.01, 0.01, 1.0, 6]} />
        <meshStandardMaterial color="#20262c" />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <coneGeometry args={[0.34, 0.26, 18, 1, true]} />
        <meshStandardMaterial color="#8d2f2f" side={THREE.DoubleSide} roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.09, 0]}>
        <sphereGeometry args={[0.07, 12, 10]} />
        <meshBasicMaterial color={on ? "#fff1d0" : "#4a4238"} toneMapped={false} />
      </mesh>
      {on && <pointLight position={[0, -0.14, 0]} intensity={2.2} distance={9} decay={2} color="#ffc98a" />}
    </group>
  );
}

/* ---------------------------------------------------------------- 装饰 */

function Decor({ hour, minute, genPrinter }: { hour: number; minute: number; genPrinter?: boolean }) {
  const posterA = useMemo(() => posterTexture(200, 0), []);
  const posterB = useMemo(() => posterTexture(20, 1), []);
  const posterC = useMemo(() => posterTexture(280, 0), []);
  const clock = useMemo(
    () =>
      makeCanvas(256, 256, (ctx) => {
        ctx.fillStyle = "#e8e2d2";
        ctx.beginPath();
        ctx.arc(128, 128, 116, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#1d2a2e";
        ctx.lineWidth = 9;
        ctx.stroke();
        const hand = (a: number, len: number, w: number) => {
          ctx.beginPath();
          ctx.moveTo(128, 128);
          ctx.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len);
          ctx.lineWidth = w;
          ctx.strokeStyle = "#1d2a2e";
          ctx.stroke();
        };
        hand(((hour % 12) / 12) * Math.PI * 2 + (minute / 60) * 0.52, 58, 11);
        hand((minute / 60) * Math.PI * 2, 90, 7);
      }),
    [hour, Math.floor(minute / 5)],
  );

  return (
    <group>
      {/* 木板装饰墙（小房间里没地方了，先关掉） */}
      <group position={[3.9, 2.1, ROOM.backZ + 0.08]} visible={false}>
        {Array.from({ length: 9 }).map((_, i) => {
          const w = 0.9 + Math.random() * 0.9;
          const h = 0.16;
          const x = (Math.random() - 0.5) * 1.4;
          const y = (Math.random() - 0.5) * 1.2;
          return (
            <mesh key={i} position={[x, y, 0]} rotation={[0, 0, (Math.random() - 0.5) * 0.08]}>
              <boxGeometry args={[w, h, 0.05]} />
              <meshStandardMaterial color={`hsl(${30 + Math.random() * 10}, 45%, ${48 + Math.random() * 14}%)`} roughness={0.7} />
            </mesh>
          );
        })}
      </group>

      {/* 海报 */}
      <mesh position={[-4.66, 2.0, 1.6]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.95, 1.35]} />
        <meshBasicMaterial map={posterA} toneMapped={false} />
      </mesh>
      <mesh position={[-4.66, 2.0, 0.2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.8, 1.15]} />
        <meshBasicMaterial map={posterB} toneMapped={false} />
      </mesh>
      <mesh position={[-2.9, 2.3, ROOM.backZ + 0.06]}>
        <planeGeometry args={[0.9, 1.3]} />
        <meshBasicMaterial map={posterC} toneMapped={false} />
      </mesh>

      {/* 挂钟 */}
      <mesh position={[-1.9, 2.45, ROOM.backZ + 0.06]}>
        <planeGeometry args={[0.66, 0.66]} />
        <meshBasicMaterial map={clock} toneMapped={false} transparent />
      </mesh>

      {/* 白板 + 便签 */}
      <group position={[-3.0, 1.85, ROOM.backZ + 0.06]}>
        <mesh position={[0, 0, -0.03]}>
          <planeGeometry args={[2.7, 1.55]} />
          <meshStandardMaterial color="#cfd6dd" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0, -0.06]}>
          <boxGeometry args={[2.8, 1.65, 0.05]} />
          <meshStandardMaterial color="#8d97a3" />
        </mesh>
        {[
          ["#f2d64b", -1.0, 0.45],
          ["#f28bb0", -0.6, 0.2],
          ["#8ecf6f", 0.1, 0.55],
          ["#7fb8f2", 0.7, 0.3],
        ].map(([c, x, y], i) => (
          <mesh key={i} position={[x as number, y as number, 0.01]}>
            <planeGeometry args={[0.19, 0.19]} />
            <meshBasicMaterial color={c as string} toneMapped={false} />
          </mesh>
        ))}
      </group>

      {/* 左侧置物架（带暖色灯带） */}
      <group position={[6.7, 0, -1.4]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh position={[0, 1.0, 0]}>
          <boxGeometry args={[2.6, 2.0, 0.34]} />
          <meshStandardMaterial color="#4a3626" roughness={0.75} />
        </mesh>
        {[0.35, 0.95, 1.55].map((y) => (
          <group key={y}>
            <mesh position={[0, y, 0.02]}>
              <boxGeometry args={[2.5, 0.03, 0.33]} />
              <meshStandardMaterial color="#5c4430" />
            </mesh>
            <mesh position={[0, y - 0.09, 0.19]}>
              <boxGeometry args={[2.3, 0.02, 0.02]} />
              <meshBasicMaterial color="#ffb26b" toneMapped={false} />
            </mesh>
          </group>
        ))}
        <pointLight position={[0, 1.0, 0.5]} intensity={1.3} distance={4} decay={2} color="#ffb26b" />
      </group>

      {/* 打印机 */}
      {genPrinter ? (
        <GenProp id="printer" height={0.7} position={[5.9, 0, 4.4]} yaw={Math.PI} />
      ) : (
        <group position={[5.9, 0, 4.4]}>
          <mesh position={[0, 0.35, 0]}>
            <boxGeometry args={[0.9, 0.7, 0.55]} />
            <meshStandardMaterial color="#3a3f4a" />
          </mesh>
        </group>
      )}

      {/* 墙面画框 */}
      {[
        [-5.6, 2.9, 0.55, 0.42, 0],
        [5.9, 2.35, 0.5, 0.66, 1],
        [-6.86, 1.75, 0.5, 0.4, 2],
      ].map(([x, y, w, h, k], i) => (
        <group key={i} position={[x as number, y as number, i === 2 ? 2.9 : ROOM.backZ + 0.05]} rotation={i === 2 ? [0, Math.PI / 2, 0] : [0, 0, 0]}>
          <mesh>
            <boxGeometry args={[w as number, h as number, 0.04]} />
            <meshStandardMaterial color="#6b5844" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0, 0.025]}>
            <planeGeometry args={[(w as number) - 0.08, (h as number) - 0.08]} />
            <meshBasicMaterial map={[posterB, posterA, posterC][k as number]} toneMapped={false} />
          </mesh>
        </group>
      ))}

      {/* 地面纸箱 */}
      <group position={[-6.2, 0, 3.6]}>
        <mesh position={[0, 0.24, 0]}>
          <boxGeometry args={[0.56, 0.48, 0.5]} />
          <meshStandardMaterial color="#a8825a" roughness={0.9} />
        </mesh>
        <mesh position={[0.05, 0.52, 0.02]} rotation={[0, 0.3, 0]}>
          <boxGeometry args={[0.42, 0.12, 0.4]} />
          <meshStandardMaterial color="#96734e" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

/* ---------------------------------------------------------------- 场景 */

export function Studio() {
  const screenMat = useRef<THREE.MeshBasicMaterial>(null!);
  const lampRef = useRef<THREE.PointLight>(null!);
  const ambRef = useRef<THREE.AmbientLight>(null!);
  const sunRef = useRef<THREE.DirectionalLight>(null!);

  const phase = useOffice((s) => s.phase);
  const errorCount = useOffice((s) => s.errorCount);
  const deliverCount = useOffice((s) => s.deliverCount);
  const genProps = useAvailableProps(PROP_IDS);

  const now = useRealClock();
  const sky = skyPhaseOf(now);
  const flashAt = useRef(0);

  useEffect(() => {
    if (errorCount > 0) flashAt.current = Date.now();
  }, [errorCount]);

  const floorTex = useMemo(floorTexture, []);
  const rugTex = useMemo(rugTexture, []);
  const cityTex = useMemo(() => cityTexture(sky), [sky]);
  const sunTex = useMemo(sunPatchTexture, []);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1);
    const off = phase === "done";

    if (lampRef.current) lampRef.current.intensity = THREE.MathUtils.damp(lampRef.current.intensity, off ? 0.1 : 2.4, 1.6, d);
    if (ambRef.current) ambRef.current.intensity = THREE.MathUtils.damp(ambRef.current.intensity, off ? 0.4 : SKY_MOOD[sky].ambient * 1.35, 1.6, d);
    if (sunRef.current) sunRef.current.intensity = THREE.MathUtils.damp(sunRef.current.intensity, off ? 0.25 : 4.2, 1.6, d);

    if (!screenMat.current) return;
    const since = flashAt.current ? (Date.now() - flashAt.current) / 1000 : 99;
    if (since < 2.6) {
      const k = 1 - since / 2.6;
      screenMat.current.color.setRGB(0.08 + k * 0.1, 0.18 + k * 0.25, 0.55 + k * 0.3);
    } else if (deliverCount > 0) {
      screenMat.current.color.set("#6fd3a0");
    } else {
      screenMat.current.color.set("#3d7ea6");
    }
  });

  const lit = phase !== "done";

  return (
    <group>
      {/* 地板 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM.w, ROOM.d]} />
        <meshStandardMaterial map={floorTex} roughness={0.85} color="#b09274" />
      </mesh>

      {/* 地毯 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-2.1, 0.008, 2.3]}>
        <planeGeometry args={[4.4, 3.2]} />
        <meshStandardMaterial map={rugTex} roughness={1} />
      </mesh>

      {/* 后墙 / 左墙 / 天花板 */}
      <mesh position={[0, ROOM.h / 2, ROOM.backZ]}>
        <planeGeometry args={[ROOM.w, ROOM.h]} />
        <meshStandardMaterial color="#2a4d5a" roughness={1} />
      </mesh>
      <mesh position={[ROOM.leftX, ROOM.h / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[ROOM.d, ROOM.h]} />
        <meshStandardMaterial color="#254650" roughness={1} />
      </mesh>
      <mesh position={[0, ROOM.h, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM.w, ROOM.d]} />
        <meshStandardMaterial color="#24485a" roughness={1} />
      </mesh>

      {/* 窗 */}
      <group position={[1.2, 1.95, ROOM.backZ + 0.03]}>
        <mesh>
          <planeGeometry args={[4.6, 2.1]} />
          <meshBasicMaterial map={cityTex} toneMapped={false} />
        </mesh>
        <mesh position={[0, 1.08, 0.02]}>
          <boxGeometry args={[4.8, 0.1, 0.07]} />
          <meshStandardMaterial color="#40525c" />
        </mesh>
        <mesh position={[0, -1.08, 0.02]}>
          <boxGeometry args={[4.8, 0.1, 0.07]} />
          <meshStandardMaterial color="#40525c" />
        </mesh>
        <mesh position={[0, 0, 0.02]}>
          <boxGeometry args={[0.07, 2.1, 0.06]} />
          <meshStandardMaterial color="#40525c" />
        </mesh>
        {/* 百叶帘 */}
        {Array.from({ length: 9 }).map((_, i) => (
          <mesh key={i} position={[0, 0.95 - i * 0.2, 0.06]}>
            <planeGeometry args={[4.4, 0.1]} />
            <meshStandardMaterial color="#cfd8dc" roughness={0.9} transparent opacity={0.55} />
          </mesh>
        ))}
      </group>

      {/* 阳光光斑（假体积光，落在地板上） */}
      {[
        [1.4, -2.4, 3.4, 5.2, 0.06],
        [3.4, -1.0, 2.2, 3.4, -0.08],
        [-0.6, -3.6, 2.6, 3.6, 0.12],
      ].map(([x, z, w, l, r], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, r]} position={[x, 0.012 + i * 0.001, z]}>
          <planeGeometry args={[w, l]} />
          <meshBasicMaterial
            map={sunTex}
            transparent
            opacity={lit ? 0.62 : 0.08}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            color="#ffd9a0"
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* 门 */}
      <group position={[DOOR.x - 0.03, 0, DOOR.z]} rotation={[0, Math.PI / 2, 0]}>
        <mesh position={[0, 1.15, -0.85]}>
          <boxGeometry args={[0.12, 2.3, 0.14]} />
          <meshStandardMaterial color="#33454e" />
        </mesh>
        <mesh position={[0, 1.15, 0.85]}>
          <boxGeometry args={[0.12, 2.3, 0.14]} />
          <meshStandardMaterial color="#33454e" />
        </mesh>
        <mesh position={[0, 2.3, 0]}>
          <boxGeometry args={[0.12, 0.14, 1.84]} />
          <meshStandardMaterial color="#33454e" />
        </mesh>
        <mesh position={[0.05, 1.1, 0]}>
          <planeGeometry args={[1.55, 2.14]} />
          <meshStandardMaterial color="#22333c" roughness={0.85} />
        </mesh>
        <mesh position={[0.12, 1.05, 0.62]}>
          <boxGeometry args={[0.06, 0.06, 0.18]} />
          <meshStandardMaterial color="#c9a45a" />
        </mesh>
      </group>

      {/* 工位 */}
      <Desk
        pos={[DESK.x, 0, DESK.z]}
        screenMat={screenMat}
        lampRef={lampRef}
        wide={3.0}
        genDesk={!!(genProps.desk2 || genProps.desk)}
        deskId={genProps.desk2 ? "desk2" : "desk"}
        genChair={!!genProps.chair}
        facing={1}
        showKeyboard={false}
        devId="main"
      />

      {/* 书架 */}
      {genProps.bookshelf && <GenProp id="bookshelf" height={1.9} position={[-4.32, 0, -3.2]} yaw={Math.PI / 2} />}

      {/* 休息区 */}
      {genProps.sofa && <GenProp id="sofa" height={0.85} position={[-3.0, 0, 3.1]} yaw={0.1} />}
      {genProps.armchair && <GenProp id="armchair" height={0.95} position={[-0.7, 0, 2.0]} yaw={-2.2} />}
      {genProps.coffeetable2 ? (
        <GenProp id="coffeetable2" height={0.4} position={[-2.0, 0, 2.3]} yaw={0.15} />
      ) : (
        genProps.coffeetable && <GenProp id="coffeetable" height={0.38} position={[-2.1, 0, 2.7]} yaw={0.15} />
      )}

      {/* 绿植 */}
      {/* 桌面杂物：生成的杯子、书、音箱 */}
      {genProps.mug && <GenProp id="mug" height={0.11} position={[0.95, 0.75, -1.78]} />}
      {genProps.bookstack && <GenProp id="bookstack" height={0.13} position={[-0.16, 0.75, -1.82]} yaw={0.4} />}
      {genProps.mug && <GenProp id="mug" height={0.11} position={[-4.85, 0.75, -4.16]} />}
      {genProps.bookstack && <GenProp id="bookstack" height={0.13} position={[2.72, 0.75, -4.14]} yaw={-0.5} />}
      {genProps.speaker && <GenProp id="speaker" height={0.26} position={[6.52, 1.02, -1.2]} yaw={-Math.PI / 2} />}

      {genProps.plant && <GenProp id="plant" height={1.35} position={[4.15, 0, -3.4]} />}
      {genProps.plant && <GenProp id="plant" height={1.1} position={[-2.3, 0, -3.5]} />}
      {genProps.plant && <GenProp id="plant" height={0.95} position={[2.6, 0, 3.2]} />}

      {/* 吊灯 */}
      <PendantLamp pos={[-2.4, 2.85, 2.2]} on={lit} />
      <PendantLamp pos={[0.4, 2.85, -1.6]} on={lit} />
      <PendantLamp pos={[2.7, 2.85, -2.9]} on={lit} />

      <Decor hour={now.getHours()} minute={now.getMinutes()} genPrinter={!!genProps.printer} />

      {/* 墙上大屏（内容由 Html 叠上去） */}
      <group position={[3.3, 2.0, ROOM.backZ + 0.07]}>
        <mesh>
          <planeGeometry args={[2.6, 1.5]} />
          <meshStandardMaterial color="#0b141a" emissive="#123243" emissiveIntensity={1.2} />
        </mesh>
      </group>

      {/* 灯光：冷环境 + 暖主光 + 窗光 */}
      <ambientLight ref={ambRef} intensity={1.45} color="#82aec4" />
      <directionalLight
        ref={sunRef}
        position={[1.3, 6.5, -5]}
        intensity={4.2}
        color="#ffd3a1"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-bias={-0.0012}
      />
      <pointLight position={[-3.4, 1.2, 2.4]} intensity={1.4} color="#ff9a5c" distance={8} decay={2} />
      <pointLight position={[0.4, 2.6, 4]} intensity={0.8} color="#7fb0c8" distance={14} decay={2} />
      {/* 阳光打在地板上反弹回来的暖光 */}
      <pointLight position={[1.6, 0.5, -2.6]} intensity={1.1} color="#ffb877" distance={10} decay={2} />
    </group>
  );
}
