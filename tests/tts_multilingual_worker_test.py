from tts_multilingual_worker import (
    DEFAULT_VOICES,
    MAX_TOKENS,
    MODEL_NAME,
    configure_utf8_stdio,
    normalize_language,
    split_phoneme_batches,
)


def test_v10_model_and_selected_voices_are_fixed():
    assert MODEL_NAME == "kokoro-v1.0.int8.onnx"
    assert DEFAULT_VOICES == {"zh": "zf_xiaobei", "ja": "jf_alpha"}


def test_language_aliases_normalize_to_supported_workers():
    assert normalize_language("ZH_CN") == "zh"
    assert normalize_language("cjk") == "zh"
    assert normalize_language("ja-JP") == "ja"


def test_phoneme_batches_use_model_token_count_and_retain_unknowns():
    vocab = {"a": 1, "b": 2, " ": 3}
    assert split_phoneme_batches("aa❓bb", vocab, max_tokens=2) == ["aa❓", "bb"]


def test_phoneme_batch_limit_matches_voice_style_table():
    assert MAX_TOKENS == 509


def test_ndjson_protocol_forces_utf8_on_legacy_platform_streams():
    calls = []

    class Stream:
        def reconfigure(self, **options):
            calls.append(options)

    configure_utf8_stdio((Stream(), Stream(), Stream()))
    assert calls == [
        {"encoding": "utf-8", "errors": "strict"},
        {"encoding": "utf-8", "errors": "strict"},
        {"encoding": "utf-8", "errors": "strict"},
    ]
