import { useEffect, useState } from "react";
import { CLIPS, useTune } from "../stage/tuneStore";
import { replayApi } from "../probe/source";

/**
 * 调参面板：选房间 → 拖滑块 → 立刻看到效果。
 *
 * 快捷键：
 *   [ / ]   上一个 / 下一个房间
 *   ← → ↑ ↓ 微调选中人的位置（按住 Shift 每次 1 cm）
 *   C       复制当前参数
 */

const ROOM_KEYS = ["receive", "think", "execute", "deliver"] as const;
const LABEL: Record<string, string> = {
  receive: "① 接单",
  think: "② 思考",
  execute: "③ 执行",
  deliver: "④ 交付",
};

function Row({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="insp-row">
      <span className="insp-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="insp-val">{value.toFixed(2)}</span>
    </label>
  );
}

export function Inspector() {
  const { rooms, cam, selected, setRoom, setCam, select, reset, snapshot } = useTune();
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const room = rooms[selected];
  // 双保险：直接写 window 上的共享参数，避免 HMR 出现两份 store
  const WIN = window as unknown as { __TUNE?: { rooms: Record<string, { xOff: number; z: number; clip: string }>; cam: Record<string, number> } };
  const applyRoom = (patch: { xOff?: number; z?: number; clip?: string }) => {
    if (WIN.__TUNE) Object.assign(WIN.__TUNE.rooms[selected], patch);
    setRoom(selected, patch);
  };
  const applyCam = (patch: Record<string, number>) => {
    if (WIN.__TUNE) Object.assign(WIN.__TUNE.cam, patch);
    setCam(patch as never);
  };
  (window as unknown as { __tune?: unknown }).__tune = useTune;
  (window as unknown as { __replayApi?: unknown }).__replayApi = replayApi;

  // 回放进度
  const [pos, setPos] = useState(0);
  const [total, setTotal] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      setTotal(replayApi.total());
      setPos(replayApi.position());
      setPlaying(replayApi.playing());
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snapshot());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  if (!open) {
    return (
      <button className="insp-toggle" onClick={() => setOpen(true)}>
        调参
      </button>
    );
  }

  return (
    <div className="insp">
      <div className="insp-head">
        <b>物体属性</b>
        <button className="insp-x" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>

      <div className="insp-tabs">
        {ROOM_KEYS.map((k) => (
          <button
            key={k}
            className={`insp-tab ${k === selected ? "on" : ""}`}
            onClick={() => select(k)}
          >
            {LABEL[k]}
          </button>
        ))}
      </div>

      <div className="insp-sec">回放进度</div>
      <div className="insp-timeline">
        <button
          className="insp-play"
          onClick={() => (playing ? replayApi.pause() : replayApi.play())}
        >
          {playing ? "暂停" : "播放"}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          step={1}
          value={Math.min(pos, Math.max(0, total - 1))}
          onChange={(e) => replayApi.seek(Number(e.target.value))}
        />
        <span className="insp-val">
          {Math.min(pos + 1, total)}/{total}
        </span>
      </div>
      <div className="insp-row" style={{ gridTemplateColumns: "42px 1fr 40px" }}>
        <span className="insp-label">速度</span>
        <input
          type="range"
          min={300}
          max={3000}
          step={100}
          defaultValue={1400}
          onChange={(e) => replayApi.setPace(Number(e.target.value))}
        />
        <span className="insp-val">节奏</span>
      </div>

      <div className="insp-sec">位置（房间中心为 0）</div>
      <Row
        label="横向 X"
        value={room.xOff}
        min={-1.2}
        max={1.2}
        step={0.01}
        onChange={(v) => applyRoom({ xOff: v })}
      />
      <Row
        label="前后 Z"
        value={room.z}
        min={-1.6}
        max={0.6}
        step={0.01}
        onChange={(v) => applyRoom({ z: v })}
      />

      <div className="insp-sec">动作</div>
      <select
        className="insp-select"
        value={room.clip}
        onChange={(e) => applyRoom({ clip: e.target.value })}
      >
        {CLIPS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <div className="insp-sec">相机</div>
      <Row label="距离" value={cam.z} min={2.2} max={8} step={0.05} onChange={(v) => applyCam({ z: v })} />
      <Row label="高度" value={cam.y} min={1.2} max={4} step={0.05} onChange={(v) => applyCam({ y: v })} />
      <Row label="偏右" value={cam.xOff} min={-2} max={2} step={0.05} onChange={(v) => applyCam({ xOff: v })} />
      <Row label="视角" value={cam.fov} min={24} max={60} step={1} onChange={(v) => applyCam({ fov: v })} />

      <div className="insp-foot">
        <button onClick={copy}>{copied ? "已复制" : "复制参数"}</button>
        <button onClick={reset}>重置</button>
      </div>
    </div>
  );
}
