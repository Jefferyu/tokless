---
name: token-audit
description: 审计与对比 Antigravity 会话的真实 Token 账单（Input / Output / Cache Read）、检测 256K 自动压缩失忆节点（CHECKPOINT）、揪出单次会话最烧额度的 Top 5 步骤，或诊断单个项目的 AGENTS.md 与 SKILL.md 肥胖度。
---

# Antigravity 账单透视与对比指南 (token-audit)

无需消耗任何模型 Token，直接通过本地脚本解析 Antigravity 底层会话日志（`transcript_full.jsonl` / `transcript.jsonl`）。

## 常用命令

> 注：Antigravity 仅向 Hook / MCP 进程注入 `PLUGIN_ROOT`，不会注入到常规 `run_command` 终端中；请直接使用下方全局插件安装路径（在独立仓库目录下也可直接运行 `tools/agy-audit/cli.js`）。

### macOS / Linux (bash / zsh)

```bash
# 1. 解剖单个会话（支持短 ID 前缀），查看 Token 消耗明细、256K 压缩触发点与 Top 5 烧钱步骤
node "$HOME/.gemini/config/plugins/agy-tokless/tools/agy-audit/cli.js" session <会话ID或前缀>

# 2. 优化前后双会话 A/B 对比（对比总 Token、Cache Read 滚雪球、盲读次数与节省比例）
node "$HOME/.gemini/config/plugins/agy-tokless/tools/agy-audit/cli.js" compare <优化前会话ID> <优化后会话ID>

# 3. 诊断指定项目的 AGENTS.md 与 .agents/skills 肥胖度及 Token 预算占比
node "$HOME/.gemini/config/plugins/agy-tokless/tools/agy-audit/cli.js" project <项目目录路径>
```

### Windows (PowerShell)

```powershell
# 1. 解剖单个会话（支持短 ID 前缀），查看 Token 消耗明细、256K 压缩触发点与 Top 5 烧钱步骤
node "$env:USERPROFILE\.gemini\config\plugins\agy-tokless\tools\agy-audit\cli.js" session <会话ID或前缀>

# 2. 优化前后双会话 A/B 对比（对比总 Token、Cache Read 滚雪球、盲读次数与节省比例）
node "$env:USERPROFILE\.gemini\config\plugins\agy-tokless\tools\agy-audit\cli.js" compare <优化前会话ID> <优化后会话ID>

# 3. 诊断指定项目的 AGENTS.md 与 .agents/skills 肥胖度及 Token 预算占比
node "$env:USERPROFILE\.gemini\config\plugins\agy-tokless\tools\agy-audit\cli.js" project <项目目录路径>
```
