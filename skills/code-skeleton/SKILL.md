---
name: code-skeleton
description: 提取代码文件或目录的紧凑语法骨架（仅保留类名、函数签名、导出接口与精确 [L起-L止] 行号，剥离具体实现代码）。在探索代码库、排查 Bug 或读取超过 200 行的大文件前使用此技能快速定位行号，可减少 85%~97% 的探索期 Token 消耗。
---

# 代码骨架极速提取指南 (code-skeleton)

为了避免调用 `read_file` 盲目全量读取几百行代码导致后续每一轮对话背负高额的 Cache Read 滚雪球成本，请先提取带 `[L起-L止]` 行号的语法骨架。

## 使用方法

```bash
# 1. 扫描源码目录（自动排除 node_modules/.git/dist/target 等，默认深度 2），一步拿到全局函数与行号地图
node "${PLUGIN_ROOT:-$HOME/.gemini/config/plugins/agy-tokless}/tools/repo-skeleton/cli.js" <目录路径> --depth 2

# 2. 提取单个大文件的函数/类签名与起止行号
node "${PLUGIN_ROOT:-$HOME/.gemini/config/plugins/agy-tokless}/tools/repo-skeleton/cli.js" <文件路径>
```

> 注：Antigravity 仅向 Hook / MCP 进程注入 `PLUGIN_ROOT`，不会注入到常规 `run_command` 终端中；未设置时上面命令会自动回退到 `~/.gemini/config/plugins/agy-tokless`（Windows 为 `%USERPROFILE%\.gemini\config\plugins\agy-tokless`）。作为独立仓库运行时，也可直接调用仓库下的 `tools/repo-skeleton/cli.js`。

拿到目标函数的 `[L起-L止]` 行号后，直接调用 `read_file(Path, StartLine, EndLine)` 精准读取对应代码段。
