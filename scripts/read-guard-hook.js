#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const READ_GUARD_SCRIPT_PATH = __filename;
const HOOKS_CONFIG_PATH = path.resolve(__dirname, '../hooks.json');
const PLUGIN_MANIFEST_PATH = path.resolve(__dirname, '../plugin.json');

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

function loadSkeletonGenerator() {
  const localLib = path.resolve(__dirname, '../tools/repo-skeleton/lib/skeleton.js');
  return require(localLib).generateFileSkeleton;
}

function getMaxLinesThreshold(overrideVal) {
  if (overrideVal !== undefined && overrideVal !== null) {
    const parsedOverride = parseInt(String(overrideVal), 10);
    if (Number.isInteger(parsedOverride) && parsedOverride > 0) {
      return parsedOverride;
    }
  }
  const raw = process.env.TOKLESS_READ_MAX_LINES || process.env.AGY_READ_MAX_LINES;
  if (!raw) return 200;
  const parsed = parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 200;
}

function parseLineArg(val) {
  if (val === undefined || val === null || val === '') return null;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
}

function isClaudeCodePayload(payload, toolName) {
  if (!payload || typeof payload !== 'object') return false;
  if (toolName === 'Read') return true;
  if (!payload.toolCall && (payload.hook_event_name === 'PreToolUse' || typeof payload.tool_name === 'string')) {
    return toolName !== 'read_file' && toolName !== 'view_file';
  }
  return false;
}

function formatHookResponse(verdict, isClaude) {
  if (isClaude) {
    if (verdict.decision === 'deny') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: verdict.reason,
        },
      };
    }
    return {};
  }
  if (verdict.decision === 'deny') {
    return { decision: 'deny', reason: verdict.reason };
  }
  return { decision: 'allow' };
}

function evaluateReadGuard(payloadOrJson, options = {}) {
  try {
    let payload = payloadOrJson;
    if (typeof payloadOrJson === 'string') {
      if (!payloadOrJson.trim()) {
        return { decision: 'allow', host: 'antigravity' };
      }
      payload = JSON.parse(payloadOrJson);
    }

    if (!payload || typeof payload !== 'object') {
      return { decision: 'allow', host: 'antigravity' };
    }

    const toolCall = payload.toolCall ? payload.toolCall : payload;
    const toolName = toolCall && (toolCall.name || toolCall.tool_name);
    const isClaude = isClaudeCodePayload(payload, toolName);
    const host = isClaude ? 'claude' : 'antigravity';

    if (toolName !== 'read_file' && toolName !== 'view_file' && toolName !== 'Read') {
      return { decision: 'allow', host };
    }

    const args = (toolCall && (toolCall.args || toolCall.tool_input)) || {};
    const targetPath = args.Path ?? args.path ?? args.file_path ?? args.AbsolutePath;

    if (typeof targetPath !== 'string' || !targetPath.trim()) {
      return { decision: 'allow', host };
    }

    const baseCwd = options.cwd || payload.cwd;
    const resolvedPath = baseCwd
      ? path.resolve(baseCwd, targetPath)
      : path.resolve(targetPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!GUARDED_CODE_EXTS.has(ext)) {
      return { decision: 'allow', host };
    }

    if (!fs.existsSync(resolvedPath)) {
      return { decision: 'allow', host };
    }
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      return { decision: 'allow', host };
    }

    let startNum = parseLineArg(args.StartLine ?? args.startLine ?? args.start_line);
    let endNum = parseLineArg(args.EndLine ?? args.endLine ?? args.end_line);
    const offsetNum = parseLineArg(args.offset ?? args.Offset);
    const limitNum = parseLineArg(args.limit ?? args.Limit);

    if (startNum === null && offsetNum !== null) {
      startNum = Math.max(1, offsetNum);
    }
    if (endNum === null && limitNum !== null && limitNum > 0) {
      const baseStart = startNum !== null ? Math.max(1, startNum) : 1;
      endNum = baseStart + limitNum - 1;
    }

    const hasStart = startNum !== null;
    const hasEnd = endNum !== null;
    const maxLines = getMaxLinesThreshold(options.maxLines);

    // 陷阱: 严禁设 300 行死跨度硬拦截（会导致报错重试+拆轮倒贴数十万 Cache Read）；正常局部行号切片直接放行，仅核查盲读与 1~EOF 假切片
    if (hasStart && startNum > 2) {
      return { decision: 'allow', host };
    }

    const generateFileSkeleton = loadSkeletonGenerator();
    const skeleton = generateFileSkeleton(resolvedPath, { includeHeader: false });

    if (skeleton.totalLines <= maxLines) {
      return { decision: 'allow', host };
    }

    const rangeHint = isClaude
      ? '重新调用 Read 并传入目标区间的 offset 与 limit'
      : '重新调用 read_file 并传入目标区间的 StartLine 和 EndLine';

    if (!hasStart && !hasEnd) {
      const reason =
        `[tokless 省流护栏] 目标文件共 ${skeleton.totalLines} 行（超过 ${maxLines} 行全量读取阈值），已拦截盲目全量读取以保护上下文额度。\n` +
        `请根据下方该文件的语法骨架与 [L起-L止] 行号范围，${rangeHint}精准读取所需片段：\n\n` +
        `${skeleton.formatted}`;

      return { decision: 'deny', reason, host };
    }

    const effectiveStart = hasStart ? Math.max(1, startNum) : 1;
    const requestedEnd = hasEnd ? endNum : skeleton.totalLines;

    if (effectiveStart <= 2 && requestedEnd >= skeleton.totalLines - 2) {
      const reason =
        `[tokless 省流护栏] 目标文件共 ${skeleton.totalLines} 行，检测到 L${effectiveStart}-L${requestedEnd} 覆盖全文首尾的假切片全读，已拦截以保护上下文额度。\n` +
        `请根据下方该文件的语法骨架与 [L起-L止] 行号范围，${rangeHint}精准读取真实需要的函数或逻辑块：\n\n` +
        `${skeleton.formatted}`;

      return { decision: 'deny', reason, host };
    }

    return { decision: 'allow', host };
  } catch (_) {
    return { decision: 'allow', host: 'antigravity' };
  }
}

