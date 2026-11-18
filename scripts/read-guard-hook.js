#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const GUARDED_CODE_EXTS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.cs',
  '.vue',
  '.svelte',
]);

function allow() {
  process.stdout.write('{"decision":"allow"}\n');
}

function deny(reason) {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason }) + '\n');
}

function loadSkeletonGenerator() {
  const localLib = path.resolve(__dirname, '../tools/repo-skeleton/lib/skeleton.js');
  return require(localLib).generateFileSkeleton;
}

function getMaxLinesThreshold() {
  const raw = process.env.AGY_READ_MAX_LINES;
  if (!raw) return 200;
  const parsed = parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 200;
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

async function main() {
  try {
    const rawInput = await readStdin();
    if (!rawInput || !rawInput.trim()) {
      return allow();
    }

    const payload = JSON.parse(rawInput);
    const toolCall = payload && payload.toolCall ? payload.toolCall : payload;
    const toolName = toolCall && (toolCall.name || toolCall.tool_name);

    if (toolName !== 'read_file' && toolName !== 'view_file') {
      return allow();
    }

    const args = (toolCall && (toolCall.args || toolCall.tool_input)) || {};
    const targetPath = args.Path ?? args.path ?? args.file_path ?? args.AbsolutePath;

    if (typeof targetPath !== 'string' || !targetPath.trim()) {
      return allow();
    }

    const resolvedPath = path.resolve(targetPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!GUARDED_CODE_EXTS.has(ext)) {
      return allow();
    }

    const startLine = args.StartLine ?? args.startLine ?? args.start_line;
    const endLine = args.EndLine ?? args.endLine ?? args.end_line;
    const hasStart = startLine !== undefined && startLine !== null && startLine !== '';
    const hasEnd = endLine !== undefined && endLine !== null && endLine !== '';

    // 已明确指定任意行号参数则放行
    if (hasStart || hasEnd) {
      return allow();
    }

    if (!fs.existsSync(resolvedPath)) {
      return allow();
    }
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      return allow();
    }

    const maxLines = getMaxLinesThreshold();
    const generateFileSkeleton = loadSkeletonGenerator();
    const skeleton = generateFileSkeleton(resolvedPath, { includeHeader: false });

    if (skeleton.totalLines <= maxLines) {
      return allow();
    }

    const reason =
      `⚡ [agy-tokless 省流护栏] 目标文件共 ${skeleton.totalLines} 行（超过 ${maxLines} 行全量读取阈值），已拦截盲目全量读取以保护上下文额度。\n` +
      `请根据下方该文件的语法骨架与 [L起-L止] 行号范围，重新调用 read_file 并传入 StartLine 和 EndLine 精准读取所需片段：\n\n` +
      `${skeleton.formatted}`;

    return deny(reason);
  } catch (_) {
    // 任何异常均兜底放行，避免阻塞正常工具流
    return allow();
  }
}

main();
