from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.metadata
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "build" / "runtime" / "tts-multilingual"
DEFAULT_WORK = ROOT / "build" / "tts-multilingual-pyinstaller"
ASSETS = {
    "kokoro-v1.0.int8.onnx": {
        "url": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx",
        "sha256": "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb",
        "bytes": 92_361_271,
    },
    "voices-v1.0.bin": {
        "url": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
        "sha256": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
        "bytes": 28_214_398,
    },
}
PACKAGE_NAMES = [
    "cn2an",
    "jieba",
    "misaki-fork",
    "numpy",
    "onnxruntime",
    "ordered-set",
    "pyinstaller",
    "pyopenjtalk",
    "pypinyin",
]
FORBIDDEN_RUNTIME_NAMES = ("phonemizer", "espeak", "kokoro_onnx", "kokoro-onnx")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def assert_generated_path(path: Path) -> None:
    build_root = (ROOT / "build").resolve()
    resolved = path.resolve()
    if resolved == build_root or not resolved.is_relative_to(build_root):
        raise ValueError(f"Refusing to replace non-generated path: {resolved}")


def reset_directory(path: Path) -> None:
    assert_generated_path(path)
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "pdf-flow-reader-release-builder/4.0"})
    with urllib.request.urlopen(request, timeout=180) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def prepare_models(models_dir: Path, source_dir: Path | None) -> dict[str, dict[str, object]]:
    models_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict[str, object]] = {}
    for name, expected in ASSETS.items():
        destination = models_dir / name
        source = source_dir / name if source_dir else None
        if source and source.is_file():
            shutil.copy2(source, destination)
        else:
            print(f"Downloading {name} ...", flush=True)
            download(str(expected["url"]), destination)
        actual_hash = sha256(destination)
        actual_size = destination.stat().st_size
        if actual_hash != expected["sha256"] or actual_size != expected["bytes"]:
            raise RuntimeError(
                f"Model verification failed for {name}: {actual_size} bytes, sha256 {actual_hash}"
            )
        manifest[name] = {
            "bytes": actual_size,
            "sha256": actual_hash,
            "source": expected["url"],
        }
    return manifest


def prewarm_open_jtalk() -> Path:
    import pyopenjtalk

    pyopenjtalk.run_frontend("静かな声で本を読みます。")
    package_root = Path(pyopenjtalk.__file__).resolve().parent
    notices = list(package_root.glob("open_jtalk_dic_utf_8-*/COPYING"))
    if len(notices) != 1:
        raise RuntimeError(f"Expected one Open JTalk dictionary notice, found {notices}")
    return notices[0]


def build_worker(output_root: Path, work_root: Path) -> Path:
    import PyInstaller.__main__

    reset_directory(work_root)
    dist_dir = work_root / "dist"
    spec_dir = work_root / "spec"
    pyinstaller_work = work_root / "work"
    separator = os.pathsep
    PyInstaller.__main__.run([
        str(ROOT / "tts_multilingual_worker.py"),
        "--name", "tts-multilingual-worker",
        "--onedir",
        "--console",
        "--noconfirm",
        "--clean",
        "--noupx",
        "--distpath", str(dist_dir),
        "--workpath", str(pyinstaller_work),
        "--specpath", str(spec_dir),
        "--add-data", f"{ROOT / 'tts-kokoro-vocab.json'}{separator}.",
        "--collect-data", "pyopenjtalk",
        "--hidden-import", "misaki.zh",
        "--hidden-import", "misaki.ja",
        "--exclude-module", "espeakng_loader",
        "--exclude-module", "phonemizer",
        "--exclude-module", "kokoro_onnx",
        "--exclude-module", "torch",
        "--exclude-module", "spacy",
        "--exclude-module", "fugashi",
        "--exclude-module", "unidic",
    ])
    built = dist_dir / "tts-multilingual-worker"
    if not built.is_dir():
        raise RuntimeError(f"PyInstaller output missing: {built}")
    worker_dir = output_root / "worker"
    shutil.copytree(built, worker_dir)
    executable = worker_dir / (
        "tts-multilingual-worker.exe" if os.name == "nt" else "tts-multilingual-worker"
    )
    if not executable.is_file():
        raise RuntimeError(f"Bundled worker executable missing: {executable}")
    return executable


