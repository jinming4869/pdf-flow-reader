# Third-party notices

## Electron

The desktop build uses Electron as its application runtime. Electron is licensed under the MIT License.

Source: <https://github.com/electron/electron>

## electron-builder

The desktop build is packaged with electron-builder. electron-builder is licensed under the MIT License.

Source: <https://github.com/electron-userland/electron-builder>

## PDF.js

This project includes compiled distribution files from Mozilla PDF.js 5.6.205:

- `vendor/pdf.mjs`
- `vendor/pdf.worker.mjs`

PDF.js is licensed under the Apache License 2.0. Its license text is included at `third-party/PDF.js-LICENSE.txt`.

Source: <https://github.com/mozilla/pdf.js>

## Tesseract.js

This project includes compiled browser distribution files from Tesseract.js 7.0.0:

- `vendor/tesseract/tesseract.esm.min.js`
- `vendor/tesseract/worker.min.js`

Tesseract.js is licensed under the Apache License 2.0. Its license text is included at `third-party/Tesseract.js-LICENSE.md`.

Source: <https://github.com/naptha/tesseract.js>

## Tesseract.js Core

This project includes the LSTM-only fallback, SIMD, and relaxed-SIMD browser builds from Tesseract.js Core 7.0.0 under `vendor/tesseract/core/`.

Tesseract.js Core is licensed under the Apache License 2.0. Its license text is included at `third-party/Tesseract.js-core-LICENSE.txt`.

Source: <https://github.com/naptha/tesseract.js-core>

## OCR language data

The local Simplified Chinese, Traditional Chinese, English, and Japanese integer language models under `vendor/tesseract/lang/` come from these npm packages at version 1.0.0:

- `@tesseract.js-data/chi_sim`
- `@tesseract.js-data/chi_tra`
- `@tesseract.js-data/eng`
- `@tesseract.js-data/jpn`

The packages declare the MIT License in their package metadata. The bundled files are the `4.0.0_best_int` variants.

Source: <https://github.com/naptha/tessdata>

## Kokoro model, kokoro-js, and Misaki

The desktop release includes Kokoro v1.0 ONNX model assets and uses `kokoro-js` 1.2.1 for English speech plus `misaki-fork` 0.9.6 for Chinese and Japanese grapheme-to-phoneme conversion. These components are licensed under the Apache License 2.0.

Sources:

- <https://github.com/hexgrad/kokoro>
- <https://github.com/hexgrad/misaki>
- <https://github.com/onnx-community/Kokoro-82M-ONNX>

## Transformers.js and phonemizer.js

The English worker uses `@huggingface/transformers` 3.8.1 and the JavaScript `phonemizer` package 1.2.1. Both declare the Apache License 2.0.

Sources:

- <https://github.com/huggingface/transformers.js>
- <https://github.com/xenova/phonemizer.js>

## ONNX Runtime

The English Node runtime and bundled CJK worker use ONNX Runtime. ONNX Runtime is licensed under the MIT License.

Source: <https://github.com/microsoft/onnxruntime>

## Bundled CJK Python runtime

The CJK worker bundles CPython 3.12, NumPy, pyopenjtalk, cn2an, jieba, pypinyin, ordered-set and their runtime dependencies. Component versions and source/license references are recorded in `runtime/tts-multilingual/THIRD_PARTY_LICENSES.md` and copied into every generated desktop runtime.

The bundled Open JTalk 1.11 dictionary combines notices from NAIST, the UniDic Consortium, and the HTS Working Group under BSD-style redistribution terms. Its full `COPYING` file is included in the generated runtime as `licenses/open-jtalk-dictionary-COPYING.txt`.

## PyInstaller

The self-contained CJK worker is created with PyInstaller 6.21.0. PyInstaller is GPL-2.0-or-later with its Bootloader Exception, which grants unlimited permission to embed and distribute the compiled bootloader and related files in combinations with other programs.

Source: <https://github.com/pyinstaller/pyinstaller>

The formal CJK runtime intentionally excludes the Python `phonemizer-fork`, `espeakng-loader`, eSpeak NG, and `kokoro-onnx` packages.
