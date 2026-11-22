#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  generateFileSkeleton,
  scanDirectorySkeleton,
  formatDirectorySkeleton,
  formatDirectoryMap,
  generateRepoMap,
} = require('./lib/skeleton');

function printUsage() {
  console.log(`repo-skeleton - 极速提取代码文件或目录的紧凑语法骨架与精确行号范围

用法:
  node cli.js <文件路径> [--map] [--json]
  node cli.js <目录路径> [--depth <深度, 默认 2>] [--map] [--json]

选项:
  --depth <N>   目录扫描最大深度（常规默认: 2，--map 默认: 8；自动排除 node_modules/.git/dist/build/exports/.next/target/__pycache__）
  --map         极简全仓文件体量地图模式（仅输出相对路径、总行数与总字数，不展开函数签名）
  --json        输出结构化 JSON
  -h, --help    显示帮助信息`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let target = null;
  let depth = null;
  let map = false;
  let json = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--map') {
      map = true;
    } else if (arg === '--depth') {
      const next = args[i + 1];
      if (next !== undefined && /^\d+$/.test(next)) {
        depth = parseInt(next, 10);
        i++;
      }
    } else if (arg.startsWith('--depth=')) {
      const val = arg.slice('--depth='.length);
      if (/^\d+$/.test(val)) {
        depth = parseInt(val, 10);
      }
    } else if (!arg.startsWith('-') && !target) {
      target = arg;
    }
  }

  const effectiveDepth = depth !== null ? depth : (map ? 8 : 2);
  return { target, depth: effectiveDepth, map, json, help };
}

function main() {
  const { target, depth, map, json, help } = parseArgs(process.argv);

  if (help || !target) {
    printUsage();
    process.exit(help ? 0 : 1);
  }

  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) {
    console.error(`错误: 目标路径不存在: ${resolved}`);
    process.exit(1);
  }

  const stat = fs.statSync(resolved);
  const t0 = performance.now();

  if (map) {
    const result = generateRepoMap(resolved, { depth });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(result.text);
    return;
  }

  if (stat.isFile()) {
    const result = generateFileSkeleton(resolved, { includeHeader: false });
    const elapsedMs = Number((performance.now() - t0).toFixed(2));

    if (json) {
      console.log(JSON.stringify({ mode: 'file', elapsedMs, ...result }, null, 2));
      return;
    }

    const charCount = result.charCount ?? result.rawChars ?? 0;
    console.log(`文件: ${result.filePath}`);
    console.log(
      `统计: 总行数 ${result.totalLines} 行 · ${charCount.toLocaleString('en-US')} 字 | 全文估算 ${result.rawTokens} tokens → 骨架估算 ${result.skeletonTokens} tokens (节省 ${result.savedPercent}%, 耗时 ${elapsedMs}ms)`
    );
    console.log('---');
    console.log(result.formatted);
    return;
  }

  if (stat.isDirectory()) {
    const result = scanDirectorySkeleton(resolved, { depth });
    const elapsedMs = Number((performance.now() - t0).toFixed(2));

    if (json) {
      console.log(JSON.stringify({ mode: 'directory', elapsedMs, ...result }, null, 2));
      return;
    }

    console.log(formatDirectorySkeleton(result, { elapsedMs }));
    return;
  }

  console.error(`错误: 不支持的目标类型: ${resolved}`);
  process.exit(1);
}

main();
