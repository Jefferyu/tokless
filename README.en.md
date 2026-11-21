# Tokless

[简体中文](./README.md) | English

**Zero-dependency token optimizer for AI coding agents (Google Antigravity, Claude Code, Codex CLI, and extensible via `targets/`).**

`tokless` cuts runaway prompt-cache snowballing without sacrificing code quality by combining sub-100ms `[Lstart-Lend]` AST-like code skeleton navigation, native `PreToolUse` blind-read brakes, MCP-stripped subagents, and 0-token local session billing/compaction audits.

In a controlled A/B bug-hunt and fix benchmark on a production Tauri + Rust + React desktop codebase, `tokless` reduced **total token throughput by 53.2% (-11.38M tokens)**, cut **cumulative Cache Read tokens by 53.8% (-11.23M tokens)**, and finished in **34.4% fewer model turns** while finding and fixing the exact same **7 deep concurrency/logic bugs**.

---

## Quick Install (Zero Dependencies · Node.js `>=18`)

### Option 1: One-Line CLI Setup (Recommended)

Auto-detects and installs into Google Antigravity, Claude Code (`~/.claude`), and Codex CLI (`~/.codex`). When invoked via `npx`, `tokless` automatically switches to file-copy mode so hooks never break after npm cache cleanup:

```bash
npx tokless install
```

Target specific hosts or cleanly uninstall anytime:

```bash
npx tokless install --target agy       # Google Antigravity only
npx tokless install --target claude    # Non-destructively merge into ~/.claude/settings.json + skills
npx tokless install --target codex     # Install ~/.codex/skills/code-skeleton
npx tokless install --target all       # Install across all supported hosts
npx tokless uninstall --target all     # Cleanly remove hooks/skills and restore original settings
```

### Option 2: Paste One Prompt to Your AI Agent

Drop this directly into Antigravity or Claude Code and let the agent wire itself up:

```text
Please run `npx tokless install` to enable tokless (or clone https://github.com/daoif/tokless and run `node install.js`), then verify that the read-guard hook and skills are active.
```

---

## Why `@Codebase` or `repomix` Alone Isn't Enough

A common question from heavy AI coding users: *"My IDE already has `@Codebase` semantic search, or I use `repomix`. Why does my 5-hour / weekly quota still burn out so fast?"*

- **`@Codebase` is a search engine; `tokless` is a blind-read brake.** Semantic search tells the agent *which file* looks relevant, but it does not stop the agent from lazily calling `read_file` / `Read` without line numbers and dumping a 1,500-line file straight into context.
- **`repomix` is a full-repo packer for web chat.** Packing an entire repo is great for browser chat UIs without local file tools, but inside a multi-turn CLI/IDE agent loop it front-loads tens of thousands of tokens from turn 1.
- **The Cache Read Snowball:** In multi-step agent loops, `Cumulative Cache Read ≈ Average Context Size × Model Turns`. Dumping 30K tokens of irrelevant code on step 3 across a 50-turn task charges you 47 times—over **1.4M wasted Cache Read tokens** from a single lazy read.
- **Compaction Thresholds:** Generation-3 models commonly trigger forced context compaction around **256K tokens** (`CHECKPOINT: # Resuming from a compaction`, collapsing context into a lossy summary), while Generation-4 models have been observed running past 440K without compacting (widely estimated around **512K**). Regardless of where the ceiling sits, keeping per-turn context lean and cutting redundant turns directly determines how fast your quota drains.

