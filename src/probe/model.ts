import { create } from "zustand";
import { type Stage } from "../stage/pipeline";

/* ---------------------------------------------------------------- 原始记录 */

export interface RawRecord {
  type: string;
  seq: number;
  time: number;
  data?: Record<string, any>;
}

/* ---------------------------------------------------------------- 小人状态 */

export type AgentState = "in" | "work" | "out" | "kick";

export interface AgentView {
  callId: string;
  tool: string;
  slot: number;
  state: AgentState;
  bornAt: number;
  endAt?: number;
  isError?: boolean;
  label: string;
  /** 走到工位要多久（按距离算，速度恒定才不滑步） */
  walkMs: number;
  /** 干活时播哪个动作（做点变化，别所有人都在打字） */
  workClip: string;
}

export const SLOT_COUNT = 7;

/* ------------------------------------------------------------ 工具 → 道具 */

export type PropKind = "search" | "exec" | "file" | "deliver" | "misc";

export function propOf(tool: string): PropKind {
  if (/search|research|fetch|weather/i.test(tool)) return "search";
  if (/pwsh|node|python|job_/i.test(tool)) return "exec";
  if (/write|edit|read|grep|glob/i.test(tool)) return "file";
  if (/present|deliver/i.test(tool)) return "deliver";
  return "misc";
}

/** 工具名 → 一句人话，给 HUD 用 */
export function toolLabel(tool: string): string {
  const map: Record<string, string> = {
    web_search: "上网查",
    advanced_search: "上网查",
    research: "做调研",
    web_fetch: "读网页",
    domain_search: "查资料",
    pwsh: "开机器",
    write: "写文件",
    edit: "改文件",
    read: "翻文件",
    read_image: "看图片",
    grep: "搜索代码",
    glob: "找文件",
    todo_write: "列计划",
    job_output: "等结果",
    job_kill: "停任务",
    present: "交付",
    skill: "翻手册",
    ask_user_question: "问用户",
  };
  return map[tool] || tool;
}

/* ------------------------------------------------------------------ 状态 */

const MAX_AGENTS = SLOT_COUNT;

// 门口坐标（和 stage/layout.ts 一致），用来算走路距离
const DOOR_X = -6.84;
const DOOR_Z = -1.1;

const SLOTS: [number, number][] = [
  [-3.3, -0.5],
  [-2.7, 1.0],
  [2.9, -0.7],
  [3.2, 0.6],
  [-1.7, -3.3],
  [2.1, -3.4],
  [1.4, -4.4],
];

interface Bubble {
  text: string;
  at: number;
}

export interface LogLine {
  seq: number;
  time: number;
  kind: "task" | "think" | "plan" | "tool" | "result" | "approval" | "deliver" | "done";
  text: string;
}

export type Phase = "idle" | "working" | "approval" | "done";

interface OfficeState {
  connected: boolean;
  mode: "live" | "replay";
  session: string | null;

  agents: AgentView[];
  /** 同屏满了就在门外等着，里面走一个进来一个 */
  queued: { callId: string; tool: string }[];
  turn: number;
  tokens: number;
  toolCount: number;
  errorCount: number;
  /** 最近一次出错的时间戳（毫秒），红温表演用 */
  errorAt: number;
  deliverCount: number;
  bubble: Bubble | null;
  phase: Phase;
  /** 镜头模式 */
  cameraMode: "cinematic" | "orbit" | "follow";
  /** 跟随谁：main 或 agent:<callId> */
  followKey: string | null;
  setCameraMode: (m: "cinematic" | "orbit" | "follow") => void;
  setFollowKey: (k: string | null) => void;
  approvalReason: string | null;
  lastEventAt: number;
  log: LogLine[];

  /** 已经处理过的最大 seq，用来丢弃重连重复投递的记录 */
  lastSeq: number;
  /** 流水线所处的阶段 */
  stage: Stage;
  stageAt: number;
  apply: (rec: RawRecord) => void;
  gc: (now: number) => void;
  setConnected: (v: boolean) => void;
  setMode: (m: "live" | "replay") => void;
  reset: () => void;
}

function nextSlot(agents: AgentView[]): number {
  // 注意：正在离开（out）的人还站在场上，它的工位不能马上给别人
  const used = new Set(agents.map((a) => a.slot));
  for (let i = 0; i < SLOT_COUNT; i++) if (!used.has(i)) return i;
  return Math.floor(Math.random() * SLOT_COUNT);
}

function reasoningText(message: any): string {
  const content = message?.content;
  if (!Array.isArray(content)) return "";
  const parts = content.filter((c: any) => c?.type === "reasoning").map((c: any) => c.text || "");
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  // 取前两句，别把气泡撑爆
  const cut = joined.slice(0, 90);
  return cut;
}

function toolResultError(message: any): boolean {
  if (message?.isError) return true;
  const content = message?.content;
  if (!Array.isArray(content)) return false;
  const text = content.map((c: any) => c?.text || "").join(" ");
  return /^(Error|error:|ERR_|Error:)/.test(text.trim());
}

