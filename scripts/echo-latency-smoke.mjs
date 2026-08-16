// echo-latency-smoke.mjs — 一句复述的真实网络延迟实测
//
// 用法：
//   node scripts/echo-latency-smoke.mjs --api-key sk-... [--runs 20]
//
// 只发送合成句子，不包含私人 PDF 内容。统计 P50 / P95，退出码
// 0 表示 P95 低于 3000ms 且无失败。

import { createEchoClient, EchoRequestError } from "../echo-client.mjs";

function parseArgs(argv) {
  const args = { runs: 20, apiKey: process.env.DEEPSEEK_API_KEY ?? "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--api-key") args.apiKey = argv[index + 1] ?? "";
    if (argv[index] === "--base-url") args.baseUrl = argv[index + 1];
    if (argv[index] === "--model") args.model = argv[index + 1];
    if (argv[index] === "--runs") args.runs = Number(argv[index + 1] ?? 20);
  }
  return args;
}

function percentile(sorted, ratio) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)];
}

const SYNTHETIC_TEXT = [
  "圈选内容比较了两种民主测量方法：Collier 与 Adcock 的概念与测量之争。",
  "这一段讨论测量效度对跨国比较研究的影响。",
  "作者主张概念分歧根源于对民主的扩展定义不同。",
  "此处指出数据生成过程对统计推断的约束。",
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.apiKey) {
    console.error("需要 --api-key 或 DEEPSEEK_API_KEY 环境变量。");
    process.exit(2);
  }
  const client = createEchoClient({
    apiKey: args.apiKey,
    baseUrl: args.baseUrl ?? "https://api.deepseek.com",
    model: args.model ?? "deepseek-chat",
    timeoutMs: 10_000,
  });

  const latencies = [];
  const failures = [];
  for (let run = 0; run < args.runs; run += 1) {
    const text = SYNTHETIC_TEXT[run % SYNTHETIC_TEXT.length];
    try {
      const result = await client.generateEcho({ text });
      latencies.push(result.latencyMs);
      process.stdout.write(`#${run + 1} ${result.latencyMs}ms ${result.mode}\n`);
    } catch (error) {
      failures.push({
        run: run + 1,
        code: error?.code ?? "unknown",
        message: error?.message ?? String(error),
      });
      process.stdout.write(`#${run + 1} FAILED ${error?.code}\n`);
    }
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const summary = {
    runs: args.runs,
    model: args.model ?? "deepseek-chat",
    succeeded: latencies.length,
    failed: failures.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    meanMs: sorted.length
      ? Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length)
      : null,
    minMs: sorted[0] ?? null,
    maxMs: sorted.at(-1) ?? null,
    failures,
  };
  console.log(`ECHO_LATENCY_RESULT ${JSON.stringify(summary)}`);
  const passed = summary.failed === 0 && summary.p95Ms !== null && summary.p95Ms < 3_000;
  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  console.error(`ECHO_LATENCY_FAILED ${error?.message ?? error}`);
  process.exit(1);
});
