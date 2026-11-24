#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const pkg = require('../package.json');
const { parseCliArgs, runInstall, runUninstall } = require('../install');

const REPO_ROOT = path.resolve(__dirname, '..');

function printHelp() {
  console.log(`tokless v${pkg.version} - AST codebase skeletonizer, optional blind-read guard & session token auditor

Usage:
  tokless install [--target agy|claude|codex|all] [--with-guard] [--copy]
  tokless uninstall [--target agy|claude|codex|all]
  tokless skeleton <file-or-dir> [--depth <N>] [--exclude <dirs>] [--map] [--json]
  tokless audit <list|session|compare|project> [args...] [--json]
  tokless --version | -v
  tokless --help | -h

Install Options:
  --with-guard   Opt-in PreToolUse hook (>800-line unsliced blind-read skeleton navigator; disabled by default)
  --copy         Copy files instead of linking (auto-enabled in _npx / node_modules)

Targets:
  agy      Antigravity (~/.gemini/config/plugins/agy-tokless)
  claude   Claude Code (~/.claude/tokless + skills; optional settings.json PreToolUse Read hook via --with-guard)
  codex    Codex CLI (~/.codex/skills/code-skeleton)
  all      Install/uninstall across all supported targets
  (omit)   Auto-install Antigravity + any detected ~/.claude or ~/.codex host`);
}

function forwardSubtool(relScriptPath, subArgs) {
  const scriptPath = path.join(REPO_ROOT, relScriptPath);
  const res = spawnSync(process.execPath, [scriptPath, ...subArgs], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(res.status !== null ? res.status : 1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    printHelp();
    return;
  }

  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
    console.log(pkg.version);
    return;
  }

  const subcmd = argv[0];
  const rest = argv.slice(1);

  if (subcmd === 'install') {
    const parsed = parseCliArgs(rest);
    if (parsed.help) {
      printHelp();
      return;
    }
    try {
      runInstall({
        sourceDir: REPO_ROOT,
        target: parsed.target,
        copy: parsed.copy,
        withGuard: parsed.withGuard,
        mode: 'auto',
      });
    } catch (err) {
      console.error(`[tokless] ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (subcmd === 'uninstall') {
    const parsed = parseCliArgs(rest);
    if (parsed.help) {
      printHelp();
      return;
    }
    try {
      runUninstall({
        target: parsed.target || 'all',
        mode: 'auto',
      });
    } catch (err) {
      console.error(`[tokless] ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (subcmd === 'skeleton' || subcmd === 'skel') {
    forwardSubtool('tools/repo-skeleton/cli.js', rest);
    return;
  }

  if (subcmd === 'audit') {
    forwardSubtool('tools/agy-audit/cli.js', rest);
    return;
  }

  console.error(`[tokless] Unknown command: "${subcmd}". Run "tokless --help" for usage.`);
  process.exit(1);
}

main();
