from __future__ import annotations

import base64
import gc
import io
import json
import logging
import os
import sys
import time
import traceback
import wave
from pathlib import Path
from typing import Any, Callable


PROTOCOL_VERSION = 1
MODEL_NAME = "kokoro-v1.0.int8.onnx"
VOICES_NAME = "voices-v1.0.bin"
VOCAB_NAME = "tts-kokoro-vocab.json"
SAMPLE_RATE = 24_000
MAX_TOKENS = 509
DEFAULT_VOICES = {"zh": "zf_xiaobei", "ja": "jf_alpha"}
LANGUAGE_ALIASES = {
    "zh": "zh",
    "zh-cn": "zh",
    "zh-hans": "zh",
    "cmn": "zh",
    "cjk": "zh",
    "mixed": "zh",
    "ja": "ja",
    "ja-jp": "ja",
    "jpn": "ja",
    "japanese": "ja",
}


def normalize_language(language: object) -> str:
    normalized = str(language or "").strip().lower().replace("_", "-")
    try:
        return LANGUAGE_ALIASES[normalized]
    except KeyError as exc:
        raise ValueError(f"Unsupported multilingual TTS language: {language!r}") from exc


def g2p_value(g2p: Callable[[str], Any], text: str) -> str:
    value = g2p(text)
    if isinstance(value, tuple):
        value = value[0]
    return str(value or "").strip()


def split_phoneme_batches(
    phonemes: str,
    vocab: dict[str, int],
    max_tokens: int = MAX_TOKENS,
) -> list[str]:
    """Split by model-token count while retaining unknowns for diagnostics."""
    if max_tokens < 1:
        raise ValueError("max_tokens must be positive")
    batches: list[str] = []
    current: list[str] = []
    token_count = 0
    for character in phonemes:
        contributes_token = character in vocab
        if contributes_token and token_count >= max_tokens:
            batches.append("".join(current).strip())
            current = []
            token_count = 0
        current.append(character)
        if contributes_token:
            token_count += 1
    final = "".join(current).strip()
    if final:
        batches.append(final)
    return [batch for batch in batches if any(character in vocab for character in batch)]


def pcm16_wav(samples: Any, sample_rate: int = SAMPLE_RATE) -> bytes:
    import numpy as np

    mono = np.asarray(samples, dtype=np.float32).reshape(-1)
    pcm = (np.clip(mono, -1.0, 1.0) * 32_767.0).astype("<i2", copy=False)
    output = io.BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(pcm.tobytes())
    return output.getvalue()


def trim_silence(samples: Any, sample_rate: int = SAMPLE_RATE) -> Any:
    """Remove long model padding while retaining 30 ms around spoken audio."""
    import numpy as np

    mono = np.asarray(samples, dtype=np.float32).reshape(-1)
    if mono.size == 0:
        return mono
    peak = float(np.max(np.abs(mono)))
    if peak <= 0:
        return mono
    audible = np.flatnonzero(np.abs(mono) >= max(1e-4, peak * 1e-3))
    if audible.size == 0:
        return mono
    padding = int(sample_rate * 0.03)
    start = max(0, int(audible[0]) - padding)
    end = min(mono.size, int(audible[-1]) + padding + 1)
    return mono[start:end]


def bundled_asset_path(name: str) -> Path:
    return Path(__file__).resolve().with_name(name)


