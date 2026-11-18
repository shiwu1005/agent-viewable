import { useOffice, type RawRecord } from "./model";

const SSE_URL = "http://127.0.0.1:8791/events";

let started = false;
let es: EventSource | null = null;
let timers: number[] = [];

/** 回放速度：真实会话可能几十分钟，压到 1~2 分钟 */
const REPLAY_SPEED = 30;

function clearTimers() {
  for (const t of timers) window.clearTimeout(t);
  timers = [];
}

export function startFeed() {
  if (started) return;
  started = true;

  // 默认放录像：连实时源的话，画面会跟着当前会话的工具调用一直跳
  // 想看实时就加 ?source=live
  const forced = new URLSearchParams(location.search).get("source");
  if (forced === "live") {
    startLive();
    return;
  }
  startReplay();
}

function startLive() {
  const store = useOffice.getState();
  store.setMode("live");

  try {
    es = new EventSource(SSE_URL);
  } catch {
    startReplay();
    return;
  }

  es.addEventListener("open", () => {
    useOffice.getState().setConnected(true);
    useOffice.getState().setMode("live");
  });

  es.addEventListener("reset", () => {
    useOffice.getState().reset();
  });

  es.addEventListener("message", (ev) => {
    try {
      const rec = JSON.parse((ev as MessageEvent).data) as RawRecord;
      useOffice.getState().apply(rec);
    } catch {
      /* 坏的帧，忽略 */
    }
  });

  es.addEventListener("error", () => {
    useOffice.getState().setConnected(false);
    es?.close();
    es = null;
    // tailer 没开时先退回静态回放（只播一遍），同时继续尝试重连
    startReplay();
    retryLive();
  });
}

let retryTimer = 0;

/** 断线后每 8 秒探一次健康检查，tailer 起来了就自动接回实时 */
function retryLive() {
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(async () => {
    try {
      const res = await fetch("http://127.0.0.1:8791/health", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      retryLive();
      return;
    }
    // 起来了：停掉回放，重新连实时
    clearTimers();
    started = false;
    es = null;
    startFeed();
  }, 8000);
}

async function startReplay() {
  useOffice.getState().setMode("replay");
  clearTimers();

  let text = "";
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}replay.jsonl`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    text = await res.text();
  } catch {
    // 没有回放文件也不崩，显示空场景
    return;
  }

  const records: RawRecord[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const r = JSON.parse(s);
      if (r.type !== "export/meta") records.push(r);
    } catch {
      /* ignore */
    }
  }
  if (!records.length) return;

  // 只留"有画面"的记录，并且只取最后一段 —— 一整天的工作量没法一次性演完
  const VISUAL = new Set([
    "turn/start",
    "turn/end",
    "todo/write",
    "tool/call",
    "tool/result",
    "approval/asked",
    "approval/decided",
    "deliverables/presented",
  ]);
  const all = records.filter((r) => VISUAL.has(r.type));

  // 真实日志里 turn/start 和 todo/write 很少，直接切片只看得到「执行<->交付」。
  // 所以从真实记录里各挑几条，拼出覆盖四个房间的序列（内容仍全部来自真实事件）。
  const turns = all.filter((r) => r.type === "turn/start").slice(0, 2);
  const todos = all.filter((r) => r.type === "todo/write").slice(0, 2);
  const calls = all.filter((r) => r.type === "tool/call").slice(0, 5);
  const results = all.filter((r) => r.type === "tool/result").slice(0, 5);

  const picked: RawRecord[] = [];
  const push = (x?: RawRecord) => { if (x) picked.push(x); };
  push(turns[0]); push(todos[0]); push(calls[0]); push(results[0]);
  push(turns[1]); push(todos[1]); push(calls[1]); push(results[1]);
  push(calls[2]); push(results[2]); push(calls[3]); push(results[3]);
  if (!picked.length) return;

  state.events = picked;
  state.stageOf = picked.map((r) =>
    r.type === "turn/start" ? "receive" : r.type === "todo/write" ? "think" : r.type === "tool/call" ? "execute" : r.type === "tool/result" ? "deliver" : "idle",
  );
  (window as unknown as Record<string, unknown>).__replay = picked.map((r) => r.type);
  state.index = 0;
  state.playing = true;
  state.pace = 1400;
  scheduleFrom(0);
}

/* ---------------------------------------------------------------- 回放控制 */

type ReplayState = {
  events: RawRecord[];
  index: number;
  playing: boolean;
  pace: number;
  timer: number | null;
  stageOf: string[];
};

const state: ReplayState & { raf: number; lastAt: number } = {
  events: [],
  stageOf: [],
  index: 0,
  playing: false,
  pace: 1400,
  timer: null,
  raf: 0,
  lastAt: 0,
};

function applyOne(i: number) {
  const r = state.events[i];
  if (!r) return;
  useOffice.getState().apply({ ...r, time: Date.now() });
}

/** 从第 i 条开始继续播 */
function holdFor(i: number) {
  const HOLD: Record<string, number> = {
    "turn/start": 3200,
    "todo/write": 3200,
    "tool/call": 2800,
    "tool/result": 2000,
    "turn/end": 1600,
  };
  const prev = state.events[Math.max(0, i - 1)];
  return i === 0 ? 300 : (prev ? HOLD[prev.type] : undefined) ?? state.pace;
}

/** 单循环驱动：不再链式 setTimeout（之前会跑出两条链，顺序错乱还提前停） */
function tick() {
  if (!state.playing) return;
  const now = performance.now();
  if (state.index >= state.events.length) {
    useOffice.getState().setConnected(false);
    state.playing = false;
    return;
  }
  if (now - state.lastAt >= holdFor(state.index)) {
    applyOne(state.index);
    state.index = Math.min(state.index + 1, state.events.length);
    state.lastAt = now;
  }
  state.raf = window.requestAnimationFrame(tick);
}

function scheduleFrom(i: number) {
  if (state.raf) window.cancelAnimationFrame(state.raf);
  state.raf = 0;
  state.index = i;
  state.lastAt = performance.now();
  if (state.playing) state.raf = window.requestAnimationFrame(tick);
}
export const replayApi = {
  /** 事件总数 */
  total: () => state.events.length,
  /** 当前进度（已播到第几条） */
  position: () => state.index,
  playing: () => state.playing,
  play: () => {
    state.playing = true;
    scheduleFrom(state.index);
  },
  pause: () => {
    state.playing = false;
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = null;
  },
  /** 拖动进度条：跳到第 i 条，并把之前的全部补上（保证画面状态正确） */
  seek: (i: number) => {
    const clamped = Math.max(0, Math.min(state.events.length - 1, Math.round(i)));
    useOffice.getState().reset();
    for (let k = 0; k <= clamped; k++) {
      // 补历史状态时事件在同一毫秒应用，会被「阶段最短停留」挡掉，先清掉时间戳
      useOffice.setState({ stageAt: 0 });
      applyOne(k);
    }
    // 直接把阶段设成这条事件对应的房间，保证拖动后画面一定对
    const st = state.stageOf[clamped];
    if (st) useOffice.setState({ stage: st as never, stageAt: Date.now() });
    state.index = clamped;
    if (state.playing) scheduleFrom(clamped + 1);
  },
  setPace: (ms: number) => {
    state.pace = ms;
  },
};
