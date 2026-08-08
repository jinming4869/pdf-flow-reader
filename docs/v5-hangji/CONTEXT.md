# v5「航迹」上下文

## 北极星

「让 PDF 阅读和轻吻纸质书一样好玩」中的“好玩”，不是积分、打卡或惩罚，而是用短期情感回报支持长期有益的阅读行为。

情感引擎由四段构成：

1. 载入仪式和自动流动把现实世界暂时推远。
2. 当前档位内缓慢加速，制造有挑战但可逆的唤醒。
3. 六档命名、视觉氛围、声音和希声重新标识身体感受，使速度压力成为书流的一部分。
4. 套索把一次主动中断转化为阅读痕迹；手动回流重新闭合心流循环。

## 已有工程基础

v4.0.0 已提供：

- PDF.js 页面渲染、坐标映射和大型文件按区间读取；
- 原生文字与附近页 OCR；
- 当前页附近的可选择文字层和点句目标；
- 六档物理速度、阅读线、背景与希声策略；
- 跳页、暂停、换文档时统一取消渲染、OCR 与 TTS；
- 本地阅读记录与 PDF 指纹基础。

v5 可以复用这些能力，但自由套索、高质量裁图、持久阅读痕迹、情绪坐标、回流曲线、书架航迹图和外部归档都需要独立的数据模型与测试边界。

## Prompt 资产

用户现有 Zotero GPT Prompt 分为四组：

- 全文：分析、综合、融贯、全文总结、LSE 阅读 Worksheet；
- 选中文字：翻译、解释、概括、改写、摘要总结、复述；
- 笔记：填充笔记、续写、总结、提升写作；
- 页面图像：截图翻译。

v5 只继承其中符合情感引擎的部分：

- 流动阅读期间使用经过收紧的“一句复述”；
- 书架提供分析、全文总结和 LSE 阅读 Worksheet；
- 多文献选择后才提供融贯；
- 其他 Prompt 不进入核心界面。

Prompt 可以从安全的独立 JSON 导入；不得读取包含 API 密钥的 Zotero 配置文件。

## 情绪数据

每枚阅读痕迹至少包含：

```text
document fingerprint
page index and normalized lasso path
high-resolution crop reference
native/OCR source text and provenance
one-sentence restatement state and result
valence [-1, 1]
arousal [-1, 1]
speed tier and physical px/s
reading order and timestamp
archive/export state
```

情绪名称由坐标邻域解释，不作为唯一存储值。AI 输出与用户情绪必须分开保存，避免模型文字被误认为读者自己的感受。
