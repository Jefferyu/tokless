const fs = require('fs');
const { resolveConversationId, getTranscriptInfo, getConversationMeta } = require('./paths');

const COMPACTION_THRESHOLD_256K = 256000;

function estimateTokens(chars) {
  if (!chars || chars <= 0) return 0;
  return Math.ceil(chars / 3.5);
}

function byteLength(str) {
  if (!str) return 0;
  return Buffer.byteLength(str, 'utf8');
}

function isReadFileTool(name) {
  return name === 'read_file' || name === 'view_file';
}

function hasLineRange(args) {
  if (!args || typeof args !== 'object') return false;
  return (
    args.StartLine !== undefined ||
    args.EndLine !== undefined ||
    args.start_line !== undefined ||
    args.end_line !== undefined
  );
}

function formatToolTarget(name, args) {
  if (!args || typeof args !== 'object') return '';
  if (args.Path || args.path) {
    const p = args.Path || args.path;
    const start = args.StartLine ?? args.start_line;
    const end = args.EndLine ?? args.end_line;
    if (start !== undefined || end !== undefined) {
      return `${p} [L${start ?? 1}-L${end ?? 'EOF'}]`;
    }
    return p;
  }
  if (args.CommandLine || args.command) {
    return args.CommandLine || args.command;
  }
  if (args.query) {
    return `query: ${args.query}`;
  }
  if (args.Prompt) {
    return `prompt: ${String(args.Prompt).slice(0, 80)}`;
  }
  if (args.Description) {
    return String(args.Description).slice(0, 80);
  }
  const raw = JSON.stringify(args);
  return raw.length > 100 ? raw.slice(0, 100) + '...' : raw;
}

function extractTokenUsage(step) {
  const usage = step.usage && typeof step.usage === 'object' ? step.usage : step;
  const input =
    typeof usage.input_tokens === 'number'
      ? usage.input_tokens
      : typeof usage.prompt_tokens === 'number'
        ? usage.prompt_tokens
        : 0;
  const output =
    typeof usage.output_tokens === 'number'
      ? usage.output_tokens
      : typeof usage.completion_tokens === 'number'
        ? usage.completion_tokens
        : 0;
  const cacheRead =
    typeof usage.cache_read_tokens === 'number'
      ? usage.cache_read_tokens
      : typeof usage.cached_tokens === 'number'
        ? usage.cached_tokens
        : 0;
  const hasUsage =
    typeof usage.input_tokens === 'number' ||
    typeof usage.output_tokens === 'number' ||
    typeof usage.cache_read_tokens === 'number' ||
    typeof usage.prompt_tokens === 'number';
  return { input, output, cacheRead, hasUsage };
}