class KokoroV10Runtime:
    """Minimal permissive CJK runner for the fixed Kokoro v1.0 ONNX export."""

    def __init__(self, models_dir: str | Path):
        self.models_dir = Path(models_dir).expanduser().resolve()
        self._session: Any = None
        self._voices: Any = None
        self._vocab: dict[str, int] = {}
        self._g2ps: dict[str, Callable[[str], Any]] = {}

    def _required_paths(self) -> tuple[Path, Path, Path]:
        model_path = self.models_dir / MODEL_NAME
        voices_path = self.models_dir / VOICES_NAME
        vocab_path = bundled_asset_path(VOCAB_NAME)
        missing = [path for path in (model_path, voices_path, vocab_path) if not path.is_file()]
        if missing:
            raise FileNotFoundError(
                "Missing multilingual TTS assets: " + ", ".join(str(path) for path in missing)
            )
        return model_path, voices_path, vocab_path

    def _ensure_model(self) -> None:
        if self._session is not None:
            return
        import numpy as np
        import onnxruntime as ort

        model_path, voices_path, vocab_path = self._required_paths()
        self._session = ort.InferenceSession(
            str(model_path),
            providers=["CPUExecutionProvider"],
        )
        self._voices = np.load(voices_path)
        with vocab_path.open(encoding="utf-8") as handle:
            self._vocab = json.load(handle)["vocab"]
        available = set(self._voices.keys())
        for voice in DEFAULT_VOICES.values():
            if voice not in available:
                raise RuntimeError(f"Expected voice {voice!r} is absent from {VOICES_NAME}")

    def _g2p_for(self, language: str) -> Callable[[str], Any]:
        if language in self._g2ps:
            return self._g2ps[language]
        if language == "zh":
            from misaki import zh
            import jieba

            jieba.setLogLevel(logging.WARNING)
            g2p = zh.ZHG2P()
        else:
            from misaki import ja

            g2p = ja.JAG2P(version="pyopenjtalk")
        self._g2ps[language] = g2p
        return g2p

    def _create_audio(self, phonemes: str, voice: str, speed: float) -> tuple[Any, int]:
        import numpy as np

        voice_styles = self._voices[voice]
        parts = []
        unknown_count = 0
        for batch in split_phoneme_batches(phonemes, self._vocab):
            token_ids = [self._vocab[character] for character in batch if character in self._vocab]
            unknown_count += sum(character not in self._vocab for character in batch)
            if not token_ids:
                continue
            style = np.asarray(voice_styles[len(token_ids)], dtype=np.float32)
            inputs = {
                "tokens": np.asarray([[0, *token_ids, 0]], dtype=np.int64),
                "style": style,
                "speed": np.asarray([speed], dtype=np.float32),
            }
            audio = self._session.run(None, inputs)[0]
            parts.append(trim_silence(audio))
        if not parts:
            raise ValueError("G2P produced no model tokens")
        return np.concatenate(parts), unknown_count

    def synthesize(
        self,
        *,
        text: object,
        language: object,
        voice: object = None,
        speed: object = 1.0,
    ) -> dict[str, Any]:
        clean_text = str(text or "").strip()
        if not clean_text:
            raise ValueError("Text must not be empty")
        normalized_language = normalize_language(language)
        numeric_speed = float(speed)
        if not 0.5 <= numeric_speed <= 2.0:
            raise ValueError("Speed must be between 0.5 and 2.0")

        started = time.perf_counter()
        self._ensure_model()
        selected_voice = str(voice or DEFAULT_VOICES[normalized_language])
        if selected_voice != DEFAULT_VOICES[normalized_language]:
            raise ValueError(
                f"Voice {selected_voice!r} is unavailable for {normalized_language}; "
                f"expected {DEFAULT_VOICES[normalized_language]!r}"
            )

        phonemes = g2p_value(self._g2p_for(normalized_language), clean_text)
        if not phonemes:
            raise ValueError("G2P produced no phonemes")
        samples, unknown_count = self._create_audio(phonemes, selected_voice, numeric_speed)
        audio = pcm16_wav(samples)
        return {
            "audioBase64": base64.b64encode(audio).decode("ascii"),
            "sampleRate": SAMPLE_RATE,
            "durationMs": round((time.perf_counter() - started) * 1000),
            "audioSeconds": round(len(samples) / SAMPLE_RATE, 4),
            "language": normalized_language,
            "voice": selected_voice,
            "speed": numeric_speed,
            "model": MODEL_NAME,
            "dtype": "int8",
            "phonemeCount": len(phonemes),
            "unknownPhonemeCount": unknown_count,
        }

    def close(self) -> None:
        self._g2ps.clear()
        if self._voices is not None:
            self._voices.close()
        self._voices = None
        self._session = None
        self._vocab = {}
        gc.collect()


def emit(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def serialized_error(exc: Exception) -> dict[str, str | None]:
    return {
        "name": type(exc).__name__,
        "message": str(exc),
        "code": getattr(exc, "code", None),
    }


def run() -> int:
    models_dir = os.environ.get("PDF_FLOW_TTS_MODELS_DIR", "").strip()
    if not models_dir:
        raise RuntimeError("PDF_FLOW_TTS_MODELS_DIR is required")
    runtime = KokoroV10Runtime(models_dir)
    emit({"type": "ready", "protocolVersion": PROTOCOL_VERSION, "pid": os.getpid()})
    try:
        for raw_line in sys.stdin:
            if not raw_line.strip():
                continue
            request_id: object = None
            try:
                message = json.loads(raw_line)
                request_id = message.get("requestId")
                message_type = message.get("type")
                if message_type == "synthesize":
                    payload = message.get("payload") or {}
                    result = runtime.synthesize(
                        text=payload.get("text"),
                        language=payload.get("language"),
                        voice=payload.get("voice"),
                        speed=payload.get("speed", 1.0),
                    )
                    emit({"type": "result", "requestId": request_id, "result": result})
                elif message_type == "health":
                    emit({
                        "type": "result",
                        "requestId": request_id,
                        "result": {"ok": True, "protocolVersion": PROTOCOL_VERSION},
                    })
                elif message_type == "shutdown":
                    emit({"type": "result", "requestId": request_id, "result": {"ok": True}})
                    return 0
                else:
                    raise ValueError(f"Unknown message type: {message_type!r}")
            except Exception as exc:
                traceback.print_exc(file=sys.stderr)
                emit({"type": "error", "requestId": request_id, "error": serialized_error(exc)})
    finally:
        runtime.close()
    return 0


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
