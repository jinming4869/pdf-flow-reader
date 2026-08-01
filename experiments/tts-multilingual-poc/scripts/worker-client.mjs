import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const defaultPython = path.join(projectDir, ".venv", "bin", "python");

export class TtsPocWorker {
  constructor({ python = defaultPython } = {}) {
    this.child = spawn(python, ["-m", "tts_poc.worker"], {
      cwd: projectDir,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.pending = new Map();
    this.nextRequestId = 1;
    this.stderr = "";
    this.closing = false;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => this.#onLine(line));
    this.child.once("error", (error) => {
      this.rejectReady(error);
      this.#rejectAll(error);
    });
    this.child.once("exit", (code, signal) => {
      const error = new Error(`TTS worker exited (code=${code}, signal=${signal})${this.stderr ? `\n${this.stderr}` : ""}`);
      this.#rejectAll(error);
    });
  }

  #onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.#rejectAll(new Error(`Invalid worker JSON: ${line}`, { cause: error }));
      return;
    }
    if (message.type === "ready") {
      this.resolveReady(message);
      return;
    }
    const pending = this.pending.get(String(message.requestId));
    if (!pending) return;
    this.pending.delete(String(message.requestId));
    if (message.type === "error") {
      pending.reject(new Error(`${message.error?.name ?? "WorkerError"}: ${message.error?.message ?? "Unknown error"}`));
    } else {
      pending.resolve(message.result);
    }
  }

  #rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  async request(type, payload = undefined) {
    await this.ready;
    if (!this.child || this.child.killed || this.child.stdin.writableEnded) {
      throw new Error("TTS worker is not running");
    }
    const requestId = String(this.nextRequestId++);
    const response = new Promise((resolve, reject) => this.pending.set(requestId, { resolve, reject }));
    this.child.stdin.write(`${JSON.stringify({ type, requestId, payload })}\n`);
    return response;
  }

  cancelHard() {
    if (!this.child || this.child.killed) return;
    this.child.kill("SIGTERM");
    const child = this.child;
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 500).unref();
  }

  async close() {
    if (this.closing || !this.child || this.child.killed || this.child.exitCode !== null) return;
    this.closing = true;
    try {
      await this.request("shutdown");
    } finally {
      this.child.stdin.end();
    }
  }
}

async function cli() {
  const command = process.argv[2] ?? "health";
  const worker = new TtsPocWorker();
  try {
    if (command === "health") {
      console.log(JSON.stringify(await worker.request("health"), null, 2));
      return;
    }
    if (command === "synthesize") {
      const language = process.argv[3] ?? "zh";
      const outputPath = process.argv[4] ?? path.resolve(projectDir, `../../tmp/speech/multilingual-poc/worker-${language}.wav`);
      const text = process.argv[5] ?? (language === "ja" ? "ページをゆっくり読みます。" : "让页面缓缓流动。月色很好。PDF与OCR都在这里。2026年。")
      const speed = Number(process.argv[6] ?? 1.0);
      const result = await worker.request("synthesize", { language, text, speed, outputPath });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (command === "cancel-demo") {
      const outputPath = process.argv[3] ?? path.resolve(projectDir, "../../tmp/speech/multilingual-poc/cancelled.wav");
      const warmupPath = `${outputPath}.warmup.wav`;
      if (existsSync(outputPath)) unlinkSync(outputPath);
      if (existsSync(warmupPath)) unlinkSync(warmupPath);
      await worker.request("synthesize", {
        language: "zh",
        text: "先让模型完成一次很短的预热。",
        speed: 1.0,
        outputPath: warmupPath,
      });
      const synthesis = worker.request("synthesize", {
        language: "zh",
        text: "这是一次必须被父进程真正取消的长语音推理。".repeat(20),
        speed: 0.7,
        outputPath,
      });
      setTimeout(() => worker.cancelHard(), 50);
      try {
        await synthesis;
        throw new Error("Expected hard cancellation, but synthesis completed");
      } catch (error) {
        if (!String(error.message).includes("worker exited")) throw error;
        console.log(JSON.stringify({ cancelled: true, outputCreated: existsSync(outputPath), warmupCreated: existsSync(warmupPath), outputPath }, null, 2));
      }
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } finally {
    if (command !== "cancel-demo") await worker.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
