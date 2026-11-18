# AGY-Tokless ⚡

> **核心初心：在 100% 保证工程代码质量的前提下，把 Google Antigravity 中无意义的 Token 消耗压到最低。**

**专为 Google Antigravity 打造的省流护栏、AST 语法骨架导航与 256K 自动压缩账单透视套件。**

在不损失任何代码排查与修复质量的前提下，实测单次复杂工程任务可减少 **34.4% 模型往返调用**、砍掉 **53.2% 总 Token 消耗（净省 1,138 万 Cache Read 滚雪球 Token）**，并大幅延缓触发 **256K 自动压缩失忆（Compaction Drift）**。

---

## ⚡ 10 秒傻瓜安装（复制一句提示词直接交给 Antigravity）

不需要你手动敲命令或改配置文件，直接打开你的 **Antigravity 聊天窗口**，复制下面这一句提示词发给它，它会自动帮你完成克隆、挂载与首次账单体检：

### 方式一：联网直接一键安装（最省事，复制即用）
```text
请帮我把 https://github.com/daoif/agy-tokless 克隆到本地并运行里面的 node install.js 完成 agy-tokless 省流插件的全局安装与启用，然后用它的 agy-audit 工具帮我看看我最近一次会话的 Token 账单。
```

### 方式二：如果你下载了离线压缩包（[Releases 下载](https://github.com/daoif/agy-tokless/releases)）
解压到任意目录后，把下面这句发给 Antigravity（将路径换成你的实际解压路径）：
```text
请运行 node "<你解压的目录路径>/install.js" 帮我安装并启用 agy-tokless 省流插件，然后用它的 agy-audit 工具帮我看看我最近一次会话的 Token 账单。
```

---

## 🔥 为什么你在 Antigravity 里的周额度掉得这么快？

通过对数十个真实 Antigravity 会话底层日志（`transcript_full.jsonl`）的账单解剖，我们发现吃光额度的罪魁祸首只有两个：

1. **盲目全量 `read_file` 引发的「Cache Read 滚雪球效应」**：
   为了找一个函数，AI 习惯性调 `read_file` 把几百上千行的源码全塞进上下文。如果第 3 步塞进 3 万 Token 的无关代码，而整个任务跑了 50 步，这 3 万 Token 就会在后续每一步被重复计费 47 次（光这一步就要白交 **140 万+ Cache Read Token**）！
2. **跨过 `256K` 阈值触发的「自动压缩失忆（Compaction Drift）」**：
   实测表明，当单步上下文（`input_tokens + cache_read_tokens`）跨过 **`256,000`（256K，部分 Gemini 4 会话为 512K）** 时，Antigravity 底层 Cortex 引擎会强制插入 `CHECKPOINT: # Resuming from a compaction`，将 25.6 万 Token 的完整对话暴力压缩为仅 2,000~6,000 Token 的摘要，抹除 95% 以上的上下文细节，直接导致后续改代码“失忆漂移”和反复重读文件。

---

## 📊 真实工程 A/B 实测对比（Tauri + Rust + React 全仓找 Bug & 修复）

我们在同一个生产级桌面工程（Rust 后端 + React/TS 前端）上，基于同一 Commit 切出两个独立 Git Worktree 分支，让同一模型（`Gemini 4 Hydrogen High`）执行完全相同的全仓 Bug 排查、代码修复与构建验证任务：

| 对比维度 | 对照组 (原生常规模式) | 实验组 (启用 `agy-tokless`) | 真实节省 / 提升 |
| :--- | :--- | :--- | :--- |
| **总 Token 吞吐 (`input + cache_read + output`)** | 21,410,381 (2,141 万) | **10,029,592 (1,003 万)** | **🔥 净省 53.2% (-1,138 万 Tokens)** |
| **累计 Cache Read（滚雪球缓存消耗）** | 20,858,589 (2,086 万) | **9,627,700 (963 万)** | **🔥 净省 53.8% (-1,123 万 Tokens)** |
| **累计 Input Tokens（新增输入）** | 494,886 | **352,020** | **省 28.9%** |
| **模型调用次数（Planner Invocations）** | 64 次 | **42 次** | **少调 34.4%** |
| **总执行步数（Steps）** | 220 步 | **150 步** | **少走 31.8% 弯路** |
| **`read_file` 调用次数（全量盲读次数）** | 79 次（含 3 次全量盲读） | **51 次（0 次盲读）** | **文件读取减少 35.4%** |
| **峰值上下文水位（Peak Context）** | 439,830 Tokens | **323,344 Tokens** | **峰值降低 26.5%（远离压缩线）** |
| **定位首个 Bug 动手修改耗时** | 227 秒（第 115 步） | **196 秒（第 81 步）** | **提速 31 秒 / 少花 34 步** |
| **检出并修复的真实硬核 Bug 数** | 7 个（全部编译通过） | **7 个（全部编译通过）** | **0 质量损耗（并发细节更深）** |

