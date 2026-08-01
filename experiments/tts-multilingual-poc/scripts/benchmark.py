from __future__ import annotations

import json
from pathlib import Path

from tts_poc import TTSRuntime


PROJECT_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = PROJECT_DIR.parents[1]
OUTPUT_DIR = REPO_DIR / "tmp" / "speech" / "multilingual-poc" / "benchmark"
RESULTS_PATH = OUTPUT_DIR / "results.json"
SPEEDS = {
    "zh": (1.0, 2.0),
    "ja": (1.0, 1.25, 1.5, 1.85),
}
TEXTS = {
    "zh": "页面缓缓流动，声音陪着读者向前。",
    "ja": "ページはゆっくり流れ、声が読者に寄り添います。",
}


def main() -> None:
    runtime = TTSRuntime(PROJECT_DIR / "models")
    records = []
    try:
        for language, text in TEXTS.items():
            for speed in SPEEDS[language]:
                result = runtime.synthesize(
                    text=text,
                    language=language,
                    speed=speed,
                    output_path=OUTPUT_DIR / f"{language}-{str(speed).replace('.', '-')}.wav",
                )
                record = result.to_dict()
                records.append(record)
                print(json.dumps(record, ensure_ascii=False))
    finally:
        runtime.close()

    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {RESULTS_PATH}")


if __name__ == "__main__":
    main()
