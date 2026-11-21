# Tokless Repository Guide for AI Coding Agents (AGENTS.md)

本文件供参与开发、维护或向 `tokless` 提交 PR 的 AI 编程助手阅读（注：`rules/AGENTS.md` 是随包分发给终端用户项目的省流规则模板，勿混淆职责）。

## 1. 项目定位

`tokless` 是面向通用 AI 编程 Agent（旨在兼容支持尽可能多的主流与开源工具，如 Antigravity、Claude Code、Codex、Cursor、Windsurf、Cline、Roo Code、Trae、OpenCode、GitHub Copilot 等）的 **纯 Node.js 标准库（`>=18`）零第三方依赖** Token 节约与上下文治理开源项目。

## 2. 目录职责边界

- `tools/repo-skeleton/` & `lib/skeleton.js`：跨端通用的毫秒级多语言类名/函数签名与 `[L起-L止]` 行号骨架提取器（兼容 `repo-skeleton`）。
- `scripts/read-guard-hook.js` & `lib/read-guard.js`：可扩展 `PreToolUse` 防盲读钩子核心（拦截无行号盲读 >200 行源码及 `1~EOF` 假切片并内联返回骨架；明确行号切片一律放行，严禁设死板单次行数跨度硬上限）。
- `targets/`：单文件宿主挂载扩展层（`index.js` 注册表、`shared.js` 跨平台拷贝/路径工具、`antigravity.js`、`claude-code.js`、`codex.js`）。
- `rules/AGENTS.md`、`skills/*`、`agents/*`：分发给终端用户的省流规则模板、POSIX/PowerShell 双端技能文档与 Antigravity `inheritMcp: false` 净身角色。
- `tools/agy-audit/` & `lib/audit.js`：通用的 `audit project` 规则密度/MCP 底座税体检，及 Antigravity 会话账单、Prefix Cache 断层与压缩节点审计。
- `bin/tokless.js`、`install.js`、`index.js`：统一 CLI（`install` / `uninstall` / `skeleton` / `audit`）与标准 CommonJS `exports`（`.`、`./skeleton`、`./read-guard`、`./audit`）。

## 3. 核心工程红线

1. **100% 零外部依赖**：仅使用 Node.js `>=18` 内置模块，严禁在 `package.json` 添加第三方 `dependencies`，保障 `npx tokless install` 秒装即用。
2. **先看骨架再精读**：修改本仓 >200 行文件前，先运行 `node ./bin/tokless.js skeleton <path>` 获取行号区间后按行读取，且本常驻文档自身须保持 `< 3.9 KB`。
3. **跨平台与无损合并**：钩子命令须通过 `resolveNodeBinary()` 写入 Node 绝对路径（兼容无 `PATH` 的 GUI 宿主）；`_npx` 临时目录自动走实体拷贝防软链悬空；宿主配置读写必须无损合并，100% 保留用户原有设置与其他 Hooks。
4. **开源纯净度铁律**：严禁混入个人本机用户名、主目录/本地盘符绝对路径、任何非公开内部项目字眼或 Emoji 图标。

## 4. 新增宿主适配步骤 (`targets/<agent>.js`)

1. 参考 `targets/claude-code.js` 与 `targets/shared.js` 新建单文件适配器，导出 `{ id, aliases, label, detect(options), install(options), uninstall(options) }`（通过 `resolveHomeDir(options)` 支持沙箱注入，严禁写死 `os.homedir()`）。
2. 若目标宿主支持文件读取前拦截钩子，在 `scripts/read-guard-hook.js` 中扩展载荷识别与阻断返回格式，保持 `evaluateReadGuard` 纯函数可测。
3. 在 `targets/index.js` 的 `TARGET_ADAPTERS` 注册新模块，并同步更新 `README.md` 与 `README.en.md` 支持矩阵。
4. 在 `tests/verify-tokless.js` 使用隔离临时 `HOME` / `USERPROFILE` 补齐安装、幂等重装、钩子拦截与干净卸载回归测试。

## 5. 提交与发版门禁

提交 PR 或发版前必须在根目录通过全量自检：

```bash
npm test
npm pack --dry-run
```