let seqCounter = 0;
/** 关掉多智能体，改成一个人的四段流水线 */
const MULTI_AGENT = false;

/** 头顶气泡用的中文内心 OS（英文思维链对观众没意义） */
const THINK_OS = ["在想…", "盘算一下…", "嗯……", "理一下思路", "让我看看", "这里有点问题"];

export const useOffice = create<OfficeState>((set, get) => ({
  connected: false,
  mode: "live",
  session: null,
  lastSeq: 0,
  stage: "idle" as Stage,
  stageAt: 0,
  agents: [],
  queued: [],
  turn: 0,
  tokens: 0,
  toolCount: 0,
  errorCount: 0,
  errorAt: 0,
  deliverCount: 0,
  bubble: null,
  phase: "idle",
  cameraMode: "cinematic",
  followKey: null,
  approvalReason: null,
  lastEventAt: 0,
  log: [],

  setConnected: (connected) => set({ connected }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setFollowKey: (followKey) => set({ followKey }),
  setMode: (mode) => set({ mode }),
  reset: () =>
    set({
      agents: [],
      queued: [],
      turn: 0,
      tokens: 0,
      toolCount: 0,
      errorCount: 0,
  errorAt: 0,
      deliverCount: 0,
      bubble: null,
      phase: "idle",
  cameraMode: "cinematic",
  followKey: null,
      approvalReason: null,
      lastSeq: 0,
      stage: "idle" as Stage,
      stageAt: 0,
      log: [],
    }),

  apply: (rec) => {
    const now = Date.now();
    const d = rec.data || {};
    const s = get();

    // SSE 重连会把最后一批记录再发一遍，重复的 seq 直接丢掉，
    // 否则画面上就是「派活 / 回来」疯狂重复。
    if (typeof rec.seq === "number" && rec.seq > 0) {
      if (rec.seq <= s.lastSeq) return;
      set({ lastSeq: rec.seq });
    }

    const pushLog = (kind: LogLine["kind"], text: string) => {
      const line: LogLine = { seq: rec.seq ?? seqCounter++, time: now, kind, text };
      set({ log: [...s.log.slice(-59), line] });
    };

    switch (rec.type) {
      case "session":
        set({ session: d.cwd || d.id || "session" });
        break;

      case "turn/start":
        set({ stage: "receive", stageAt: now });
        set({ turn: d.turn ?? s.turn + 1, phase: "working", lastEventAt: now });
        pushLog("task", "接新任务");
        break;

      case "turn/end":
        set({ phase: "done", lastEventAt: now });
        pushLog("done", "下班");
        break;

      case "todo/write": {
        set({ stage: "think", stageAt: now });
        const n = Array.isArray(d.todos) ? d.todos.length : 0;
        set({ phase: "working", bubble: { text: `列了 ${n} 步计划`, at: now }, lastEventAt: now });
        pushLog("plan", `列计划 ${n} 步`);
        break;
      }

      case "assistant/message": {
        const usage = d.usage;
        const tokens = s.tokens + (usage?.totalTokens ?? 0);
        const text = reasoningText(d.message);
        // 气泡里不显示英文思维链：观众看不懂，出戏。
        // 换成中文内心 OS，原文只留在日志里（截断），给开发者看。
        const os = THINK_OS[(s.log.length + s.toolCount) % THINK_OS.length];
        set({
          tokens,
          phase: s.phase === "approval" ? "approval" : "working",
          bubble: { text: os, at: now },
          lastEventAt: now,
        });
        if (text) pushLog("think", text.slice(0, 48));
        break;
      }

      case "tool/call": {
        if (now - get().stageAt > 900) set({ stage: "execute", stageAt: now });
        const tool = d.name || "tool";
        const callId = d.callId || `c${now}-${Math.random()}`;
        const cur = get();

        // 历史补课事件不再派小人：连上 SSE 时会把最近几条重放一遍，
        // 若照着演会出现几十个小人同时涌进门口。
        // 补课事件也要演：它们里面可能还有"正在跑"的任务，
        // 已经结束的会在收到对应 result 时立刻被回收，不会残留。
        const stale = !Boolean((rec as any)._backlog) && typeof rec.time === "number" && now - rec.time > 20000;

        if (stale) {
          set({ toolCount: cur.toolCount + 1 });
          break;
        }

        let agents = cur.agents.filter((a) => a.callId !== callId);

        // 同屏上限 7：满员就在门外排队，等里面走一个再进来
        const live = agents.filter((a) => a.state === "in" || a.state === "work");
        if (live.length >= MAX_AGENTS) {
          set({
            queued: [...cur.queued, { callId, tool }],
            toolCount: cur.toolCount + 1,
            phase: "working",
            lastEventAt: now,
          });
          pushLog("tool", `门外排队：${toolLabel(tool)}`);
          break;
        }

        // 单人流线：不再召唤多个小人
        if (!MULTI_AGENT) break;
        const slot = nextSlot(agents);
        // 同时派活时错开出场，避免几个人叠在门口
        const waiting = agents.filter((a) => a.bornAt > now).length;

        // 按真实距离算走路时间：速度恒定，脚才不会打滑
        const [sx, sz] = SLOTS[slot % SLOTS.length];
        const dist = Math.hypot(sx - DOOR_X, sz - DOOR_Z);
        const walkMs = Math.max(700, Math.min(3200, (dist / 1.35) * 1000));

        const WORK_CLIPS = ["Interact", "Sitting_Idle_Loop", "Idle_FoldArms_Loop", "Interact", "Idle_Talking_Loop"];
        agents.push({
          callId,
          tool,
          slot,
          state: "in",
          bornAt: now + waiting * 180,
          label: toolLabel(tool),
          walkMs,
          workClip: WORK_CLIPS[slot % WORK_CLIPS.length],
        });

        // 无论什么情况都别让数组无限长
        if (agents.length > MAX_AGENTS * 2) agents = agents.slice(agents.length - MAX_AGENTS * 2);

        set({ agents, toolCount: cur.toolCount + 1, phase: "working", lastEventAt: now });
        pushLog("tool", `派活：${toolLabel(tool)}`);
        break;
      }

      case "tool/result": {
        if (now - get().stageAt > 900) set({ stage: "deliver", stageAt: now });
        const callId = d.toolCallId || d.message?.toolCallId;

        // 还在门外排队就结束了，直接撤掉
        const stillQueued = get().queued.find((q) => q.callId === callId);
        if (stillQueued) {
          set({ queued: get().queued.filter((q) => q.callId !== callId) });
          pushLog("result", `${toolLabel(stillQueued.tool)}：没轮上就结束了`);
          break;
        }

        const isError = toolResultError(d.message);
        // 补课里的 result：直接把结束时间往前推，让 gc 立刻回收
        const endAt = Boolean((rec as any)._backlog) ? now - 5000 : now;
        const agents: AgentView[] = get().agents.map((a): AgentView =>
          a.callId === callId ? { ...a, state: isError ? "kick" : "out", endAt, isError } : a,
        );
        set({
          agents,
          errorCount: get().errorCount + (isError ? 1 : 0),
          errorAt: isError ? now : get().errorAt,
          lastEventAt: now,
        });
        const a = get().agents.find((x) => x.callId === callId);
        pushLog("result", isError ? `${a?.label ?? "活"}：出错了` : `${a?.label ?? "活"}：回来了`);
        break;
      }

      case "job/registered": {
        set({
          phase: "working",
          bubble: { text: "等机器跑…", at: now },
          lastEventAt: now,
        });
        pushLog("tool", "等机器跑");
        break;
      }

      case "approval/asked":
        set({
          phase: "approval",
          approvalReason: d.reason || d.toolName || "需要你确认",
          lastEventAt: now,
        });
        pushLog("approval", "在等你点确认");
        break;

      case "approval/decided":
        set({
          phase: "working",
          approvalReason: null,
          bubble: { text: d.outcome === "denied" ? "被拒了…" : "他点头了", at: now },
          lastEventAt: now,
        });
        pushLog("approval", `你${d.outcome === "denied" ? "拒绝" : "同意"}了`);
        break;

      case "deliverables/presented": {
        const n = Array.isArray(d.files) ? d.files.length : 0;
        set({
          phase: "done",
          deliverCount: get().deliverCount + 1,
          bubble: { text: `交付 ${n} 个文件`, at: now },
          lastEventAt: now,
        });
        pushLog("deliver", `交付 ${n} 个文件`);
        break;
      }

      default:
        break;
    }
  },

  /** 回收演完的小人，并且从门外补人进来 */
  gc: (now) => {
    const cur = get();
    const agents = cur.agents.filter((a) => (!a.endAt ? true : now - a.endAt < 900));
    const queued = cur.queued.slice();

    const liveCount = () => agents.filter((a) => a.state === "in" || a.state === "work").length;

    while (queued.length && liveCount() < MAX_AGENTS) {
      const next = queued.shift()!;
      const s2 = nextSlot(agents);
      const [qx, qz] = SLOTS[s2 % SLOTS.length];
      const qDist = Math.hypot(qx - DOOR_X, qz - DOOR_Z);
      const WORK_CLIPS2 = ["Interact", "Sitting_Idle_Loop", "Idle_FoldArms_Loop", "Interact", "Idle_Talking_Loop"];
      agents.push({
        callId: next.callId,
        tool: next.tool,
        slot: s2,
        state: "in",
        bornAt: now,
        label: toolLabel(next.tool),
        walkMs: Math.max(700, Math.min(3200, (qDist / 1.35) * 1000)),
        workClip: WORK_CLIPS2[s2 % WORK_CLIPS2.length],
      });
    }

    if (agents.length !== cur.agents.length || queued.length !== cur.queued.length) {
      set({ agents, queued });
    }
  },
}));
