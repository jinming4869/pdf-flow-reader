import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 扫描产品源码，确保没有硬编码的密钥形状字符串。
// 排除测试、vendor 第三方构建、打包产物、模型运行时与示例数据。

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SCANNED_EXTENSIONS = new Set([".mjs", ".cjs", ".js", ".html", ".md"]);

const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  "vendor",
  "dist",
  "dist-book-opening",
  "build",
  "runtime",
  "third-party",
  "output",
  "tmp",
  "worktrees",
  ".git",
  ".github",
  "__pycache__",
  ".pytest_cache",
  "experiments",
  "backups",
]);

const KEY_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function walk(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    if (EXCLUDED_DIRECTORIES.has(entry)) continue;
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, files);
    } else if (SCANNED_EXTENSIONS.has(fullPath.slice(fullPath.lastIndexOf(".")))) {
      files.push(fullPath);
    }
  }
  return files;
}

function fileContainsKeyShape(filePath) {
  const raw = readFileSync(filePath, "utf8");
  // 允许测试 fixture 与文档示例中的明显占位符。
  const sanitized = raw.replace(/sk-(?:test|example|placeholder|demo|your-)/gi, "sk-");
  for (const pattern of KEY_PATTERNS) {
    if (pattern.test(sanitized)) {
      const match = sanitized.match(pattern)[0];
      return { pattern: pattern.toString().slice(1, -1), match };
    }
  }
  return null;
}

test("product source ships no hard-coded secret-shaped strings", () => {
  const files = walk(projectRoot).filter((filePath) => (
    !filePath.includes(join("tests", ""))
  ));
  const offenders = [];
  for (const filePath of files) {
    const hit = fileContainsKeyShape(filePath);
    if (hit) offenders.push({ filePath, ...hit });
  }
  assert.deepEqual(offenders, []);
});

test("localStorage preferences keep no non-empty plaintext api key field", () => {
  const storageSource = readFileSync(join(projectRoot, "storage.mjs"), "utf8");
  // 默认值与迁移目标都必须是空字符串；sanitize 删除空字段。
  assert.match(storageSource, /openaiTtsApiKey: ""/);
  assert.match(storageSource, /if \(!preferences\.openaiTtsApiKey\) delete preferences\.openaiTtsApiKey/);
});