👉 完整实测报告见：[benchmarks/real-world-bugfix-case.md](./benchmarks/real-world-bugfix-case.md) 与静态骨架基准测试 [benchmarks/static-skeleton-benchmark.md](./benchmarks/static-skeleton-benchmark.md)。

---

## 🛠️ 三大核心组件（纯 Node.js 标准库 · 零原生编译依赖）

### 1. `repo-skeleton` — 毫秒级代码语法骨架提取器
不读函数体实现，只提取 `.js/.ts/.tsx/.py/.go/.rs/.md` 等文件的类名、函数签名、结构体与 **`[L起-L止]` 精确行号范围**，单文件省流 **85%~97%**。

```bash
# 扫描整个源码目录（自动排除 node_modules/.git/dist/target），一步生成全局行号地图
node ./tools/repo-skeleton/cli.js ./src --depth 3

# 提取单个大文件的函数签名与 [L起-L止] 行号
node ./tools/repo-skeleton/cli.js ./src/App.tsx
```

### 2. `agy-audit` — 0 Token 本地账单与 256K 压缩透视仪
直接解析本地 `.gemini/antigravity/brain/<id>/.system_generated/logs/transcript_full.jsonl`：

```bash
# 1. 解剖单个会话（支持短 ID 前缀）：查看 Top 5 烧钱步骤、峰值水位与 256K CHECKPOINT 压缩次数
node ./tools/agy-audit/cli.js session <会话ID前缀>

# 2. 优化前后两个会话的量化账单对比表
node ./tools/agy-audit/cli.js compare <优化前ID> <优化后ID>

# 3. 诊断单个项目的 AGENTS.md 与 .agents/skills 肥胖度
node ./tools/agy-audit/cli.js project <项目目录路径>
```

### 3. `PreToolUse` 防盲读护栏插件（`plugin.json` + `hooks.json`）
本仓库根目录本身就是一个标准的 **Antigravity 原生插件**：
- **硬钩子拦截（`scripts/read-guard-hook.js`）**：当 AI 试图不传 `StartLine`/`EndLine` 直接全量读取超过 200 行的代码文件时，钩子自动拦截并当场返回该文件的 `[L起-L止]` 语法骨架，引导 AI 按行号精准读取。
- **配套省流规则与技能**：内置 [`rules/AGENTS.md`](./rules/AGENTS.md)、[`skills/code-skeleton`](./skills/code-skeleton/SKILL.md) 与 [`skills/token-audit`](./skills/token-audit/SKILL.md)。

---

## 🙏 灵感来源与开源致谢 (Acknowledgments)

本仓库旨在围绕 **Google Antigravity** 的原生插件、钩子（`hooks.json`）与本地会话日志（`transcript_full.jsonl`）体系，提供一套零编译依赖、开箱即用的省流与账单审计组合方案。

本项目的核心设计思路站在了以下优秀开源项目的肩膀上，特此向原作者们致谢（本仓代码均采用纯 Node.js 标准库针对 Antigravity 独立编写实现）：

- **[HoangP8/tokless](https://github.com/HoangP8/tokless)**：启发了本仓库的命名，以及通过指令（Instructions）+ 生命周期钩子（Hooks）组合拦截无效上下文膨胀的核心思路。
- **[ILoveMyJay/repocontext](https://github.com/ILoveMyJay/repocontext)** 与 **[pdavis68/RepoMapper](https://github.com/pdavis68/RepoMapper)**：启发了“先提取带行号的紧凑代码语法骨架地图，再按行号精准读取局部代码”的探索期降耗策略。
- **[ooples/token-optimizer-mcp](https://github.com/ooples/token-optimizer-mcp)**：启发了针对工具调用输出体积与会话级 Token 消耗进行量化追踪与优化的思路。

---

## ⭐ 支持与持续更新计划 (Star & Roadmap)

如果这个小工具切实帮你在保证代码质量的前提下省下了宝贵的 Antigravity 额度、避开了 256K 自动压缩失忆的坑，**欢迎在右上角点个 ⭐ Star 支持一下！**

我们正在持续深挖 Antigravity 的底层机制，后续还会围绕「保质量、砍废话」持续更新：
- [ ] **终端刷屏噪音智能修剪**：针对 `run_command` 产生的冗长构建/测试输出进行头尾保留与错误聚焦裁剪；
- [ ] **256K 临界前无损交接单（Auto-Handoff）**：在上下文逼近 220K 时自动提炼高保真进度快照，彻底告别后台有损压缩漂移；
- [ ] **项目级 `AGENTS.md` / `SKILL.md` 自动脱水器**：一键识别并拆分项目内臃肿的常驻提示词。

欢迎提 Issue 交流你的省流实战数据，或关注作者技术手记公众号 **【织歌AI笔记】** 获取最新更新记录。

---

## 📄 License
[MIT](./LICENSE)
