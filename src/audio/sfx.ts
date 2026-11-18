/**
 * 全部用 Web Audio 合成，不加载任何音频文件 —— 离线也能响。
 *
 * 浏览器要求先有用户手势才能出声，所以由片头的"开始"按钮触发 initAudio()。
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setVolume(v: number) {
  if (master) master.gain.value = Math.max(0, Math.min(1, v));
}

function now() {
  return ctx ? ctx.currentTime : 0;
}

/** 一段噪声（砸、碎、打字都用它） */
function noiseBurst(dur: number, filterHz: number, gain: number, decay = 0.9) {
  const c = initAudio();
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  const src = c.createBufferSource();
  src.buffer = buf;

  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterHz;
  filter.Q.value = 0.8;

  const g = c.createGain();
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);

  src.connect(filter).connect(g).connect(master!);
  src.start();
  src.stop(now() + dur);
}

/** 一声低频闷响 */
function thump(freq: number, dur: number, gain: number) {
  const c = initAudio();
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, now());
  osc.frequency.exponentialRampToValueAtTime(freq * 0.4, now() + dur);

  const g = c.createGain();
  g.gain.setValueAtTime(gain, now());
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);

  osc.connect(g).connect(master!);
  osc.start();
  osc.stop(now() + dur);
}

/** 一个短促的音符 */
function tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const c = initAudio();
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now());
  g.gain.exponentialRampToValueAtTime(gain, now() + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
  osc.connect(g).connect(master!);
  osc.start();
  osc.stop(now() + dur);
}

export const sfx = {
  /** 砸键盘：脆响 + 闷响 */
  smash() {
    noiseBurst(0.18, 2600, 0.55);
    thump(120, 0.22, 0.5);
    window.setTimeout(() => noiseBurst(0.1, 900, 0.25), 60);
  },

  /** 门被踢/关上 */
  door() {
    thump(85, 0.3, 0.6);
    noiseBurst(0.12, 400, 0.25);
  },

  /** 小人进门 / 派活：一声轻快 */
  spawn(i = 0) {
    tone(520 + (i % 5) * 60, 0.12, 0.14, "triangle");
  },

  /** 回来交差 */
  done(i = 0) {
    tone(400 + (i % 5) * 40, 0.16, 0.1, "sine");
  },

  /** 打字 */
  key() {
    noiseBurst(0.03, 3200, 0.12, 1.6);
  },

  /** 需要你确认 */
  approval() {
    tone(880, 0.16, 0.16, "sine");
    window.setTimeout(() => tone(1174, 0.22, 0.14, "sine"), 130);
  },

  /** 交付 */
  chime() {
    [660, 880, 1320].forEach((f, i) => window.setTimeout(() => tone(f, 0.4, 0.12, "sine"), i * 110));
  },

  /** 下班关灯 */
  lightsOut() {
    thump(140, 0.6, 0.25);
  },
};