`tokless` works alongside `@Codebase`: once the agent knows which directory or file to inspect, `tokless` generates `[Lstart-Lend]` function/class maps in ~80ms with zero pre-indexing, and its `PreToolUse` hook blocks un-sliced reads over 200 lines (returning the file's skeleton inline so the agent immediately re-reads the exact line range).

---

## Real-World Benchmark (Tauri + Rust + React Bug Hunt & Fix)

Two isolated Git worktrees from the same commit (`3908815`), running the exact same model (`Gemini 4 Hydrogen High`) and prompt:

| Metric | Baseline (Default Agent) | With `tokless` | Delta |
| :--- | :--- | :--- | :--- |
| **Total Tokens (`input + cache_read + output`)** | 21,410,381 | **10,029,592** | **-53.2% (-11.38M)** |
| **Cumulative Cache Read Tokens** | 20,858,589 | **9,627,700** | **-53.8% (-11.23M)** |
| **Cumulative Input Tokens** | 494,886 | **352,020** | **-28.9%** |
| **Model Invocations (Turns)** | 64 | **42** | **-34.4%** |
| **Total Execution Steps** | 220 | **150** | **-31.8%** |
| **`read_file` Calls (Full Blind Reads)** | 79 (3 blind reads) | **51 (0 blind reads)** | **-35.4%** |
| **Peak Context Watermark** | 439,830 tokens | **323,344 tokens** | **-26.5%** |
| **Time to First Code Edit** | 227s (Step 115) | **196s (Step 81)** | **31s faster / -34 steps** |
| **Real Bugs Found & Fixed (Build Verified)** | 7 | **7** | **Zero quality loss** |

Full reports: [benchmarks/real-world-bugfix-case.md](./benchmarks/real-world-bugfix-case.md) and [benchmarks/static-skeleton-benchmark.md](./benchmarks/static-skeleton-benchmark.md).

---

## Core CLI & Host Capabilities

| Host Agent | `tokless skeleton` | `PreToolUse` Blind-Read Guard | Lean Subagents (`inheritMcp: false`) | `tokless audit` Billing & MCP Tax |
| :--- | :---: | :---: | :---: | :---: |
| **Google Antigravity** | Native Skill + CLI | Native `hooks.json` (`read_file` / `view_file`) | `tokless-coder` / `tokless-reviewer` | `transcript_full.jsonl` + MCP tax |
| **Claude Code** | `~/.claude/skills` + CLI | Merged `~/.claude/settings.json` (`Read`) | — | — |
| **Codex CLI** | `~/.codex/skills` + CLI | — | — | — |

```bash
# 1. Generate compact [Lstart-Lend] AST-like signatures for a directory or large file
npx tokless skeleton ./src --depth 2
npx tokless skeleton ./src/App.tsx --json

# 2. Audit Antigravity session token bills, cache cliffs, compaction checkpoints, and MCP tax (0 LLM tokens)
npx tokless audit session <session-id-prefix>
npx tokless audit compare <before-id> <after-id>
npx tokless audit project <project-dir>
```

> **Guardrail Philosophy:** `read-guard-hook.js` only intercepts blind full-file reads (`> 200` lines, configurable via `TOKLESS_READ_MAX_LINES`) and fake `1..EOF` slices. Once explicit line numbers are supplied, any function span—whether 50 or 500 lines—is allowed in a single read so agents never waste extra turns reading fragments.

---

## Programmatic Node.js API

`tokless` exports clean CommonJS modules (`tokless`, `tokless/skeleton`, `tokless/read-guard`, `tokless/audit`) for in-process agent harnesses and custom tooling with zero child-process overhead:

```js
const {
  generateSkeleton,
  evaluateReadGuard,
  analyzeSession,
  auditProject,
} = require('tokless');

// Extract [Lstart-Lend] map for a file or directory
const skel = generateSkeleton('./src', { maxDepth: 2 });
console.log(skel.formatted);

// Evaluate Antigravity or Claude Code PreToolUse payloads in memory
const verdict = evaluateReadGuard({
  tool_name: 'Read',
  tool_input: { file_path: './src/large-module.ts' },
});
// => { decision: 'deny' | 'allow', reason?: string, host: 'claude' | 'antigravity' }
```

---

## Contributing New Agent Targets (`targets/`)

Host integrations live as self-contained adapters under [`targets/`](./targets/):

- [`targets/antigravity.js`](./targets/antigravity.js)
- [`targets/claude-code.js`](./targets/claude-code.js)
- [`targets/codex.js`](./targets/codex.js)

Pull requests adding adapters for **Cursor, Windsurf, Cline, Roo Code, OpenCode, GitHub Copilot**, or expanding language parsers in `tools/repo-skeleton` are warmly welcome. Simply add a single-file adapter, register it in [`targets/index.js`](./targets/index.js), and run:

```bash
npm test
```

---

## Acknowledgments

Built from scratch on the Node.js standard library. Special thanks to:

- **Contributors**: [@PXY000](https://github.com/PXY000) for cross-platform PowerShell skill templates, absolute Node binary resolution in hooks, path traversal guards, and regression tests.
- **Open-Source Inspiration**: [HoangP8/tokless](https://github.com/HoangP8/tokless), [ILoveMyJay/repocontext](https://github.com/ILoveMyJay/repocontext), [pdavis68/RepoMapper](https://github.com/pdavis68/RepoMapper), and [ooples/token-optimizer-mcp](https://github.com/ooples/token-optimizer-mcp).

## License

[MIT](./LICENSE)
