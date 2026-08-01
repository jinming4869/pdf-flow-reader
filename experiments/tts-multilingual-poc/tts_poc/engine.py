from __future__ import annotations

import gc
import os
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

import espeakng_loader
import psutil
import soundfile as sf
from kokoro_onnx import Kokoro
from kokoro_onnx.config import EspeakConfig
from misaki import ja, zh
from misaki.espeak import EspeakG2P


@dataclass(frozen=True)
class LanguageSpec:
    code: str
    model_name: str
    voices_name: str
    default_voice: str
    config_name: str | None = None


LANGUAGE_SPECS = {
    "zh": LanguageSpec(
        code="zh",
        model_name="kokoro-v1.1-zh.onnx",
        voices_name="voices-v1.1-zh.bin",
        config_name="config-v1.1-zh.json",
        default_voice="zf_001",
    ),
    "ja": LanguageSpec(
        code="ja",
        model_name="kokoro-v1.0.int8.onnx",
        voices_name="voices-v1.0.bin",
        default_voice="jf_alpha",
    ),
}


LANGUAGE_ALIASES = {
    "zh": "zh",
    "zh-cn": "zh",
    "zh-hans": "zh",
    "cmn": "zh",
    "ja": "ja",
    "ja-jp": "ja",
    "jpn": "ja",
}


def normalize_language(language: str) -> str:
    normalized = str(language or "").strip().lower().replace("_", "-")
    try:
        return LANGUAGE_ALIASES[normalized]
    except KeyError as exc:
        raise ValueError(f"Unsupported language: {language!r}") from exc


@dataclass(frozen=True)
class SynthesisResult:
    language: str
    voice: str
    speed: float
    output_path: str
    phonemes: str
    unknown_phoneme_count: int
    sample_rate: int
    sample_count: int
    audio_seconds: float
    model_load_seconds: float
    g2p_seconds: float
    synthesis_seconds: float
    rtf: float
    rss_mb: float

    def to_dict(self) -> dict:
        return asdict(self)


class TTSRuntime:
    """Keeps one language model warm and releases it when language changes."""

    def __init__(self, models_dir: str | Path):
        self.models_dir = Path(models_dir).expanduser().resolve()
        self._espeak_shadow = tempfile.TemporaryDirectory(prefix="pdf-flow-reader-espeak-")
        shadow_root = Path(self._espeak_shadow.name)
        os.symlink(espeakng_loader.get_data_path(), shadow_root / "espeak-ng-data", target_is_directory=True)
        self._espeak_config = EspeakConfig(
            lib_path=espeakng_loader.get_library_path(),
            data_path=str(shadow_root),
        )
        self._language: str | None = None
        self._kokoro: Kokoro | None = None
        self._g2p: Callable[[str], tuple[str, object]] | None = None
        self._model_load_seconds = 0.0

    @property
    def active_language(self) -> str | None:
        return self._language

    def close(self) -> None:
        self._g2p = None
        self._kokoro = None
        self._language = None
        self._model_load_seconds = 0.0
        gc.collect()

    def _required_paths(self, language: str) -> tuple[LanguageSpec, Path, Path, Path | None]:
        spec = LANGUAGE_SPECS[language]
        model_path = self.models_dir / spec.model_name
        voices_path = self.models_dir / spec.voices_name
        config_path = self.models_dir / spec.config_name if spec.config_name else None
        missing = [path for path in (model_path, voices_path, config_path) if path and not path.is_file()]
        if missing:
            joined = ", ".join(str(path) for path in missing)
            raise FileNotFoundError(f"Missing model assets: {joined}")
        return spec, model_path, voices_path, config_path

    def load(self, language: str) -> float:
        language = normalize_language(language)
        if self._language == language and self._kokoro is not None and self._g2p is not None:
            return 0.0

        self.close()
        spec, model_path, voices_path, config_path = self._required_paths(language)
        started = time.perf_counter()
        self._kokoro = Kokoro(
            str(model_path),
            str(voices_path),
            espeak_config=self._espeak_config,
            vocab_config=str(config_path) if config_path else None,
        )

        if language == "zh":
            english_g2p = EspeakG2P(language="en-us")
            self._g2p = zh.ZHG2P(
                version="1.1",
                en_callable=lambda segment: english_g2p(segment)[0],
            )
        else:
            self._g2p = ja.JAG2P(version="pyopenjtalk")

        self._language = language
        self._model_load_seconds = time.perf_counter() - started
        assert spec.default_voice in self._kokoro.get_voices(), (
            f"Expected voice {spec.default_voice!r} is absent from {spec.voices_name}"
        )
        return self._model_load_seconds

    def voices(self, language: str) -> list[str]:
        self.load(language)
        assert self._kokoro is not None
        return self._kokoro.get_voices()

    def synthesize(
        self,
        *,
        text: str,
        language: str,
        output_path: str | Path,
        voice: str | None = None,
        speed: float = 1.0,
    ) -> SynthesisResult:
        clean_text = str(text or "").strip()
        if not clean_text:
            raise ValueError("Text must not be empty")
        speed = float(speed)
        if not 0.5 <= speed <= 2.0:
            raise ValueError("Speed must be between 0.5 and 2.0")

        language = normalize_language(language)
        if language == "zh" and speed not in (1.0, 2.0):
            raise ValueError(
                "Kokoro v1.1-zh only accepts integer speed 1 or 2; "
                "fractional speed is blocked instead of being silently truncated"
            )
        model_load_seconds = self.load(language)
        assert self._kokoro is not None
        assert self._g2p is not None

        selected_voice = voice or LANGUAGE_SPECS[language].default_voice
        if selected_voice not in self._kokoro.get_voices():
            raise ValueError(f"Voice {selected_voice!r} is unavailable for {language}")

        g2p_started = time.perf_counter()
        phonemes, _ = self._g2p(clean_text)
        g2p_seconds = time.perf_counter() - g2p_started
        phonemes = str(phonemes or "").strip()
        if not phonemes:
            raise ValueError("G2P produced no phonemes")

        synthesis_started = time.perf_counter()
        samples, sample_rate = self._kokoro.create(
            phonemes,
            voice=selected_voice,
            speed=speed,
            is_phonemes=True,
        )
        synthesis_seconds = time.perf_counter() - synthesis_started
        sample_count = int(len(samples))
        audio_seconds = sample_count / int(sample_rate)
        rtf = synthesis_seconds / audio_seconds if audio_seconds else float("inf")

        destination = Path(output_path).expanduser().resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        sf.write(destination, samples, sample_rate, subtype="PCM_16")

        rss_mb = psutil.Process().memory_info().rss / (1024 * 1024)
        return SynthesisResult(
            language=language,
            voice=selected_voice,
            speed=speed,
            output_path=str(destination),
            phonemes=phonemes,
            unknown_phoneme_count=phonemes.count("❓"),
            sample_rate=int(sample_rate),
            sample_count=sample_count,
            audio_seconds=round(audio_seconds, 4),
            model_load_seconds=round(model_load_seconds, 4),
            g2p_seconds=round(g2p_seconds, 4),
            synthesis_seconds=round(synthesis_seconds, 4),
            rtf=round(rtf, 4),
            rss_mb=round(rss_mb, 2),
        )
