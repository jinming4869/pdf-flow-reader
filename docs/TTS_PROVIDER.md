# TTS Provider interface draft

This document reserves the architecture for a future v4.0 TTS feature. v3.0 does not implement speech synthesis, does not call any API, and does not send document text anywhere.

## Goal

Future TTS should read text near the current reading line while the PDF auto-scrolls. It should pause, resume, and jump with the reading clock rather than read the whole document blindly.

## Core data contracts

### TextSegment

Defined in `text-segment.mjs`.

```js
{
  documentId,
  pageIndex,
  segmentIndex,
  text,
  languageHint, // cjk | latin | mixed | unknown
  bbox,
  yStart,
  yEnd,
  source, // native-text | ocr
  confidence
}
```

### ReadingClock

Defined in `reading-clock.mjs`.

```js
{
  isPlaying,
  speedPxPerSecond,
  scrollTop,
  viewportHeight,
  scrollHeight,
  currentPageIndex,
  readingLineY,
  progressRatio,
  updatedAt
}
```

## Provider shape

A future provider should follow this shape:

```js
{
  id: "system-voice",
  name: "System voice",
  mode: "local" | "api",
  languages: ["zh-CN", "en", "ja"],
  async synthesize(text, options) {
    return {
      audioBuffer,
      durationMs,
      language,
      providerMeta,
    };
  },
  cancel?.()
}
```

## Privacy rules

- Default mode must remain `off` until the user explicitly enables TTS.
- API mode must require explicit consent.
- If API mode is enabled, the UI must state what text is sent.
- Local reading records and TTS cache must be clearable.
- TTS provider code must not run during v3.0.

## v3.0 boundary

v3.0 only provides data structures and tests. It intentionally does not expose a TTS button, model loader, API key field, audio cache, or provider implementation.
