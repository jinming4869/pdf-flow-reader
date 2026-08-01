from tts_multilingual_worker import (
    DEFAULT_VOICES,
    MODEL_NAME,
    join_phonemes,
    normalize_language,
    phonemize_chinese_mixed,
)


def test_v10_model_and_selected_voices_are_fixed():
    assert MODEL_NAME == "kokoro-v1.0.int8.onnx"
    assert DEFAULT_VOICES == {"zh": "zf_xiaobei", "ja": "jf_alpha"}


def test_language_aliases_normalize_to_supported_workers():
    assert normalize_language("ZH_CN") == "zh"
    assert normalize_language("cjk") == "zh"
    assert normalize_language("ja-JP") == "ja"


def test_mixed_chinese_uses_english_frontend_only_for_latin_fragments():
    chinese_calls = []
    english_calls = []

    def chinese(value):
        chinese_calls.append(value)
        return f"ZH({value})", None

    def english(value):
        english_calls.append(value)
        return f"EN({value})", None

    phonemes = phonemize_chinese_mixed("在2026年，PDF Reader结合OCR阅读。", chinese, english)
    assert chinese_calls == ["在2026年，", "结合", "阅读。"]
    assert english_calls == ["PDF Reader", "OCR"]
    assert phonemes == "ZH(在2026年，) EN(PDF Reader) ZH(结合) EN(OCR) ZH(阅读。)"


def test_join_phonemes_removes_empty_boundaries():
    assert join_phonemes([" a ", "", "  ", "b"]) == "a b"
