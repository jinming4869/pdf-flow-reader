from __future__ import annotations

import base64
import gc
import io
import json
import logging
import os
import re
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any, Callable


PROTOCOL_VERSION = 1
MODEL_NAME = "kokoro-v1.0.int8.onnx"
VOICES_NAME = "voices-v1.0.bin"
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
LATIN_FRAGMENT = re.compile(
    r"[A-Za-z][A-Za-z0-9'’._/+:-]*(?:[ \t]+[A-Za-z][A-Za-z0-9'’._/+:-]*)*"
)


def normalize_language(language: object) -> str:
    normalized = str(language or "").strip().lower().replace("_", "-")
    try:
        return LANGUAGE_ALIASES[normalized]
    except KeyError as exc:
        raise ValueError(f"Unsupported multilingual TTS language: {language!r}") from exc


def join_phonemes(parts: list[str]) -> str:
    return " ".join(part.strip() for part in parts if part and part.strip()).strip()


def g2p_value(g2p: Callable[[str], Any], text: str) -> str:
    value = g2p(text)
    if isinstance(value, tuple):
        value = value[0]
    return str(value or "").strip()


def phonemize_chinese_mixed(
    text: str,
    chinese_g2p: Callable[[str], Any],
    english_g2p: Callable[[str], Any],
) -> str:
    """Use the legacy Chinese frontend while preserving embedded Latin speech."""
    parts: list[str] = []
    cursor = 0
    for match in LATIN_FRAGMENT.finditer(text):
        if match.start() > cursor:
            parts.append(g2p_value(chinese_g2p, text[cursor : match.start()]))
        parts.append(g2p_value(english_g2p, match.group(0)))
        cursor = match.end()
    if cursor < len(text):
        parts.append(g2p_value(chinese_g2p, text[cursor:]))
    return join_phonemes(parts)


class KokoroV10Runtime:
    def __init__(self, models_dir: str | Path):
        self.models_dir = Path(models_dir).expanduser().resolve()
        self._kokoro: Any = None
        self._g2ps: dict[str, Callable[[str], Any]] = {}
        self._espeak_shadow: tempfile.TemporaryDirectory[str] | None = None
        self._espeak_lib_path: str | None = None
        self._espeak_data_path: str | None = None
        self._model_load_seconds = 0.0

    def _required_paths(self) -> tuple[Path, Path]:
        model_path = self.models_dir / MODEL_NAME
        voices_path = self.models_dir / VOICES_NAME
        missing = [path for path in (model_path, voices_path) if not path.is_file()]
        if missing:
            raise FileNotFoundError(
                "Missing multilingual TTS model assets: "
                + ", ".join(str(path) for path in missing)
            )
        return model_path, voices_path

    def _ensure_model(self) -> float:
        if self._kokoro is not None:
            return 0.0

        import espeakng_loader
        from kokoro_onnx import Kokoro
        from kokoro_onnx.config import EspeakConfig

        model_path, voices_path = self._required_paths()
        started = time.perf_counter()
        parent_shadow = os.environ.get("PDF_FLOW_TTS_ESPEAK_SHADOW_DIR", "").strip()
        if parent_shadow:
            shadow_root = Path(parent_shadow).expanduser().resolve()
            shadow_root.mkdir(parents=True, exist_ok=True)
        else:
            self._espeak_shadow = tempfile.TemporaryDirectory(prefix="pdf-flow-reader-espeak-")
            shadow_root = Path(self._espeak_shadow.name)
        os.symlink(
            espeakng_loader.get_data_path(),
            shadow_root / "espeak-ng-data",
            target_is_directory=True,
        )
        self._espeak_lib_path = espeakng_loader.get_library_path()
        self._espeak_data_path = str(shadow_root)
        espeak_config = EspeakConfig(
            lib_path=self._espeak_lib_path,
            data_path=self._espeak_data_path,
        )
        self._kokoro = Kokoro(
            str(model_path),
            str(voices_path),
            espeak_config=espeak_config,
        )
        self._model_load_seconds = time.perf_counter() - started
        available = set(self._kokoro.get_voices())
        for voice in DEFAULT_VOICES.values():
            if voice not in available:
                raise RuntimeError(f"Expected voice {voice!r} is absent from {VOICES_NAME}")
        return self._model_load_seconds

    def _g2p_for(self, language: str) -> Callable[[str], Any]:
        if language in self._g2ps:
            return self._g2ps[language]

        if language == "zh":
            from misaki import zh
            from misaki.espeak import EspeakG2P
            from phonemizer.backend.espeak.wrapper import EspeakWrapper
            import jieba

            # Importing misaki.espeak resets both paths to espeakng-loader's
            # Unicode-containing package directory. Restore the ASCII shadow
            # before EspeakBackend initializes its shared singleton.
            EspeakWrapper.set_library(self._espeak_lib_path)
            EspeakWrapper.set_data_path(self._espeak_data_path)
            jieba.setLogLevel(logging.WARNING)
            chinese_g2p = zh.ZHG2P()
            english_g2p = EspeakG2P(language="en-us")
            g2p = lambda text: phonemize_chinese_mixed(text, chinese_g2p, english_g2p)
        else:
            from misaki import ja

            g2p = ja.JAG2P(version="pyopenjtalk")
        self._g2ps[language] = g2p
        return g2p

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

        model_load_seconds = self._ensure_model()
        selected_voice = str(voice or DEFAULT_VOICES[normalized_language])
        if selected_voice != DEFAULT_VOICES[normalized_language]:
            raise ValueError(
                f"Voice {selected_voice!r} is unavailable for {normalized_language}; "
                f"expected {DEFAULT_VOICES[normalized_language]!r}"
            )

        g2p_started = time.perf_counter()
        phonemes = g2p_value(self._g2p_for(normalized_language), clean_text)
        g2p_seconds = time.perf_counter() - g2p_started
        if not phonemes:
            raise ValueError("G2P produced no phonemes")

        synthesis_started = time.perf_counter()
        samples, sample_rate = self._kokoro.create(
            phonemes,
            voice=selected_voice,
            speed=numeric_speed,
            is_phonemes=True,
        )
        synthesis_seconds = time.perf_counter() - synthesis_started

        import soundfile as sf

        wav = io.BytesIO()
        sf.write(wav, samples, sample_rate, format="WAV", subtype="PCM_16")
        audio = wav.getvalue()
        return {
            "audioBase64": base64.b64encode(audio).decode("ascii"),
            "sampleRate": int(sample_rate),
            "durationMs": round((model_load_seconds + g2p_seconds + synthesis_seconds) * 1000),
            "audioSeconds": round(len(samples) / int(sample_rate), 4),
            "language": normalized_language,
            "voice": selected_voice,
            "speed": numeric_speed,
            "model": MODEL_NAME,
            "dtype": "int8",
            "phonemeCount": len(phonemes),
            "unknownPhonemeCount": phonemes.count("❓"),
        }

    def close(self) -> None:
        self._g2ps.clear()
        self._kokoro = None
        if self._espeak_shadow is not None:
            self._espeak_shadow.cleanup()
            self._espeak_shadow = None
        self._espeak_lib_path = None
        self._espeak_data_path = None
        gc.collect()


def emit(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def serialized_error(exc: Exception) -> dict[str, str]:
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
