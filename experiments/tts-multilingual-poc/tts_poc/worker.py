from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

from .engine import TTSRuntime


PROTOCOL_VERSION = 1
PROJECT_DIR = Path(__file__).resolve().parents[1]


def emit(message: dict) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def error_message(request_id: object, exc: Exception) -> dict:
    return {
        "type": "error",
        "requestId": request_id,
        "error": {
            "name": type(exc).__name__,
            "message": str(exc),
        },
    }


def run() -> int:
    runtime = TTSRuntime(PROJECT_DIR / "models")
    emit({"type": "ready", "protocolVersion": PROTOCOL_VERSION, "pid": __import__("os").getpid()})

    for raw_line in sys.stdin:
        if not raw_line.strip():
            continue
        request_id = None
        try:
            message = json.loads(raw_line)
            request_id = message.get("requestId")
            message_type = message.get("type")
            if message_type == "health":
                emit(
                    {
                        "type": "result",
                        "requestId": request_id,
                        "result": {
                            "ok": True,
                            "activeLanguage": runtime.active_language,
                            "protocolVersion": PROTOCOL_VERSION,
                        },
                    }
                )
            elif message_type == "synthesize":
                payload = message.get("payload") or {}
                result = runtime.synthesize(
                    text=payload.get("text", ""),
                    language=payload.get("language", ""),
                    voice=payload.get("voice"),
                    speed=payload.get("speed", 1.0),
                    output_path=payload.get("outputPath", ""),
                )
                emit({"type": "result", "requestId": request_id, "result": result.to_dict()})
            elif message_type == "shutdown":
                emit({"type": "result", "requestId": request_id, "result": {"ok": True}})
                runtime.close()
                return 0
            else:
                raise ValueError(f"Unknown message type: {message_type!r}")
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            emit(error_message(request_id, exc))
    runtime.close()
    return 0


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
