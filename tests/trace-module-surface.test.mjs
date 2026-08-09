import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createReaderServer } from "../server.mjs";

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createReaderServer({
      ttsRuntime: { close() {} },
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

test("trace contracts are included in the desktop package", () => {
  const packageJson = JSON.parse(readFileSync(
    new URL("../package.json", import.meta.url),
    "utf8",
  ));
  assert.ok(packageJson.build.files.includes("reading-trace.mjs"));
  assert.ok(packageJson.build.files.includes("trace-session.mjs"));
  assert.ok(packageJson.build.files.includes("trace-client.mjs"));
  assert.ok(packageJson.build.files.includes("lasso-geometry.mjs"));
  assert.ok(packageJson.build.files.includes("trace-crop.mjs"));
});

test("local reader server exposes trace contracts as JavaScript modules", async (t) => {
  const { server, origin } = await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  for (const filename of [
    "reading-trace.mjs",
    "trace-session.mjs",
    "trace-client.mjs",
    "trace-capture-controller.mjs",
    "lasso-geometry.mjs",
    "trace-crop.mjs",
  ]) {
    const response = await fetch(`${origin}/${filename}`, {
      method: "HEAD",
      headers: { Connection: "close" },
    });
    assert.equal(response.status, 200, filename);
    assert.match(response.headers.get("content-type"), /text\/javascript/, filename);
    assert.ok(Number(response.headers.get("content-length")) > 1000, filename);
  }
});
