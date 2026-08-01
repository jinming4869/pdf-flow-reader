const { existsSync, readdirSync, rmSync } = require("node:fs");
const { join, relative, resolve } = require("node:path");

function removeGenerated(target, root, removed) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const relation = relative(resolvedRoot, resolvedTarget);
  if (!relation || relation.startsWith("..")) {
    throw new Error(`Refusing to prune path outside packaged node_modules: ${resolvedTarget}`);
  }
  if (!existsSync(resolvedTarget)) return;
  rmSync(resolvedTarget, { recursive: true, force: true });
  removed.push(relation);
}

function keepOnly(directory, names, root, removed) {
  if (!existsSync(directory)) return;
  for (const name of readdirSync(directory)) {
    if (!names.has(name)) removeGenerated(join(directory, name), root, removed);
  }
}

module.exports = async function afterPack(context) {
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  const nodeModules = join(resourcesDir, "app", "node_modules");
  const removed = [];

  removeGenerated(join(nodeModules, "onnxruntime-web"), nodeModules, removed);

  const transformers = join(nodeModules, "@huggingface", "transformers");
  for (const name of [".cache", "src", "types", "README.md"]) {
    removeGenerated(join(transformers, name), nodeModules, removed);
  }
  keepOnly(join(transformers, "dist"), new Set(["transformers.node.mjs"]), nodeModules, removed);

  const kokoro = join(nodeModules, "kokoro-js");
  for (const name of ["types", "README.md"]) {
    removeGenerated(join(kokoro, name), nodeModules, removed);
  }
  keepOnly(join(kokoro, "dist"), new Set(["kokoro.js"]), nodeModules, removed);
  keepOnly(join(kokoro, "voices"), new Set(["af_heart.bin"]), nodeModules, removed);

  const nativeRoot = join(nodeModules, "onnxruntime-node", "bin", "napi-v3");
  keepOnly(nativeRoot, new Set([process.platform]), nodeModules, removed);
  keepOnly(join(nativeRoot, process.platform), new Set([process.arch]), nodeModules, removed);

  const required = [
    join(transformers, "dist", "transformers.node.mjs"),
    join(kokoro, "dist", "kokoro.js"),
    join(kokoro, "voices", "af_heart.bin"),
    join(nativeRoot, process.platform, process.arch, "onnxruntime_binding.node"),
  ];
  const missing = required.filter((path) => !existsSync(path));
  if (missing.length) throw new Error(`Packaged English TTS files are missing: ${missing.join(", ")}`);
  console.log(`Pruned ${removed.length} unused English TTS package paths`);
};