function buildPreToolUseHookConfig(options = {}) {
  const scriptPath = options.scriptPath || READ_GUARD_SCRIPT_PATH;
  const nodeExec = options.nodeExec || 'node';
  const timeout = Number.isInteger(options.timeout) && options.timeout > 0 ? options.timeout : 10;
  return {
    'read-file-guard': {
      enabled: true,
      PreToolUse: [
        {
          matcher: 'read_file|view_file',
          hooks: [
            {
              type: 'command',
              command: `${nodeExec} ${JSON.stringify(scriptPath)}`,
              timeout,
            },
          ],
        },
      ],
    },
  };
}

function buildClaudePreToolUseHookConfig(options = {}) {
  const scriptPath = options.scriptPath || READ_GUARD_SCRIPT_PATH;
  const nodeExec = options.nodeExec || 'node';
  const timeout = Number.isInteger(options.timeout) && options.timeout > 0 ? options.timeout : 10;
  return {
    PreToolUse: [
      {
        matcher: 'Read',
        hooks: [
          {
            type: 'command',
            command: `${nodeExec} ${JSON.stringify(scriptPath)}`,
            timeout,
          },
        ],
      },
    ],
  };
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
  const rawInput = await readStdin();
  const verdict = evaluateReadGuard(rawInput);
  const outObj = formatHookResponse(verdict, verdict.host === 'claude');
  process.stdout.write(JSON.stringify(outObj) + '\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  GUARDED_CODE_EXTS,
  READ_GUARD_SCRIPT_PATH,
  HOOKS_CONFIG_PATH,
  PLUGIN_MANIFEST_PATH,
  scriptPath: READ_GUARD_SCRIPT_PATH,
  hooksConfigPath: HOOKS_CONFIG_PATH,
  pluginManifestPath: PLUGIN_MANIFEST_PATH,
  getMaxLinesThreshold,
  parseLineArg,
  formatHookResponse,
  evaluateReadGuard,
  checkReadGuard: evaluateReadGuard,
  buildPreToolUseHookConfig,
  buildClaudePreToolUseHookConfig,
};
