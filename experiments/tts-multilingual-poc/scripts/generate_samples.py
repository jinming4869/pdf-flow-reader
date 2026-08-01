from __future__ import annotations

import json
from pathlib import Path

from tts_poc import TTSRuntime


PROJECT_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = PROJECT_DIR.parents[1]
OUTPUT_DIR = REPO_DIR / "output" / "speech" / "multilingual-poc"
MANIFEST_PATH = REPO_DIR / "tmp" / "speech" / "multilingual-poc" / "manifest.json"

SAMPLES = [
    {
        "id": "zh-v11-ordinary-100",
        "language": "zh",
        "speed": 1.0,
        "text": "阅读不是把文字匆匆翻过去，而是在一句话旁边，给自己的思想留一点停顿。",
    },
    {
        "id": "zh-v11-long-100",
        "language": "zh",
        "speed": 1.0,
        "text": "当页面缓缓向下流动时，声音不必夺走目光，它只需要在复杂的论证之间搭一座小桥，让读者仍然能够轻松地跟上作者。",
    },
    {
        "id": "zh-v11-mixed-100",
        "language": "zh",
        "speed": 1.0,
        "text": "在2026年的测试里，PDF阅读器会结合OCR与Kokoro，估算每分钟大约三百二十个字。",
    },
    {
        "id": "ja-ordinary-125",
        "language": "ja",
        "speed": 1.25,
        "text": "読書とは文字を急いで通り過ぎることではなく、一つの文のそばで自分の考えを少し休ませることです。",
    },
    {
        "id": "ja-long-150",
        "language": "ja",
        "speed": 1.5,
        "text": "ページがゆっくり流れるとき、声は視線を奪うのではなく、複雑な議論のあいだに小さな橋を架けて、読者が自然に先へ進めるように寄り添います。",
    },
    {
        "id": "ja-mixed-100",
        "language": "ja",
        "speed": 1.0,
        "text": "2026年のテストでは、PDFリーダーがOCRとKokoroを使い、一分あたり約三百二十文字を推定します。",
    },
]


def main() -> None:
    runtime = TTSRuntime(PROJECT_DIR / "models")
    results = []
    try:
        for sample in SAMPLES:
            output_path = OUTPUT_DIR / f"{sample['id']}.wav"
            result = runtime.synthesize(
                text=sample["text"],
                language=sample["language"],
                speed=sample["speed"],
                output_path=output_path,
            )
            record = {**sample, **result.to_dict()}
            results.append(record)
            print(json.dumps(record, ensure_ascii=False))
    finally:
        runtime.close()

    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
