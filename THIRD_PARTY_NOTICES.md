# Third-party notices

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
