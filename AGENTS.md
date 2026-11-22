# Tokless Repository Guide for AI Coding Agents (AGENTS.md)

本文件供开发、维护或向 `tokless` 提 PR 的 AI 助手阅读 (`rules/AGENTS.md` 为用户项目省流规则模板，勿混淆)。

## 1. 项目定位

`tokless` 是面向通用 AI 编程 Agent (Antigravity, Claude Code, Codex, Cursor, Windsurf, Cline, Roo Code, Trae, OpenCode, GitHub Copilot 等) 的 **纯 Node.js 标准库 (`>=18`) 零第三方依赖** Token 节约与上下文治理开源库。

## 2. 目录职责边界

- `tools/repo-skeleton/` & `lib/skeleton.js`: 多语言类名/函数签名与 `[L起-L止]` 行号骨架提取器 (兼容 `repo-skeleton`)，含 `lib/core/` 词法/括号平衡核心与 `lib/langs/<lang>/` 按语言目录惰性解析器。
- `scripts/read-guard-hook.js` & `lib/read-guard.js`: 可扩展 `PreToolUse` 防盲读钩子 (拦截无行号盲读 >200 行源码及 `1~EOF` 假切片并内联返回骨架；明确行号切片放行，禁设死板单次行数上限)。
- `targets/`: 单文件宿主挂载层 (`index.js` 注册表、`shared.js` 跨平台拷贝/路径工具、`antigravity.js`、`claude-code.js`、`codex.js`)。
- `rules/AGENTS.md`、`skills/*`、`agents/*`: 用户省流规则模板、POSIX/PowerShell 双端技能文档与 Antigravity `inheritMcp: false` 净身角色。
- `tools/agy-audit/` & `lib/audit.js`: 通用 `audit project` 规则密度/MCP 底座税体检，及 Antigravity 会话账单、Prefix Cache 断层与压缩节点审计。
- `bin/tokless.js`、`install.js`、`index.js`: 统一 CLI (`install` / `uninstall` / `skeleton` / `audit`) 与 CommonJS `exports` (`.`, `./skeleton`, `./read-guard`, `./audit`)。
- `tests/run-all.js` & `tests/langs/*.test.js`: 自动发现 `tests/**/*.test.js` 的回归入口与多语言单测。

## 3. 核心工程红线

1. **100% 零外部依赖**: 仅用 Node.js `>=18` 内置模块，严禁在 `package.json` 添加第三方 `dependencies`，保障 `npx tokless install` 秒装即用。
2. **先看骨架再精读**: 修改本仓 >200 行文件前先跑 `node ./bin/tokless.js skeleton <path>` 按行号读取，且本文档须保持 `< 3.9 KB`。
3. **跨平台与无损合并**: 钩子须经 `resolveNodeBinary()` 写入 Node 绝对路径 (兼容无 `PATH` 的 GUI 宿主)；`_npx` 临时目录走实体拷贝防软链悬空；宿主配置须无损合并，100% 保留原有设置与其他 Hooks。
4. **开源纯净度铁律**: 严禁混入本机用户名、主目录/盘符绝对路径、私有项目词或 Emoji。

## 4. 新增宿主适配与语言扩展契约

- **宿主适配 (`targets/<agent>.js`)**: 参考 `targets/{claude-code,shared}.js` 导出 `{ id, aliases, label, detect(options), install(options), uninstall(options) }` (经 `resolveHomeDir(options)` 支持沙箱注入，禁写死 `os.homedir()`)；若支持读前钩子则在 `scripts/read-guard-hook.js` 扩展并保持 `evaluateReadGuard` 纯函数可测；注册至 `targets/index.js` (`TARGET_ADAPTERS`)，同步双语 README 并在 `tests/verify-tokless.js` 用隔离 `HOME/USERPROFILE` 补安装、幂等重装、钩子拦截与干净卸载单测。
- **语言解析 (`tools/repo-skeleton/lib/langs/<lang>/`)**: 所有语言一视同仁按 `langs/<lang>/index.js` 独立目录管理后缀，导出 `{ id, extensions, parse(lines, ext, options) }` 并在 `lib/core/registry.js` (`LANG_DIR_TO_EXTS`) 注册 (扫到对应后缀惰性加载)；修复漏检或新增语言须在 `tests/langs/<lang>.test.js` 补复现单测 (`tests/run-all.js` 自动纳入)。

## 5. 提交与发版门禁

PR 或发版前须通过 `npm test` 与 `npm pack --dry-run`。发包时，因 NPM 短期登录态过期后 `PUT` 会报误导性 `404 Not Found`，须先预检登录态 (本地私有脚本可放已 `.gitignore` 的 `AGENTS.local.md`)：

- POSIX: `(npm whoami || npm login) && npm publish --access public`
- PowerShell: `if (!(npm whoami 2>$null)) { npm login }; npm publish --access public`