def audit_runtime(output_root: Path) -> None:
    violations = []
    for path in output_root.rglob("*"):
        lower = path.name.lower()
        if any(name in lower for name in FORBIDDEN_RUNTIME_NAMES):
            violations.append(str(path.relative_to(output_root)))
    if violations:
        raise RuntimeError(f"Forbidden GPL/eSpeak runtime files were bundled: {violations}")


def smoke_worker(executable: Path, models_dir: Path) -> None:
    requests = [
        {"type": "synthesize", "requestId": "zh", "payload": {
            "text": "让阅读像亲吻纸质书一样好玩。", "language": "zh", "speed": 1.0,
        }},
        {"type": "synthesize", "requestId": "ja", "payload": {
            "text": "静かな声で本を読みます。", "language": "ja", "speed": 1.0,
        }},
        {"type": "shutdown", "requestId": "stop"},
    ]
    payload = "".join(json.dumps(request, ensure_ascii=False) + "\n" for request in requests)
    env = {**os.environ, "PDF_FLOW_TTS_MODELS_DIR": str(models_dir)}
    completed = subprocess.run(
        [str(executable)],
        input=payload,
        text=True,
        encoding="utf-8",
        errors="strict",
        capture_output=True,
        env=env,
        timeout=240,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"Bundled worker smoke failed ({completed.returncode}):\n{completed.stderr}\n{completed.stdout}"
        )
    messages = [json.loads(line) for line in completed.stdout.splitlines() if line.strip()]
    results = {message.get("requestId"): message for message in messages if message.get("type") == "result"}
    for request_id in ("zh", "ja"):
        encoded = results.get(request_id, {}).get("result", {}).get("audioBase64", "")
        audio = base64.b64decode(encoded) if encoded else b""
        if not audio.startswith(b"RIFF") or len(audio) < 1_000:
            raise RuntimeError(f"Bundled worker returned invalid {request_id} WAV")


def write_manifest(
    output_root: Path,
    model_manifest: dict[str, dict[str, object]],
    dictionary_notice: Path,
) -> None:
    licenses_dir = output_root / "licenses"
    licenses_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(
        ROOT / "runtime" / "tts-multilingual" / "THIRD_PARTY_LICENSES.md",
        licenses_dir / "THIRD_PARTY_LICENSES.md",
    )
    shutil.copy2(dictionary_notice, licenses_dir / "open-jtalk-dictionary-COPYING.txt")
    packages = {name: importlib.metadata.version(name) for name in PACKAGE_NAMES}
    manifest = {
        "schemaVersion": 1,
        "runtime": "pdf-flow-reader-cjk",
        "python": sys.version.split()[0],
        "platform": sys.platform,
        "packages": packages,
        "models": model_manifest,
        "excluded": list(FORBIDDEN_RUNTIME_NAMES),
    }
    (output_root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the bundled multilingual TTS runtime")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--work-dir", type=Path, default=DEFAULT_WORK)
    parser.add_argument("--models-dir", type=Path)
    parser.add_argument("--skip-smoke", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_root = args.output_dir.resolve()
    work_root = args.work_dir.resolve()
    reset_directory(output_root)
    source_dir = args.models_dir.resolve() if args.models_dir else None
    model_manifest = prepare_models(output_root / "models", source_dir)
    dictionary_notice = prewarm_open_jtalk()
    executable = build_worker(output_root, work_root)
    write_manifest(output_root, model_manifest, dictionary_notice)
    audit_runtime(output_root)
    if not args.skip_smoke:
        smoke_worker(executable, output_root / "models")
    print(json.dumps({
        "output": str(output_root),
        "executable": str(executable),
        "bytes": sum(path.stat().st_size for path in output_root.rglob("*") if path.is_file()),
        "smoke": not args.skip_smoke,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
