# Bundled CJK runtime licenses

The CJK worker is built from the following components. Full installed-package metadata and the Open JTalk dictionary notice are copied into the generated runtime directory during the build.

| Component | Version / asset | License | Source |
|---|---|---|---|
| Kokoro model and voices | v1.0 int8 | Apache-2.0 | <https://github.com/hexgrad/kokoro> |
| Misaki / misaki-fork | 0.9.6 | Apache-2.0 | <https://github.com/hexgrad/misaki> |
| ONNX Runtime | 1.28.0 | MIT | <https://github.com/microsoft/onnxruntime> |
| NumPy | 2.5.1 | BSD-3-Clause | <https://github.com/numpy/numpy> |
| pyopenjtalk | 0.4.1 | MIT | <https://github.com/r9y9/pyopenjtalk> |
| Open JTalk dictionary / UniDic data | 1.11 | BSD-3-Clause family | copied as `licenses/open-jtalk-dictionary-COPYING.txt` |
| cn2an | 0.5.24 | MIT | <https://github.com/Ailln/cn2an> |
| jieba | 0.42.1 | MIT | <https://github.com/fxsjy/jieba> |
| pypinyin | 0.55.0 | MIT | <https://github.com/mozillazg/python-pinyin> |
| ordered-set | 4.1.0 | MIT | <https://github.com/rspeer/ordered-set> |
| CPython | 3.12 | PSF-2.0 | <https://github.com/python/cpython> |
| PyInstaller bootloader | 6.21.0 | GPL-2.0-or-later WITH Bootloader-exception | <https://github.com/pyinstaller/pyinstaller> |

The formal runtime intentionally excludes `kokoro-onnx`, `phonemizer-fork`, `espeakng-loader`, and eSpeak NG.
