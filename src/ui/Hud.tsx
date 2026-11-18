import { useEffect, useState } from "react";
import { useOffice, type LogLine } from "../probe/model";
import { STAGE_ORDER, STAGE_LABEL } from "../stage/pipeline";

const KIND_COLOR: Record<LogLine["kind"], string> = {
  task: "#7dd3fc",
  think: "#c4b5fd",
  plan: "#fbbf24",
  tool: "#fb923c",
  result: "#4ade80",
  approval: "#f472b6",
  deliver: "#ffd166",
  done: "#94a3b8",
};

const KIND_LABEL: Record<LogLine["kind"], string> = {
  task: "接活",
  think: "想",
  plan: "计划",
  tool: "派活",
  result: "回来",
  approval: "等你",
  deliver: "交付",
  done: "下班",
};

export function Hud() {
  const connected = useOffice((s) => s.connected);
  const mode = useOffice((s) => s.mode);
  const session = useOffice((s) => s.session);
  const turn = useOffice((s) => s.turn);
  const tokens = useOffice((s) => s.tokens);
  const toolCount = useOffice((s) => s.toolCount);
  const errorCount = useOffice((s) => s.errorCount);
  const phase = useOffice((s) => s.phase);
  const stage = useOffice((s) => s.stage);
  const stageAt = useOffice((s) => s.stageAt);
  const approvalReason = useOffice((s) => s.approvalReason);
  const log = useOffice((s) => s.log);
  const agents = useOffice((s) => s.agents);
  const cameraMode = useOffice((s) => s.cameraMode);
  const setCameraMode = useOffice((s) => s.setCameraMode);
  const followKey = useOffice((s) => s.followKey);
  const setFollowKey = useOffice((s) => s.setFollowKey);

  const active = agents.filter((a) => a.state === "in" || a.state === "work").length;

  // 当前阶段已经跑了多久（真实秒数）
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!stageAt) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed((Date.now() - stageAt) / 1000);
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [stageAt]);

  return (
    <div className="hud">
      <header className="top">
        <div className="brand">
          <div className="logo" />
          <div>
            <h1>人工智能流水线</h1>
            <p>智能体工作过程 · 3D 可视化</p>
          </div>
        </div>
        <div className="meta">
          <span className={`dot ${connected ? "on" : ""}`} />
          <span className="mode">{mode === "live" ? "实时接入 DSH" : "回放"}</span>
          {session && <span className="session">{session}</span>}
        </div>
      </header>

      <aside className="panel log-panel">
        <div className="panel-head">
          <span>这一轮走到哪了</span>
          <span className="turn">第 {turn || "-"} 回合</span>
        </div>

        {/* 四段流水线进度 */}
        <div className="pipe">
          {STAGE_ORDER.map((k, i) => {
            const on = stage === k;
            const passed = STAGE_ORDER.indexOf(stage as never) > i;
            return (
              <div key={k} className={`pipe-step ${on ? "on" : ""} ${passed ? "done" : ""}`}>
                <span className="pipe-no">{i + 1}</span>
                <span className="pipe-name">{STAGE_LABEL[k]}</span>
                {on && <span className="pipe-live">{elapsed.toFixed(1)}s</span>}
              </div>
            );
          })}
        </div>

        <div className="log-list">
          {log.length === 0 && <div className="empty">等第一条事件…</div>}
          {[...log].reverse().slice(0, 30).map((l, i) => (
            <div className="log-row" key={`${l.seq}-${i}`}>
              <span className="log-kind" style={{ color: KIND_COLOR[l.kind], borderColor: KIND_COLOR[l.kind] + "55" }}>
                {KIND_LABEL[l.kind]}
              </span>
              <span className="log-text">{l.text}</span>
            </div>
          ))}
        </div>
      </aside>

      <aside className="panel stat-panel">
        <div className="stat">
          <span className="k">干活中</span>
          <span className="v">{active}</span>
        </div>
        <div className="stat">
          <span className="k">累计工具</span>
          <span className="v">{toolCount}</span>
        </div>
        <div className="stat">
          <span className="k">出错</span>
          <span className="v danger">{errorCount}</span>
        </div>
        <div className="stat">
          <span className="k">token</span>
          <span className="v">{tokens.toLocaleString()}</span>
        </div>
        <div className={`phase phase-${phase}`}>
          {phase === "idle" && "空闲"}
          {phase === "working" && "干活中"}
          {phase === "approval" && "等你确认"}
          {phase === "done" && "交付完成"}
        </div>
      </aside>

      {phase === "approval" && (
        <div className="approval">
          <div className="approval-title">他停下来等你了</div>
          <div className="approval-reason">{approvalReason}</div>
          <div className="approval-hint">在 DSH 里点确认，他就会继续</div>
        </div>
      )}

      <div className="cam-bar">
        {([
          ["cinematic", "导演运镜"],
          ["orbit", "自由视角"],
          ["follow", "跟随角色"],
        ] as const).map(([m, label]) => (
          <button
            key={m}
            className={`cam ${cameraMode === m ? "on" : ""}`}
            onClick={() => {
              if (m === "follow" && !followKey) setFollowKey("main");
              setCameraMode(m);
            }}
          >
            {label}
          </button>
        ))}
        {cameraMode === "follow" && (
          <span className="cam-target">
            跟着{" "}
            {followKey === "main"
              ? "主角"
              : "#" + String((agents.find((a) => "agent:" + a.callId === followKey)?.slot ?? 0) + 1).padStart(2, "0")}
            <i
              className="cam-close"
              onClick={() => {
                setFollowKey(null);
                setCameraMode("cinematic");
              }}
            >
              ×
            </i>
          </span>
        )}
      </div>

      <footer className="foot">
        <span>事件来自 DSH 会话日志 · 不修改 DSH</span>
        <span className="sep">·</span>
        <span>小人数量 = 真实并行工具调用数</span>
      </footer>
    </div>
  );
}
