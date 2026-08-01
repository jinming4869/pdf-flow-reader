"""Isolated multilingual TTS proof of concept."""

from .engine import SynthesisResult, TTSRuntime, normalize_language

__all__ = ["SynthesisResult", "TTSRuntime", "normalize_language"]
