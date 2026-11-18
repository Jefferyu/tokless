function fmtNum(n) {
  return (n ?? 0).toLocaleString('en-US');
}

function fmtBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtDuration(seconds) {
  if (!seconds || seconds <= 0) return '< 1s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function truncateText(str, maxLen = 72) {
  if (!str) return '-';
  const singleLine = String(str).replace(/\r?\n/g, ' ').trim();
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen - 3) + '...';
}

function escapePipe(str) {
  return String(str || '').replace(/\|/g, '\\|');
}

function fmtDurationWithSec(seconds) {
  const sec = seconds ?? 0;
  const mins = (sec / 60).toFixed(1);
  return `${fmtNum(sec)}s (${mins}m)`;
}

function fmtDelta(delta, suffix = '') {
  const d = delta ?? 0;
  const sign = d > 0 ? '+' : '';
  return `${sign}${fmtNum(d)}${suffix}`;
}

function formatSessionMarkdown(report) {
  const { meta, stats, checkpoints = [], toolBreakdown, topBloats } = report;
  const lines = [];

  lines.push(`## 🔍 会话账单体检: ${meta.title} (\`${meta.shortId}\`)`);
  lines.push(`- **完整 ID**: \`${meta.conversationId}\``);
  if (meta.workspace) lines.push(`- **工作空间**: \`${meta.workspace}\``);
  lines.push(`- **日志来源**: \`${meta.logType}\` (${fmtBytes(meta.logBytes)}) | **耗时**: ${fmtDurationWithSec(stats.durationSec)}`);
  lines.push('');

  lines.push(`### 📊 核心量化指标`);
  lines.push('');
  lines.push(`| 指标 | 数值 | 说明 |`);
  lines.push(`| :--- | :--- | :--- |`);
  lines.push(`| **会话总耗时** | ${fmtDurationWithSec(stats.durationSec)} | 首步至末步 \`created_at\` 差值 |`);
  lines.push(`| **总轮次 / 总步数** | ${fmtNum(stats.totalTurns)} 轮 / ${fmtNum(stats.totalSteps)} 步 | 模型响应 ${fmtNum(stats.plannerSteps)} 次，工具调用 ${fmtNum(stats.totalToolCalls)} 次 |`);
  lines.push(`| **\`read_file\` 读取模式** | 总计 **${fmtNum(stats.readTotalCount)}** 次（盲读 **${fmtNum(stats.blindReadCount)}** / 精准按行 **${fmtNum(stats.rangedReadCount)}**） | 无行号全量盲读 vs 带 \`StartLine\`/\`EndLine\` |`);
  lines.push(`| **工具输入 (参数) 总量** | ${fmtNum(stats.totalToolInputChars)} 字符 (${fmtBytes(stats.totalToolInputBytes)}) | 估算 **${fmtNum(stats.totalToolInputEstTokens)}** Token (\`ceil(chars/3.5)\`) |`);
  lines.push(`| **工具输出 (上下文注入) 总量** | ${fmtNum(stats.totalToolOutputChars)} 字符 (${fmtBytes(stats.totalToolOutputBytes)}) | 估算 **${fmtNum(stats.totalToolOutputEstTokens)}** Token (\`ceil(chars/3.5)\`) |`);

  if (stats.hasUsageMetrics) {
    lines.push(`| **实测 Input Tokens** | **${fmtNum(stats.totalInputTokens)}** | 统计自 ${stats.usageFieldSteps} 次模型调用 |`);
    lines.push(`| **实测 Cache Read Tokens** | **${fmtNum(stats.totalCacheReadTokens)}** | 历史上下文缓存重复计费滚雪球命中量 |`);
    lines.push(`| **实测 Output Tokens** | **${fmtNum(stats.totalOutputTokens)}** | 模型生成输出 Token |`);
    lines.push(`| **总 Token 吞吐** | **${fmtNum(stats.totalThroughputTokens)}** | \`input + cache_read + output\` |`);
    lines.push(`| **峰值上下文水位** | **${fmtNum(stats.peakContextTokens)}** (**${stats.peakContextPct256k}%** / 256K) | Step ${stats.peakContextStepIndex ?? '-'} 达到峰值（红线 256,000） |`);
  } else {
    lines.push(`| **实测 Usage 字段** | *(日志无 usage 字段)* | 以字符估算 Token 为准 |`);
  }
  const cpBadge = stats.compactionCount > 0 ? `⚠️ 触发 **${stats.compactionCount}** 次` : `✅ **0** 次`;
  lines.push(`| **256K 自动压缩 (CHECKPOINT)** | ${cpBadge} | 触发历史截断与摘要压缩次数 |`);
  lines.push('');

  if (checkpoints.length > 0 || stats.hasUsageMetrics) {
    lines.push(`### 🧠 256K 上下文水位与自动压缩诊断`);
    lines.push('');
    if (stats.hasUsageMetrics) {
      lines.push(`- **峰值上下文**: **${fmtNum(stats.peakContextTokens)}** Tokens（占 256,000 自动压缩阈值 **${stats.peakContextPct256k}%**，出现在 Step ${stats.peakContextStepIndex ?? '-'}）`);
    }
    if (checkpoints.length === 0) {
      lines.push(`- **自动压缩状态**: ✅ 全程未触发 \`CHECKPOINT\` 自动压缩（上下文未触及失忆截断）。`);
    } else {
      lines.push(`- **自动压缩触发次数**: ⚠️ 共触发 **${checkpoints.length}** 次 \`CHECKPOINT\`（\`# Resuming from a compaction\`）：`);
      lines.push('');
      lines.push(`| # | 触发 Step | 压缩前上下文 Tokens | 压缩后剩余 Tokens | 压缩摘要估算 |`);
      lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
      for (const cp of checkpoints) {
        const pre = cp.preCompactionTokens > 0 ? fmtNum(cp.preCompactionTokens) : '-';
        const post = cp.postCompactionTokens !== null ? fmtNum(cp.postCompactionTokens) : '-';
        lines.push(`| ${cp.index} | Step ${cp.stepIndex} | ${pre} | ${post} | ~${fmtNum(cp.summaryEstTokens)} (${fmtNum(cp.summaryChars)} chars) |`);
      }
    }
    lines.push('');
  }

  lines.push(`### 🔥 单步上下文塞入 Top 5 烧钱步骤`);
  lines.push('');
  if (topBloats.length === 0) {
    lines.push(`*(本会话无工具调用记录)*`);
  } else {
    lines.push(`| # | Step | 工具 | 目标文件 / 命令 | 塞入字节 / 字符 | 估算 Token | 后续剩余轮次 / 调用 | 估算缓存滚雪球 |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
    for (const b of topBloats) {
      const modeTag = b.isReadFile ? (b.isBlindRead ? ' [盲读]' : ' [分段]') : '';
      const stepLabel = b.resultStepIndex !== null ? `${b.stepIndex}→${b.resultStepIndex}` : `${b.stepIndex}`;
      lines.push(
        `| ${b.rank} | ${stepLabel} | \`${b.toolName}\`${modeTag} | \`${escapePipe(truncateText(b.target, 56))}\` | ${fmtBytes(b.outputBytes)} (${fmtNum(b.outputChars)} chars) | **${fmtNum(b.outputEstTokens)}** | ${b.remainingTurns} 轮 / ${b.remainingPlannerSteps} 次 | ~${fmtNum(b.estSnowballTokens)} |`
      );
    }
  }
  lines.push('');

  const toolsSorted = Object.entries(toolBreakdown).sort((a, b) => b[1].outputBytes - a[1].outputBytes);
  if (toolsSorted.length > 0) {
    lines.push(`### 🛠️ 工具维度分布`);
    lines.push('');
    lines.push(`| 工具名 | 次数 | 传入估算 Token | 注入输出字节 | 注入估算 Token |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
    for (const [name, bd] of toolsSorted) {
      lines.push(`| \`${name}\` | ${bd.count} | ${fmtNum(bd.inputEstTokens)} | ${fmtBytes(bd.outputBytes)} | ${fmtNum(bd.outputEstTokens)} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function fmtPct(savedPct, invertMeaning = false) {
  if (savedPct === null || savedPct === undefined) return '-';
  if (savedPct > 0) return invertMeaning ? `-${savedPct}%` : `**-${savedPct}%** (省)`;
  if (savedPct < 0) return `+${Math.abs(savedPct)}%`;
  return '0%';
}

function formatCompareMarkdown(cmp) {
  const { before, after, metrics } = cmp;
  const lines = [];

  lines.push(`## ⚖️ 会话优化前后对比报告`);
  lines.push(`- **对照组 (Baseline)**: \`${before.meta.shortId}\` — ${before.meta.title} (${fmtDurationWithSec(before.stats.durationSec)})`);
  lines.push(`- **实验组 (Tokless)**: \`${after.meta.shortId}\` — ${after.meta.title} (${fmtDurationWithSec(after.stats.durationSec)})`);
  lines.push('');

  lines.push(`| 对比维度 | 对照组 (${before.meta.shortId}) | 实验组 (${after.meta.shortId}) | 差值 | 节省比例 |`);
  lines.push(`| :--- | :--- | :--- | :--- | :--- |`);

  const rows = [
    [
      '总耗时 (秒 / 分钟)',
      fmtDurationWithSec(metrics.durationSec.before),
      fmtDurationWithSec(metrics.durationSec.after),
      fmtDelta(metrics.durationSec.delta, 's'),
      fmtPct(metrics.durationSec.savedPct)
    ],
    ['总轮次 (Turns)', fmtNum(metrics.totalTurns.before), fmtNum(metrics.totalTurns.after), fmtDelta(metrics.totalTurns.delta), fmtPct(metrics.totalTurns.savedPct)],
    ['总步数 (Steps)', fmtNum(metrics.totalSteps.before), fmtNum(metrics.totalSteps.after), fmtDelta(metrics.totalSteps.delta), fmtPct(metrics.totalSteps.savedPct)],
    ['模型调用次数 (Planner)', fmtNum(metrics.plannerSteps.before), fmtNum(metrics.plannerSteps.after), fmtDelta(metrics.plannerSteps.delta), fmtPct(metrics.plannerSteps.savedPct)],
    ['工具调用总次数', fmtNum(metrics.totalToolCalls.before), fmtNum(metrics.totalToolCalls.after), fmtDelta(metrics.totalToolCalls.delta), fmtPct(metrics.totalToolCalls.savedPct)],
    ['`read_file` 总次数', fmtNum(metrics.readTotalCount.before), fmtNum(metrics.readTotalCount.after), fmtDelta(metrics.readTotalCount.delta), fmtPct(metrics.readTotalCount.savedPct)],
    ['├─ 无行号全量盲读', fmtNum(metrics.blindReadCount.before), fmtNum(metrics.blindReadCount.after), fmtDelta(metrics.blindReadCount.delta), fmtPct(metrics.blindReadCount.savedPct)],
    ['└─ 带 `StartLine`/`EndLine` 精准读取', fmtNum(metrics.rangedReadCount.before), fmtNum(metrics.rangedReadCount.after), fmtDelta(metrics.rangedReadCount.delta), fmtPct(metrics.rangedReadCount.savedPct, true)],
    ['工具注入总字符数', fmtNum(metrics.totalToolOutputChars.before), fmtNum(metrics.totalToolOutputChars.after), fmtDelta(metrics.totalToolOutputChars.delta), fmtPct(metrics.totalToolOutputChars.savedPct)],
    ['工具注入估算新增 Token', fmtNum(metrics.totalToolOutputEstTokens.before), fmtNum(metrics.totalToolOutputEstTokens.after), fmtDelta(metrics.totalToolOutputEstTokens.delta), fmtPct(metrics.totalToolOutputEstTokens.savedPct)],
    [
      '最大单步膨胀 (字符 / Est Token)',
      `${fmtNum(metrics.maxStepBloatChars.before)} / ${fmtNum(metrics.maxStepBloatEstTokens.before)}`,
      `${fmtNum(metrics.maxStepBloatChars.after)} / ${fmtNum(metrics.maxStepBloatEstTokens.after)}`,
      fmtDelta(metrics.maxStepBloatEstTokens.delta),
      fmtPct(metrics.maxStepBloatEstTokens.savedPct)
    ]
  ];

  if (before.stats.hasUsageMetrics || after.stats.hasUsageMetrics) {
    rows.push(
      ['累计 Input Tokens', fmtNum(metrics.totalInputTokens.before), fmtNum(metrics.totalInputTokens.after), fmtDelta(metrics.totalInputTokens.delta), fmtPct(metrics.totalInputTokens.savedPct)],
      ['累计 Cache Read Tokens (滚雪球)', fmtNum(metrics.totalCacheReadTokens.before), fmtNum(metrics.totalCacheReadTokens.after), fmtDelta(metrics.totalCacheReadTokens.delta), fmtPct(metrics.totalCacheReadTokens.savedPct)],
      ['累计 Output Tokens', fmtNum(metrics.totalOutputTokens.before), fmtNum(metrics.totalOutputTokens.after), fmtDelta(metrics.totalOutputTokens.delta), fmtPct(metrics.totalOutputTokens.savedPct)],
      ['总 Token 吞吐 (`input+cache_read+output`)', fmtNum(metrics.totalThroughputTokens.before), fmtNum(metrics.totalThroughputTokens.after), fmtDelta(metrics.totalThroughputTokens.delta), fmtPct(metrics.totalThroughputTokens.savedPct)],
      [
        '峰值上下文水位 (占 256K 红线)',
        `${fmtNum(metrics.peakContextTokens.before)} (${metrics.peakContextPct256k.before}%)`,
        `${fmtNum(metrics.peakContextTokens.after)} (${metrics.peakContextPct256k.after}%)`,
        fmtDelta(metrics.peakContextTokens.delta),
        fmtPct(metrics.peakContextTokens.savedPct)
      ]
    );
  }

  rows.push([
    '自动压缩 (Compaction) 触发次数',
    fmtNum(metrics.compactionCount.before),
    fmtNum(metrics.compactionCount.after),
    fmtDelta(metrics.compactionCount.delta),
    fmtPct(metrics.compactionCount.savedPct)
  ]);

  for (const r of rows) {
    lines.push(`| ${r.join(' | ')} |`);
  }
  lines.push('');

  return lines.join('\n');
}

function formatProjectMarkdown(report) {
  const { projectDir, projectName, thresholds, summary, files, flaggedFiles } = report;
  const lines = [];

  lines.push(`## 🩺 单项目规则与 Skill 肥胖度体检: ${projectName}`);
  lines.push(`- **检查目录**: \`${projectDir}\` (仅扫描当前目标项目，不越界全盘扫描)`);
  lines.push(`- **诊断阈值**: 常驻规则 (\`AGENTS.md\` / \`GEMINI.md\` / \`.agents/rules/*.md\`) > ${thresholds.alwaysOnLineLimit} 行告警；按需技能 (\`SKILL.md\`) > ${thresholds.skillLineLimit} 行告警；单文件高密度体积 > ${fmtBytes(thresholds.alwaysOnByteAdvisory)} (常驻) / > ${fmtBytes(thresholds.skillByteAdvisory)} (技能) 提示精简。`);
  lines.push('');

  lines.push(`### 📊 负载总览`);
  lines.push('');
  lines.push(`| 加载模式 | 文件数 | 总行数 | 总字节 | 估算 Token 成本 | 说明 |`);
  lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);
  lines.push(`| **Always-On (每轮常驻)** | ${summary.alwaysOn.count} | ${fmtNum(summary.alwaysOn.lines)} | ${fmtBytes(summary.alwaysOn.bytes)} | **${fmtNum(summary.alwaysOn.estTokens)}** / 轮 | 每轮对话无条件注入上下文 |`);
  lines.push(`| **Progressive Disclosure (按需)** | ${summary.progressiveDisclosure.count} | ${fmtNum(summary.progressiveDisclosure.lines)} | ${fmtBytes(summary.progressiveDisclosure.bytes)} | **${fmtNum(summary.progressiveDisclosure.estTokens)}** (全触发) | 平时仅加载 \`description\`，命中时读正文 |`);
  lines.push('');

  if (files.length === 0) {
    lines.push(`*(该项目目录下未发现 AGENTS.md、GEMINI.md、.agents/rules/*.md 或 .agents/skills/*/SKILL.md)*`);
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`### 📁 文件明细`);
  lines.push('');
  lines.push(`| 文件路径 | 类别 | 加载模式 | 行数 | 字节数 | 估算 Token | 状态 |`);
  lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
  for (const f of files) {
    let badge = '✅ 正常';
    if (f.status === 'BLOAT') badge = `🔴 超标 (>${f.lineLimit}行)`;
    else if (f.status === 'DENSE') badge = `🟡 高密度偏胖`;
    lines.push(`| \`${f.relativePath}\` | ${f.category} | ${f.loadMode} | ${f.lines} | ${fmtBytes(f.bytes)} | ${fmtNum(f.estTokens)} | ${badge} |`);
  }
  lines.push('');

  lines.push(`### ✂️ 降维瘦身建议`);
  lines.push('');
  if (flaggedFiles.length === 0) {
    lines.push(`✅ 所有常驻规则与 Skill 均控制在合理体积内，无需瘦身。`);
  } else {
    for (const f of flaggedFiles) {
      lines.push(`- **\`${f.relativePath}\`** (${f.lines} 行 · ${fmtBytes(f.bytes)} · 约 ${fmtNum(f.estTokens)} Token · ${f.loadMode}):`);
      for (const s of f.suggestions) {
        lines.push(`  - ${s}`);
      }
    }
  }
  lines.push('');

  return lines.join('\n');
}

module.exports = {
  formatSessionMarkdown,
  formatCompareMarkdown,
  formatProjectMarkdown
};
