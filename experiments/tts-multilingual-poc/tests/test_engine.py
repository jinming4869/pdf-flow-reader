from pathlib import Path

import pytest

from tts_poc.engine import LANGUAGE_SPECS, TTSRuntime, normalize_language


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("zh", "zh"),
        ("ZH_CN", "zh"),
        ("zh-Hans", "zh"),
        ("cmn", "zh"),
        ("ja", "ja"),
        ("ja_JP", "ja"),
        ("jpn", "ja"),
    ],
)
def test_normalize_language(source, expected):
    assert normalize_language(source) == expected


def test_rejects_unsupported_language():
    with pytest.raises(ValueError, match="Unsupported language"):
        normalize_language("en")


def test_model_specs_use_distinct_language_assets():
    assert LANGUAGE_SPECS["zh"].model_name != LANGUAGE_SPECS["ja"].model_name
    assert LANGUAGE_SPECS["zh"].default_voice.startswith("zf_")
    assert LANGUAGE_SPECS["ja"].default_voice.startswith("jf_")


def test_missing_assets_fail_before_model_load(tmp_path: Path):
    runtime = TTSRuntime(tmp_path)
    assert runtime._espeak_config.data_path.isascii()
    assert (Path(runtime._espeak_config.data_path) / "espeak-ng-data").is_dir()
    with pytest.raises(FileNotFoundError, match="Missing model assets"):
        runtime.load("zh")


def test_chinese_v11_fractional_speed_is_not_silently_truncated(tmp_path: Path):
    runtime = TTSRuntime(tmp_path)
    with pytest.raises(ValueError, match="fractional speed is blocked"):
        runtime.synthesize(
            text="测试",
            language="zh",
            speed=1.5,
            output_path=tmp_path / "never-created.wav",
        )
