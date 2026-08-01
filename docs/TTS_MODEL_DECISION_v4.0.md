# 夜晚的书斋 v4.0「希声」TTS 模型配置决策草案

> 状态说明（2026-07-25）：模型 PoC 已暂停。本文只保留候选路线历史，不代表 MeloTTS 或 Kokoro 已被选为 v4 正式默认模型。内部逻辑达到 `GOAL.md` 完成线后再重新评估。

更新时间：2026-07-24

## 结论

v4.0 MVP 推荐采用：

```text
默认本地：MeloTTS
在线高质量：OpenAI gpt-4o-mini-tts
高级扩展：GPT-SoVITS / IndexTTS2 / MiniMax 作为后续 Provider
```

更具体地说：

1. **本地默认用 MeloTTS**：负责“希声”的日常低声随读，优先保证本地、轻量、快、固定音色和中英日基本覆盖。
2. **API 首发接 OpenAI TTS**：作为用户明确同意上传当前朗读片段后的高质量在线 fallback，优先覆盖英文、通用多语言和快速集成。
3. **MiniMax 暂列第二个 API Provider**：中文与多语言质量很值得接，但为了 v4.0 不走散，先不放进第一批开发目标。
4. **GPT-SoVITS / IndexTTS2 不作为默认内置**：它们更强也更重，适合做“外部本地服务 Provider”，供高级用户自行部署后接入。

一句话：

> v4.0 先用 MeloTTS 守住“本地希声”的气质，用 OpenAI 守住“在线高质量”的选择权，不在第一版把复杂 TTS 生态全部塞进产品。

## 为什么不是直接 GPT-SoVITS / IndexTTS2

GPT-SoVITS 与 IndexTTS2 都很强，尤其中文生态、zero-shot、情绪和流式能力值得重视。但「夜晚的书斋」v4.0 的核心不是声音创作，也不是音色克隆，而是 PDF 自动流动时的低干扰随读。

默认模型应满足：

- 不需要用户提供 reference audio。
- 不把用户引导到克隆、调参、情绪控制。
- 模型下载和 sidecar 复杂度可控。
- 生成短 chunk 时反应快。
- 默认本地运行。

在这个标准下，MeloTTS 更适合做默认基线。GPT-SoVITS / IndexTTS2 更适合作为可选 Provider，而不是默认体验。

## 为什么 API 第一批选 OpenAI，而不是 MiniMax

MiniMax 的中文、多语言、低延迟和自然度很有吸引力，后续非常值得接。但 v4.0 第一批 API Provider 更需要：

- SDK 和文档稳定。
- 集成成本低。
- streaming、wav/pcm/mp3 输出清晰。
- 用户可能已经有 API key。
- 适合英文书籍和学术文本。

OpenAI 的 `gpt-4o-mini-tts` 更适合作为第一批在线 Provider。MiniMax 可作为 v4.1 的中文高质量 Provider。

## 推荐 Provider 配置

### LocalMeloProvider

用途：默认本地随读。

语言策略：

```text
cjk / mixed：MeloTTS-Chinese
latin：MeloTTS-English
japanese：MeloTTS-Japanese
unknown：沿用上一个语言模型，或 fallback 到 Chinese
```

下载策略：

```text
首次开启希声时下载中文模型
英文、日文按需下载
不随 app 初始包内置模型
模型存入应用数据目录
```

默认参数：

```text
volume: 0.42
speed: 0.92 - 1.08，由阅读速度档位映射
chunk: 中文 20-80 字；英文 8-30 词；日文 20-80 字符
cache: 不保存整书音频，只允许短期内存缓存
```

### OpenAITtsProvider

用途：在线高质量 fallback。

建议默认：

```text
model: gpt-4o-mini-tts
voice: marin 或 cedar
format: pcm 或 wav，便于 Web Audio 播放
instructions: Read calmly, softly, and clearly, like a quiet study companion. Keep the pacing restrained and do not dramatize.
```

隐私提示必须出现：

```text
开启在线希声后，当前朗读片段会发送给 OpenAI 生成语音。PDF 文件本身不会上传。
```

### CustomLocalHttpProvider

用途：接 GPT-SoVITS、IndexTTS2、Qwen3-TTS、MiniMax 私有部署等外部服务。

接口形态：

```text
POST http://127.0.0.1:{port}/tts
{
  text,
  language,
  rate,
  voice,
  generationId
}
```

返回：

```text
audio/wav 或 audio/pcm
```

该 Provider 不进入 v4.0 默认 UI，只留开发者配置或实验入口。

## 基于 Goertz《Social Science Concepts》PDF 的快速测试观察

测试页：Chapter One, Introduction, PDF 页 16-20。

### 观察一：这是典型英文社科书，适合 OpenAI 和 MeloTTS-English

文本主体为英文长段落，偶有引文、脚注、页眉、书名斜体、破折号和括号。对 TTS 的要求主要是：

- 英文学术句子清晰。
- 引文不要过度戏剧化。
- 括号与页码不要读得太烦。
- 跳过页眉页脚和脚注。

### 观察二：TTS 前的文本清洗比模型选择更关键

直接从 PDF 提取会出现：

```text
October 20, 2005 14:31 nec100 Sheet number ...
CHAPTER ONE / INTRODUCTION running header
hyphenated line breaks: democ- racy
ligatures: ﬁ / ﬂ
spacing artifacts: beganhisSystem, Goertz’ s
```

如果不清洗，任何 TTS 模型都会读出奇怪内容。v4.0 必须先做 `ReadableChunk` 层。

### 观察三：理想 chunk 长度约 250-380 字符

清洗后，Goertz 这类书页每页大约可切成 6-8 个短 chunk。适合低声随读，不适合整页朗读。

示例 chunk：

```text
The contrast between Collier and Bollen on democracy illustrates this law in action. Collier and Mahon provide an insightful analysis of the concept of democracy, but give little guidance on how one might put these ideas into quantitative action.
```

这个长度适合：

- MeloTTS 本地短句生成。
- OpenAI API streaming。
- 跳页后快速取消。

## v4.0 实施优先级

### P0：文本结构层

先做：

- 页眉页脚过滤。
- 页码过滤。
- 断词修复。
- ligature 修复。
- 英文句子 chunk。
- 双栏检测。
- 脚注降权。

理由：没有这层，TTS 模型再好也会读垃圾文本。

### P1：MeloTTS 本地 Provider

目标：中文、英文、日文短 chunk 本地生成。

验收：

- 英文 chunk 生成不明显迟到。
- 中文中英混排可接受。
- 可取消。
- 不阻塞 PDF 滚动。

### P2：OpenAI API Provider

目标：快速提供高质量在线选择。

验收：

- 用户明确授权后才发送片段。
- 支持 streaming 或快速返回。
- 支持停止和过期 generation 丢弃。

### P3：CustomLocalHttpProvider

目标：给 GPT-SoVITS / IndexTTS2 / Qwen3-TTS 留入口。

验收：

- 能配置 localhost endpoint。
- 能发 chunk，收 wav/pcm。
- 能取消或丢弃过期返回。

## 当前决策

v4.0 第一版不再继续扩大模型选择范围。推荐锁定：

```text
LocalMeloProvider + OpenAITtsProvider + CustomLocalHttpProvider
```

MiniMax、GPT-SoVITS、IndexTTS2 都不放弃，但不进入 MVP 默认开发范围。

这能保证 v4.0 不走偏：声音能力变强，但产品仍然是“书斋”，不是“配音工作站”。
