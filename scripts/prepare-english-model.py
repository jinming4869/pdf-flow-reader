from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "build" / "runtime" / "tts-english"
MODEL_ID = "onnx-community/Kokoro-82M-ONNX"
ASSETS = {
    "config.json": {
        "bytes": 44,
        "sha256": "df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f",
    },
    "tokenizer_config.json": {
        "bytes": 113,
        "sha256": "be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20",
    },
    "tokenizer.json": {
        "bytes": 4_608,
        "sha256": "ee301fc39cf903ddbb463564630a28767785e3a11edd6d8226e92d4b4ef131bb",
    },
    "onnx/model_quantized.onnx": {
        "bytes": 92_360_543,
        "sha256": "0d55b15d4b735d61a21b0105136bc81b8768c4db94753193c19354fa863cd556",
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def reset_output() -> None:
    resolved = OUTPUT_ROOT.resolve()
    build_root = (ROOT / "build").resolve()
    if not resolved.is_relative_to(build_root) or resolved == build_root:
        raise ValueError(f"Refusing to replace non-generated path: {resolved}")
    if OUTPUT_ROOT.exists():
        shutil.rmtree(OUTPUT_ROOT)
    OUTPUT_ROOT.mkdir(parents=True)


def download(relative: str, destination: Path) -> str:
    url = f"https://huggingface.co/{MODEL_ID}/resolve/main/{relative}"
    request = urllib.request.Request(url, headers={"User-Agent": "pdf-flow-reader-release-builder/4.0"})
    with urllib.request.urlopen(request, timeout=240) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)
    return url


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare the offline kokoro-js English model")
    parser.add_argument("--source-dir", type=Path)
    args = parser.parse_args()
    source_root = args.source_dir.resolve() if args.source_dir else None
    reset_output()
    model_root = OUTPUT_ROOT / "models" / MODEL_ID
    manifest = {}
    for relative, expected in ASSETS.items():
        destination = model_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        source = source_root / relative if source_root else None
        url = f"https://huggingface.co/{MODEL_ID}/resolve/main/{relative}"
        if source and source.is_file():
            shutil.copy2(source, destination)
        else:
            print(f"Downloading English TTS asset {relative} ...", flush=True)
            url = download(relative, destination)
        actual_size = destination.stat().st_size
        actual_hash = sha256(destination)
        if actual_size != expected["bytes"] or actual_hash != expected["sha256"]:
            raise RuntimeError(
                f"English model verification failed for {relative}: "
                f"{actual_size} bytes, sha256 {actual_hash}"
            )
        manifest[relative] = {
            "bytes": actual_size,
            "sha256": actual_hash,
            "source": url,
        }
    (OUTPUT_ROOT / "manifest.json").write_text(json.dumps({
        "schemaVersion": 1,
        "runtime": "pdf-flow-reader-english",
        "modelId": MODEL_ID,
        "dtype": "q8",
        "license": "Apache-2.0",
        "assets": manifest,
    }, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(OUTPUT_ROOT),
        "bytes": sum(path.stat().st_size for path in OUTPUT_ROOT.rglob("*") if path.is_file()),
    }, indent=2))


if __name__ == "__main__":
    main()
