/**
 * 从 DSH 会话记录里抹掉密钥。
 *
 * 会话日志会原样保存：
 *   - 工具调用的 arguments（`$env:AHOLO_API_KEY="xxx"`、`const KEY = "xxx"`）
 *   - 模型自己的 reasoning 文本（它可能把你给的 key 直接复述一遍）
 *
 * 所以光靠正则不够，还要按「已知的密钥字面量」做全局替换。
 * 用法：
 *   setRedactExtras([process.env.AHOLO_API_KEY])
 *   redactRecord(rec)
 */

let extras = [];

/** 传入你需要额外抹掉的明文（通常是环境变量里的 key） */
export function setRedactExtras(values = []) {
  extras = values.filter((v) => typeof v === "string" && v.length >= 6);
}

const RULES = [
  // AHOLO_API_KEY=xxx / LUX3D_API_KEY: "xxx"
  {
    re: /((?:AHOLO|LUX3D|OPENAI|ANTHROPIC|DEEPSEEK|GITHUB)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)\s*[=:]\s*)(?:\\?["'])?[A-Za-z0-9_\-]{6,}(?:\\?["'])?/gi,
    rep: "$1***REDACTED***",
  },
  // 变量赋值：const KEY = "xxx" / apiKey: "xxx"
  {
    re: /(\b(?:KEY|apiKey|API_KEY|token|secret|password)\b\s*[=:]\s*)(?:\\?["'`])?[A-Za-z0-9_\-]{6,}(?:\\?["'`])?/gi,
    rep: "$1***REDACTED***",
  },
  // 请求头里的凭证
  {
    re: /((?:authorization|ous-token-v2|x-api-key)\s*[:=]\s*)(?:\\?["'])?[A-Za-z0-9_\-\.]{6,}(?:\\?["'])?/gi,
    rep: "$1***REDACTED***",
  },
  // 各家常见的 key 前缀
  { re: /\bsk-[A-Za-z0-9]{12,}\b/g, rep: "***REDACTED***" },
  { re: /\bghp_[A-Za-z0-9]{20,}\b/g, rep: "***REDACTED***" },
  { re: /\bxox[bap]-[A-Za-z0-9\-]{10,}\b/g, rep: "***REDACTED***" },
  { re: /\bAKIA[A-Z0-9]{16}\b/g, rep: "***REDACTED***" },
];

export function redactString(s) {
  let out = s;
  // 先按已知明文整串替换（能盖住 reasoning 里的复述）
  for (const e of extras) out = out.split(e).join("***REDACTED***");
  for (const { re, rep } of RULES) out = out.replace(re, rep);
  return out;
}

/** 深度遍历，把所有字符串洗干净 */
export function redactRecord(rec) {
  const walk = (v) => {
    if (typeof v === "string") return redactString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v)) o[k] = walk(v[k]);
      return o;
    }
    return v;
  };
  return walk(rec);
}
