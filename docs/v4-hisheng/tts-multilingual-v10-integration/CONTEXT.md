# 上下文

- PoC 已在提交 `af1864b` 验证：中日文离线合成、持久 worker、硬取消、进程重建与 Unicode 路径规避均可行。
- 用户于 2026-07-31 选择中文 v1.0，默认音色 `zf_xiaobei`。
- 当前正式应用把中文/日文错误映射到英文 `af_heart`，所以“支持中英日”的界面元数据与真实能力不一致。
- 当前英文 `tts-runtime-client.mjs` 已有串行队列、背压、超时、崩溃恢复和 `SIGKILL` 硬取消，必须保留。
- 本地可复用资源位于 `experiments/tts-multilingual-poc/.venv` 与 `experiments/tts-multilingual-poc/models`，均被 Git 忽略。
- 工程路径含中文；eSpeak 数据必须通过 ASCII 临时软链接路径加载。
