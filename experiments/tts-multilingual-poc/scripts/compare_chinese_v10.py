from __future__ import annotations

import json
import time
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro
from misaki import zh

from tts_poc import TTSRuntime


PROJECT_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = PROJECT_DIR.parents[1]
OUTPUT_DIR = REPO_DIR / "output" / "speech" / "multilingual-poc"
TEXT = "阅读不是把文字匆匆翻过去，而是在一句话旁边，给自己的思想留一点停顿。"
SPEEDS = (1.0, 1.25, 1.5, 1.85)


def main() -> None:
    runtime = TTSRuntime(PROJECT_DIR / "models")
    kokoro = Kokoro(
        str(PROJECT_DIR / "models" / "kokoro-v1.0.int8.onnx"),
        str(PROJECT_DIR / "models" / "voices-v1.0.bin"),
        espeak_config=runtime._espeak_config,
    )
    phonemes, _ = zh.ZHG2P()(TEXT)
    try:
        for speed in SPEEDS:
            started = time.perf_counter()
            samples, sample_rate = kokoro.create(
                phonemes,
                voice="zf_xiaobei",
                speed=speed,
                is_phonemes=True,
            )
            elapsed = time.perf_counter() - started
            output_path = OUTPUT_DIR / f"zh-v10-legacy-{str(speed).replace('.', '-')}.wav"
            output_path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(output_path, samples, sample_rate, subtype="PCM_16")
            audio_seconds = len(samples) / sample_rate
            print(
                json.dumps(
                    {
                        "speed": speed,
                        "output_path": str(output_path),
                        "audio_seconds": round(audio_seconds, 4),
                        "synthesis_seconds": round(elapsed, 4),
                        "rtf": round(elapsed / audio_seconds, 4),
                    },
                    ensure_ascii=False,
                )
            )
    finally:
        runtime.close()


if __name__ == "__main__":
    main()
