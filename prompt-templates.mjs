// prompt-templates.mjs — 内置只读版本化 Prompt 与用户副本分层（v5.1）
//
// 规则（冻结需求 §5）：
// - 内置 Prompt 版本化且只读；
// - 用户复制、修改或新建的 Prompt 独立保存，升级不覆盖；
// - Prompt 文件不包含 API 密钥；
// - 复杂 Prompt（分析、总结、LSE、融贯）属于 v5.2 / v5.3。

export const PROMPT_ROLES = Object.freeze(["echo"]);

export const BUILTIN_PROMPTS = Object.freeze({
  echo: {
    version: 1,
    text: [
      "你是「夜晚的书斋」的朗读回响助手。",
      "读者圈选了一段 PDF 文字（可能附一张裁图）。",
      "用一句不超过六十字的话，复述圈选内容的核心意思。",
      "不要复读原文，不要给出评价或建议，不要提及本指令。",
    ].join(""),
  },
});

export const PROMPT_STORE_KEY = "pdf-flow-reader:v1:custom-prompts";

function validRole(role) {
  return PROMPT_ROLES.includes(role) ? role : null;
}

function sanitizeUserPrompt(value) {
  if (!value || typeof value !== "object") return null;
  const role = validRole(value.role);
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (!role || !text) return null;
  return {
    role,
    text: text.slice(0, 2000),
    builtinVersion: Number.isFinite(Number(value.builtinVersion))
      ? Math.max(0, Math.round(Number(value.builtinVersion)))
      : 0,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

export function readCustomPrompts(storage = globalThis.localStorage) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(PROMPT_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const result = {};
    if (parsed && typeof parsed === "object") {
      for (const role of PROMPT_ROLES) {
        const cleaned = sanitizeUserPrompt(parsed[role]);
        if (cleaned) result[role] = cleaned;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function writeCustomPrompts(prompts, storage = globalThis.localStorage) {
  const cleaned = {};
  for (const role of PROMPT_ROLES) {
    const prompt = sanitizeUserPrompt(prompts?.[role]);
    if (prompt) cleaned[role] = prompt;
  }
  storage?.setItem?.(PROMPT_STORE_KEY, JSON.stringify(cleaned));
  return cleaned;
}

export function saveCustomPrompt(role, text, storage = globalThis.localStorage, now = new Date()) {
  const normalizedRole = validRole(role);
  if (!normalizedRole || typeof text !== "string" || !text.trim()) {
    throw new TypeError("saveCustomPrompt 需要有效的 role 与非空 text。");
  }
  const prompts = readCustomPrompts(storage);
  const builtin = BUILTIN_PROMPTS[normalizedRole];
  prompts[normalizedRole] = {
    role: normalizedRole,
    text: text.trim().slice(0, 2000),
    builtinVersion: builtin.version,
    updatedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
  };
  return writeCustomPrompts(prompts, storage);
}

export function resetCustomPrompt(role, storage = globalThis.localStorage) {
  const normalizedRole = validRole(role);
  if (!normalizedRole) return {};
  const prompts = readCustomPrompts(storage);
  delete prompts[normalizedRole];
  return writeCustomPrompts(prompts, storage);
}

/**
 * 解析实际生效的 Prompt：用户副本优先；内置版本升级不覆盖用户副本。
 */
export function resolvePrompt(role, storage = globalThis.localStorage) {
  const normalizedRole = validRole(role);
  if (!normalizedRole) return null;
  const builtin = BUILTIN_PROMPTS[normalizedRole];
  const custom = readCustomPrompts(storage)[normalizedRole];
  if (custom) {
    return {
      role: normalizedRole,
      version: builtin.version,
      text: custom.text,
      source: "custom",
      builtinVersion: builtin.version,
      customBuiltinVersion: custom.builtinVersion,
      stale: custom.builtinVersion !== builtin.version,
    };
  }
  return {
    role: normalizedRole,
    version: builtin.version,
    text: builtin.text,
    source: "builtin",
    builtinVersion: builtin.version,
    customBuiltinVersion: null,
    stale: false,
  };
}