function analyzeSession(idOrPrefix) {
  const conversationId = resolveConversationId(idOrPrefix);
  const info = getTranscriptInfo(conversationId);
  if (!info) {
    throw new Error(`Transcript file not found for conversation: ${idOrPrefix}`);
  }

  const rawContent = fs.readFileSync(info.filePath, 'utf8');
  const rawLines = rawContent.split('\n').filter(l => l.trim().length > 0);
  const steps = [];
  for (const line of rawLines) {
    try {
      steps.push(JSON.parse(line));
    } catch {
      // Skip malformed line
    }
  }

  let totalTurns = 0;
  let plannerSteps = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let usageFieldSteps = 0;
  let peakContextTokens = 0;
  let peakContextStepIndex = null;
  let lastStepContextTokens = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;

  const checkpoints = [];
  let pendingCheckpoint = null;
  const toolCalls = [];
  const pendingQueue = [];
  const toolBreakdown = {};

  // Precompute prefix sums of USER_INPUT and PLANNER_RESPONSE indices so we know remaining turns/calls after any step
  const turnsSeenAtPos = new Array(steps.length).fill(0);
  const plannersSeenAtPos = new Array(steps.length).fill(0);
  let tAcc = 0;
  let pAcc = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].type === 'USER_INPUT') tAcc++;
    if (steps[i].type === 'PLANNER_RESPONSE') pAcc++;
    turnsSeenAtPos[i] = tAcc;
    plannersSeenAtPos[i] = pAcc;
  }
  const grandTotalTurns = tAcc;
  const grandTotalPlanners = pAcc;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!firstTimestamp && step.created_at) firstTimestamp = step.created_at;
    if (step.created_at) lastTimestamp = step.created_at;

    const stepIndex = step.step_index ?? i;
    const usage = extractTokenUsage(step);
    const stepContextTokens = usage.input + usage.cacheRead;

    if (usage.hasUsage) {
      usageFieldSteps++;
      totalInputTokens += usage.input;
      totalOutputTokens += usage.output;
      totalCacheReadTokens += usage.cacheRead;

      if (stepContextTokens > 0) {
        if (stepContextTokens > peakContextTokens) {
          peakContextTokens = stepContextTokens;
          peakContextStepIndex = stepIndex;
        }
        if (pendingCheckpoint && step.type !== 'CHECKPOINT') {
          pendingCheckpoint.postCompactionTokens = stepContextTokens;
          pendingCheckpoint = null;
        }
        lastStepContextTokens = stepContextTokens;
      }
    }

    if (step.type === 'USER_INPUT') {
      totalTurns++;
    } else if (step.type === 'CHECKPOINT') {
      const contentStr = typeof step.content === 'string' ? step.content : '';
      const preTokens = stepContextTokens > 0 ? stepContextTokens : lastStepContextTokens;
      const cpRecord = {
        index: checkpoints.length + 1,
        stepIndex,
        createdAt: step.created_at || null,
        preCompactionTokens: preTokens,
        postCompactionTokens: null,
        summaryChars: contentStr.length,
        summaryEstTokens: estimateTokens(contentStr.length)
      };
      checkpoints.push(cpRecord);
      pendingCheckpoint = cpRecord;
    } else if (step.type === 'PLANNER_RESPONSE') {
      plannerSteps++;

      if (Array.isArray(step.tool_calls)) {
        for (const tc of step.tool_calls) {
          const name = tc.name || tc.toolName || 'unknown_tool';
          const args = tc.args || tc.parameters || {};
          const argsStr = JSON.stringify(args);
          const inputChars = argsStr.length;
          const inputBytes = byteLength(argsStr);
          const inputEstTokens = estimateTokens(inputChars);

          const isRead = isReadFileTool(name);
          const ranged = isRead ? hasLineRange(args) : false;

          const record = {
            callPos: i,
            resultPos: i,
            stepIndex: step.step_index ?? i,
            resultStepIndex: null,
            turnIndex: Math.max(1, totalTurns),
            toolName: name,
            target: formatToolTarget(name, args),
            isReadFile: isRead,
            isBlindRead: isRead && !ranged,
            isRangedRead: isRead && ranged,
            inputChars,
            inputBytes,
            inputEstTokens,
            outputChars: 0,
            outputBytes: 0,
            outputEstTokens: 0
          };

          toolCalls.push(record);
          pendingQueue.push(record);

          if (!toolBreakdown[name]) {
            toolBreakdown[name] = {
              count: 0,
              inputChars: 0,
              inputBytes: 0,
              inputEstTokens: 0,
              outputChars: 0,
              outputBytes: 0,
              outputEstTokens: 0
            };
          }
          toolBreakdown[name].count++;
          toolBreakdown[name].inputChars += inputChars;
          toolBreakdown[name].inputBytes += inputBytes;
          toolBreakdown[name].inputEstTokens += inputEstTokens;
        }
      }
    } else if (step.type === 'GENERIC') {
      const rec = pendingQueue.shift();
      if (rec) {
        const outStr = typeof step.content === 'string' ? step.content : JSON.stringify(step.content || '');
        const outChars = outStr.length;
        const outBytes = byteLength(outStr);
        const outEstTokens = estimateTokens(outChars);

        rec.resultPos = i;
        rec.resultStepIndex = step.step_index ?? i;
        rec.outputChars = outChars;
        rec.outputBytes = outBytes;
        rec.outputEstTokens = outEstTokens;

        const bd = toolBreakdown[rec.toolName];
        if (bd) {
          bd.outputChars += outChars;
          bd.outputBytes += outBytes;
          bd.outputEstTokens += outEstTokens;
        }
      }
    }
  }

  let blindReadCount = 0;
  let rangedReadCount = 0;
  let totalToolInputChars = 0;
  let totalToolInputBytes = 0;
  let totalToolOutputChars = 0;
  let totalToolOutputBytes = 0;

  for (const tc of toolCalls) {
    if (tc.isBlindRead) blindReadCount++;
    if (tc.isRangedRead) rangedReadCount++;
    totalToolInputChars += tc.inputChars;
    totalToolInputBytes += tc.inputBytes;
    totalToolOutputChars += tc.outputChars;
    totalToolOutputBytes += tc.outputBytes;

    const refPos = tc.resultPos;
    tc.remainingTurns = Math.max(0, grandTotalTurns - turnsSeenAtPos[refPos]);
    tc.remainingPlannerSteps = Math.max(0, grandTotalPlanners - plannersSeenAtPos[refPos]);
    tc.estSnowballTokens = tc.outputEstTokens * tc.remainingPlannerSteps;
  }

  const sortedByOutput = [...toolCalls].sort((a, b) => b.outputBytes - a.outputBytes || b.outputChars - a.outputChars);
  const topBloats = sortedByOutput.slice(0, 5).map((tc, idx) => ({
    rank: idx + 1,
    stepIndex: tc.stepIndex,
    resultStepIndex: tc.resultStepIndex,
    turnIndex: tc.turnIndex,
    toolName: tc.toolName,
    target: tc.target,
    isReadFile: tc.isReadFile,
    isBlindRead: tc.isBlindRead,
    isRangedRead: tc.isRangedRead,
    inputChars: tc.inputChars,
    inputBytes: tc.inputBytes,
    inputEstTokens: tc.inputEstTokens,
    outputChars: tc.outputChars,
    outputBytes: tc.outputBytes,
    outputEstTokens: tc.outputEstTokens,
    remainingTurns: tc.remainingTurns,
    remainingPlannerSteps: tc.remainingPlannerSteps,
    estSnowballTokens: tc.estSnowballTokens
  }));

  const maxSingleStepOutput = topBloats.length > 0 ? topBloats[0] : null;

  let durationSeconds = 0;
  if (firstTimestamp && lastTimestamp) {
    const startMs = new Date(firstTimestamp).getTime();
    const endMs = new Date(lastTimestamp).getTime();
    if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
      durationSeconds = Math.round((endMs - startMs) / 1000);
    }
  }

  const dbMeta = getConversationMeta(conversationId);
  const meta = {
    conversationId,
    shortId: conversationId.slice(0, 8),
    title: (dbMeta && dbMeta.title) || 'Untitled Session',
    workspace: (dbMeta && dbMeta.workspace) || '',
    logType: info.logType,
    logFile: info.filePath,
    logBytes: info.bytes,
    firstTimestamp,
    lastTimestamp,
    durationSec: durationSeconds,
    durationSeconds
  };

  const peakContextPct256k = peakContextTokens > 0
    ? Number(((peakContextTokens / COMPACTION_THRESHOLD_256K) * 100).toFixed(1))
    : 0;
  const totalThroughputTokens = totalInputTokens + totalCacheReadTokens + totalOutputTokens;

  return {
    meta,
    stats: {
      durationSec: durationSeconds,
      totalTurns,
      totalSteps: steps.length,
      plannerSteps,
      totalToolCalls: toolCalls.length,
      blindReadCount,
      rangedReadCount,
      readTotalCount: blindReadCount + rangedReadCount,
      hasUsageMetrics: usageFieldSteps > 0,
      usageFieldSteps,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalEffectiveTokens: totalInputTokens + totalOutputTokens,
      totalBilledContextTokens: totalInputTokens + totalCacheReadTokens,
      totalThroughputTokens,
      peakContextTokens,
      peakContextPct256k,
      peakContextStepIndex,
      compactionThresholdTokens: COMPACTION_THRESHOLD_256K,
      compactionCount: checkpoints.length,
      totalToolInputChars,
      totalToolInputBytes,
      totalToolInputEstTokens: estimateTokens(totalToolInputChars),
      totalToolOutputChars,
      totalToolOutputBytes,
      totalToolOutputEstTokens: estimateTokens(totalToolOutputChars),
      maxSingleStepOutput
    },
    checkpoints,
    toolBreakdown,
    topBloats
  };
}

module.exports = {
  analyzeSession,
  estimateTokens,
  COMPACTION_THRESHOLD_256K
};
