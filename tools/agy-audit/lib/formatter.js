'use strict';

function fmtNum(n) {
  return (n ?? 0).toLocaleString('en-US');
}

function fmtBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined) return '-';
  if (seconds <= 0) return '< 1s';
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
  const {
    meta,
    stats,
    slowestSteps = [],
    mcpAudit,
    turnDeltas = [],
    checkpoints = [],
    cacheCliffs = [],
    toolBreakdown,
    topBloats
  } = report;
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
  lines.push(`| **\`read_file\` 读取模式** | 总计 **${fmtNum(stats.readTotalCount)}** 次（盲读 **${fmtNum(stats.blindReadCount)}** / 按行 **${fmtNum(stats.rangedReadCount)}**） | 无行号全量盲读 vs 带 \`StartLine\`/\`EndLine\` 精准读取 |`);

  if (mcpAudit) {
    let mcpBadge = `✅ **0** 个外部 MCP（已净身 / 无全局继承）`;
    if (mcpAudit.mountedCount > 0) {
      const srvList = mcpAudit.servers
        .map(s => `\`${s.name}\` (${s.callCount > 0 ? `调用 ${s.callCount} 次` : '0 调用空载'})`)
        .join(', ');
      mcpBadge = `${mcpAudit.unusedServerNames.length > 0 ? '⚠️' : '🔌'} 挂载 **${mcpAudit.mountedCount}** 个: ${srvList}`;
    } else if (!mcpAudit.detectedFromSessionDb) {
      mcpBadge = `**0** 次外部 MCP 调用 *(纯日志模式)*`;
    }
    lines.push(`| **实际挂载外部 MCP 服务** | ${mcpBadge} | 前缀: ${mcpAudit.prefixes.length > 0 ? mcpAudit.prefixes.map(p => `\`${p}\``).join(', ') : '无'} |`);
  }

  lines.push(`| **工具输入 (参数) 总量** | ${fmtNum(stats.totalToolInputChars)} 字符 (${fmtBytes(stats.totalToolInputBytes)}) | 估算 **${fmtNum(stats.totalToolInputEstTokens)}** Token (\`ceil(chars/3.5)\`) |`);
  lines.push(`| **工具输出 (上下文注入) 总量** | ${fmtNum(stats.totalToolOutputChars)} 字符 (${fmtBytes(stats.totalToolOutputBytes)}) | 估算 **${fmtNum(stats.totalToolOutputEstTokens)}** Token (\`ceil(chars/3.5)\`) |`);

  if (stats.hasUsageMetrics) {
    lines.push(`| **首步冷启动底座 Input** | **${fmtNum(stats.coldStartInputTokens)}** | 第 1 步加载规则、技能描述、内置工具与 MCP Schema |`);
    lines.push(`| **实测 Input Tokens** | **${fmtNum(stats.totalInputTokens)}** | 统计自 ${stats.usageFieldSteps} 次模型调用 |`);
    lines.push(`| **实测 Cache Read Tokens** | **${fmtNum(stats.totalCacheReadTokens)}** | 历史上下文缓存重复计费滚雪球命中量 |`);
    lines.push(`| **实测缓存命中率** | **${stats.cacheHitRatePct}%**（预热后 **${stats.postWarmupCacheHitRatePct}%**） | \`cache_read / (input + cache_read)\` |`);
    const cliffBadge = stats.cacheCliffCount > 0
      ? `⚠️ 检出 **${stats.cacheCliffCount}** 次断层（重算浪费 ~**${fmtNum(stats.cacheRebilledTokens)}** Input）`
      : `✅ **0** 次断层`;
    lines.push(`| **Prefix Cache 断层告警** | ${cliffBadge} | 检测连续步骤间 \`cache_read\` 骤降且 \`input\` 暴涨 |`);
    lines.push(`| **实测 Output Tokens** | **${fmtNum(stats.totalOutputTokens)}** | 模型生成输出 Token |`);
    lines.push(`| **总 Token 吞吐** | **${fmtNum(stats.totalThroughputTokens)}** | \`input + cache_read + output\` |`);
    lines.push(`| **峰值上下文水位** | **${fmtNum(stats.peakContextTokens)}**（三代 ~256K 占 **${stats.peakContextPct256k}%** / 四代推测 ~512K 占 **${stats.peakContextPct512k ?? Number(((stats.peakContextTokens / 512000) * 100).toFixed(1))}%**） | Step ${stats.peakContextStepIndex ?? '-'} 达峰；控水位减轮次是降低累计 Cache Read 的核心 |`);
  } else {
    lines.push(`| **实测 Usage 字段** | *(日志无 usage 字段)* | 以字符估算 Token 为准 |`);
  }
  const cpBadge = stats.compactionCount > 0 ? `⚠️ 触发 **${stats.compactionCount}** 次` : `✅ **0** 次`;
  lines.push(`| **自动压缩 (CHECKPOINT)** | ${cpBadge} | 三代常见约 256K 触发，四代实测 440K 未触发（推测约 512K） |`);
  lines.push('');

  if (stats.hasUsageMetrics) {
    lines.push(`### ⚡ Prefix Cache 命中率与断层诊断`);
    lines.push('');
    lines.push(`- **整体缓存命中率**: **${stats.cacheHitRatePct}%**（剔除首步冷启动后命中率 **${stats.postWarmupCacheHitRatePct}%**，首步底座冷启动 **${fmtNum(stats.coldStartInputTokens)}** Tokens）`);
    if (cacheCliffs.length === 0) {
      lines.push(`- **缓存连续性状态**: ✅ 全程未检出异常 Prefix Cache 断层（历史前缀保持严格追加复用）。`);
    } else {
      lines.push(`- **缓存断层告警**: ⚠️ 共检出 **${cacheCliffs.length}** 次缓存失效断层，估算多花原价 Input **~${fmtNum(stats.cacheRebilledTokens)}** Tokens：`);
      lines.push('');
      lines.push(`| # | 断层步骤 | 间隔时长 | 前步上下文 → 本步 Cache Read | 本步暴涨 Input | 估算重算浪费 | 疑似根因诊断 |`);
      lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
      for (const c of cacheCliffs) {
        const gapStr = c.idleSeconds !== null ? fmtDuration(c.idleSeconds) : '-';
        lines.push(
          `| ${c.index} | Step ${c.prevStepIndex}→${c.stepIndex} | ${gapStr} | ${fmtNum(c.prevContextTokens)} → **${fmtNum(c.currCacheReadTokens)}** (${c.retentionPct}%) | **${fmtNum(c.currInputTokens)}** | ~${fmtNum(c.estRebilledTokens)} | ${escapePipe(c.reason)} |`
        );
      }
      lines.push('');
      lines.push(`- **止血建议**: ① 若闲置超过 1 小时缓存已过期，重开干净新会话带上精简结论往往比在巨型旧上下文里硬唤醒更省钱；② 严禁在对话中途动态篡改顶部常驻规则、系统提示词或增删 MCP 工具（破坏前缀只追加性）。`);
    }
    lines.push('');
  }

  if (checkpoints.length > 0 || stats.hasUsageMetrics) {
    lines.push(`### 🧠 上下文水位与自动压缩诊断`);
    lines.push('');
    if (stats.hasUsageMetrics) {
      const pct512k = stats.peakContextPct512k ?? Number(((stats.peakContextTokens / 512000) * 100).toFixed(1));
      lines.push(`- **峰值上下文**: **${fmtNum(stats.peakContextTokens)}** Tokens（出现在 Step ${stats.peakContextStepIndex ?? '-'}；占三代常见 ~256K 压缩线 **${stats.peakContextPct256k}%**，占四代推测 ~512K 压缩线 **${pct512k}%**）`);
      lines.push(`- **压缩阈值背景**: 三代模型常见在 ~256K 触发历史截断压缩，四代模型实测跑上 440K 仍未触发（推测约 512K）；无论是否触发压缩，控制上下文水位与减少轮次始终是降低累计 \`Cache Read\` 滚雪球的核心。`);
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

  lines.push(`### ⏱️ 最慢步骤 Top 3 (耗时瓶颈)`);
  lines.push('');
  if (slowestSteps.length === 0) {
    lines.push(`*(本会话无工具耗时记录)*`);
  } else {
    lines.push(`| # | Step | 工具 | 目标文件 / 命令摘要 | 步骤总耗时 | 工具纯执行耗时 | 输出体积 |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
    for (const s of slowestSteps) {
      const stepLabel = s.resultStepIndex !== null ? `${s.stepIndex}→${s.resultStepIndex}` : `${s.stepIndex}`;
      const execStr = s.execDurationSec !== null && s.execDurationSec !== undefined ? `${s.execDurationSec}s` : '-';
      lines.push(
        `| ${s.rank} | ${stepLabel} | \`${s.toolName}\` | \`${escapePipe(truncateText(s.target, 56))}\` | **${s.durationSec}s** | ${execStr} | ${fmtBytes(s.outputBytes)} |`
      );
    }
  }
  lines.push('');

  if (mcpAudit) {
    lines.push(`### 🔌 外部 MCP 挂载与继承审计`);
    lines.push('');
    if (mcpAudit.mountedCount === 0) {
      lines.push(
        mcpAudit.detectedFromSessionDb
          ? `- **挂载状态**: ✅ 本会话未挂载任何外部 MCP 服务（\`inheritMcp: false\` 净身已生效或全局未开启）。`
          : `- **挂载状态**: 本会话日志未检出任何外部 MCP 工具调用。`
      );
    } else {
      lines.push(`- **实际挂载外部 MCP 服务 (${mcpAudit.mountedCount} 个)**: ${mcpAudit.servers.map(s => `\`${s.name}\``).join(', ')}（工具前缀: ${mcpAudit.prefixes.map(p => `\`${p}\``).join(', ')}）`);
      if (mcpAudit.unusedServerNames.length > 0) {
        lines.push(`- **空载继承告警**: ⚠️ 检出 **[${mcpAudit.unusedServerNames.join(', ')}]** 全程 **0 次调用**却随每步常驻挂载，累计产生约 **~${fmtNum(mcpAudit.estSessionTaxTokens)}** Token 空载底座税（建议非浏览器会话设 \`inheritMcp: false\`）。`);
      }
      lines.push('');
      lines.push(`| MCP 服务名 | 工具前缀 | 工具规模 (Eager / Lazy) | 实际调用次数 | 估算单步底座税 |`);
      lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
      for (const srv of mcpAudit.servers) {
        const scale = srv.eagerToolCount || srv.lazyToolCount
          ? `${srv.eagerToolCount} / ${srv.lazyToolCount}`
          : (srv.invokedTools.length > 0 ? `已调: ${srv.invokedTools.slice(0, 3).join(', ')}` : '-');
        lines.push(
          `| \`${srv.name}\` | \`${srv.prefix}\` | ${scale} | **${srv.callCount}** | ~${fmtNum(srv.estTokensPerStep)} |`
        );
      }
    }
    lines.push('');
  }

  if (stats.hasUsageMetrics && turnDeltas.length > 0) {
    lines.push(`### 📈 每轮上下文净增波动与缓存命中率`);
    lines.push('');
    lines.push(`- **单轮净增极值**: 最高单轮净增 **${fmtDelta(stats.maxTurnNetContextDeltaTokens)}** Tokens | 平均每轮净增 **${fmtDelta(stats.avgTurnNetContextDeltaTokens)}** Tokens`);
    lines.push('');
    lines.push(`| 轮次 | Step 范围 | 模型响应 / 工具 | 轮末上下文水位 | 本轮上下文净增 | 本轮 Input / Cache Read | 本轮缓存命中率 |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
    const displayTurns = turnDeltas.length > 15
      ? [...turnDeltas.slice(0, 8), null, ...turnDeltas.slice(-6)]
      : turnDeltas;
    for (const t of displayTurns) {
      if (!t) {
        lines.push(`| ... | *(省略中间 ${turnDeltas.length - 14} 轮)* | ... | ... | ... | ... | ... |`);
        continue;
      }
      const stepSpan = t.firstStepIndex !== null ? `${t.firstStepIndex}→${t.lastStepIndex}` : '-';
      const cpNote = t.compactionsInTurn > 0 ? ` *(含压缩)*` : '';
      lines.push(
        `| Turn ${t.turnIndex} | ${stepSpan} | ${t.plannerSteps} 次 / ${t.toolCalls} 次 | ${fmtNum(t.endContextTokens)} | **${fmtDelta(t.netContextDeltaTokens)}**${cpNote} | ${fmtNum(t.inputTokens)} / ${fmtNum(t.cacheReadTokens)} | **${t.cacheHitRatePct}%** |`
      );
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
      ['Prefix Cache 命中率 (%)', `${metrics.cacheHitRatePct.before}%`, `${metrics.cacheHitRatePct.after}%`, fmtDelta(metrics.cacheHitRatePct.delta, '%'), '-'],
      ['Prefix Cache 断层次数', fmtNum(metrics.cacheCliffCount.before), fmtNum(metrics.cacheCliffCount.after), fmtDelta(metrics.cacheCliffCount.delta), fmtPct(metrics.cacheCliffCount.savedPct)],
      ['累计 Output Tokens', fmtNum(metrics.totalOutputTokens.before), fmtNum(metrics.totalOutputTokens.after), fmtDelta(metrics.totalOutputTokens.delta), fmtPct(metrics.totalOutputTokens.savedPct)],
      ['总 Token 吞吐 (`input+cache_read+output`)', fmtNum(metrics.totalThroughputTokens.before), fmtNum(metrics.totalThroughputTokens.after), fmtDelta(metrics.totalThroughputTokens.delta), fmtPct(metrics.totalThroughputTokens.savedPct)],
      [
        '峰值上下文水位 (占 ~256K 参考线)',
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
  const { projectDir, projectName, thresholds, summary, files, flaggedFiles, mcpAndToolTax } = report;
  const lines = [];

  lines.push(`## 🩺 项目规则、Skill 与 MCP 底座体检: ${projectName}`);
  lines.push(`- **检查目录**: \`${projectDir}\``);
  lines.push(`- **文档诊断阈值**: 常驻规则 (\`AGENTS.md\` / \`GEMINI.md\` / \`rules/*.md\`) > ${thresholds.alwaysOnLineLimit} 行告警；按需技能 (\`SKILL.md\`) > ${thresholds.skillLineLimit} 行告警；单文件高密度体积 > ${fmtBytes(thresholds.alwaysOnByteAdvisory)} (常驻) / > ${fmtBytes(thresholds.skillByteAdvisory)} (技能) 提示精简。`);
  lines.push('');

  lines.push(`### 📊 文档负载总览`);
  lines.push('');
  lines.push(`| 加载模式 | 文件数 | 总行数 | 总字节 | 估算 Token 成本 | 说明 |`);
  lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);
  lines.push(`| **Always-On (每轮常驻)** | ${summary.alwaysOn.count} | ${fmtNum(summary.alwaysOn.lines)} | ${fmtBytes(summary.alwaysOn.bytes)} | **${fmtNum(summary.alwaysOn.estTokens)}** / 轮 | 每轮对话无条件注入上下文 |`);
  lines.push(`| **Progressive Disclosure (按需)** | ${summary.progressiveDisclosure.count} | ${fmtNum(summary.progressiveDisclosure.lines)} | ${fmtBytes(summary.progressiveDisclosure.bytes)} | **${fmtNum(summary.progressiveDisclosure.estTokens)}** (全触发) | 平时仅加载 \`description\`，命中时读正文 |`);
  lines.push('');

  if (files.length === 0) {
    lines.push(`*(该项目目录下未发现 AGENTS.md、GEMINI.md、.agents/rules/*.md 或 .agents/skills/*/SKILL.md)*`);
    lines.push('');
  } else {
    lines.push(`### 📁 规则与技能文件明细`);
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
  }

  if (mcpAndToolTax) {
    lines.push(`### 🔌 MCP 与工具底座空载税估算`);
    lines.push('');
    lines.push(`| 底座构成项 | 数量 / 状态 | 单步固定底座估算 | 30 步会话累计滚雪球 | 说明 |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
    lines.push(
      `| **默认全量内置工具** | 全量工具集 | ~**${fmtNum(mcpAndToolTax.builtinDefaultToolsEstTokensPerStep)}** Token/步 | ~${fmtNum(mcpAndToolTax.builtinDefaultToolsEstTokensPerStep * 30)} | 未指定精简 \`tools\` 时的默认内置工具 Schema |`
    );
    lines.push(
      `| **活跃 MCP Servers** | 启用 **${mcpAndToolTax.enabledMcpCount}** / 共 ${mcpAndToolTax.totalMcpCount} 个 | ~**${fmtNum(mcpAndToolTax.activeMcpEstTokensPerStep)}** Token/步 | ~${fmtNum(mcpAndToolTax.activeMcpEstTokensPerStep * 30)} | 全局 \`~/.gemini/config/mcp_config.json\` 及插件/工作区 |`
    );
    lines.push(
      `| **默认会话合计空载税** | 未净身默认态 | **~${fmtNum(mcpAndToolTax.defaultSessionEstTokensPerStep)}** Token/步 | **~${fmtNum(mcpAndToolTax.est30StepSnowballTokens)}** | 尚未发任何业务代码前每步必背的工具底座 |`
    );
    lines.push('');

    if (mcpAndToolTax.mcpServers.length > 0) {
      lines.push(`#### 已发现的 MCP Server 清单`);
      lines.push('');
      lines.push(`| Server 名称 | 来源范围 | 传输方式 | 状态 | 单步开销估算 |`);
      lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
      for (const s of mcpAndToolTax.mcpServers) {
        const stateLabel = s.enabled ? '🟢 已启用' : '⚪ 已禁用';
        lines.push(
          `| \`${escapePipe(s.name)}\` | \`${escapePipe(s.source)}\` | \`${s.transport}\` | ${stateLabel} | ~${fmtNum(s.estTokensPerStep)} Token |`
        );
      }
      lines.push('');
    }

    if (mcpAndToolTax.agents.length > 0) {
      lines.push(`#### 项目专属 Agent 角色净身状态 (\`agents/*.md\`)`);
      lines.push('');
      lines.push(`| 角色名 | 配置文件 | \`inheritMcp\` | 工具授权 (\`tools\`) | 单步工具+MCP底座 | 相比默认每步立省 |`);
      lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);
      for (const a of mcpAndToolTax.agents) {
        const mcpBadge = a.inheritMcp ? '🟡 `true` (继承)' : '✅ `false` (已净身)';
        const toolsLabel = a.hasExplicitTools
          ? (a.toolCount === 0 ? '`[]` (0工具纯文本)' : `${a.toolCount} 个 (\`${a.tools.join(', ')}\`)`)
          : '*(未显式收敛)*';
        lines.push(
          `| \`${escapePipe(a.name)}\` | \`${escapePipe(a.relativePath)}\` | ${mcpBadge} | ${toolsLabel} | ~**${fmtNum(a.toolAndMcpPerStep)}** Token | **-${fmtNum(a.savedPerStepTokens)}** Token/步 |`
        );
      }
      lines.push('');
    }
  }

  lines.push(`### ✂️ 降维瘦身与净身建议`);
  lines.push('');
  const hasDocFlags = flaggedFiles.length > 0;
  const mcpTips = (mcpAndToolTax && mcpAndToolTax.suggestions) || [];

  if (!hasDocFlags && mcpTips.length === 0) {
    lines.push(`✅ 所有常驻规则、Skill 与角色工具底座均处于精简状态，无需额外瘦身。`);
  } else {
    for (const f of flaggedFiles) {
      lines.push(`- **\`${f.relativePath}\`** (${f.lines} 行 · ${fmtBytes(f.bytes)} · 约 ${fmtNum(f.estTokens)} Token · ${f.loadMode}):`);
      for (const s of f.suggestions) {
        lines.push(`  - ${s}`);
      }
    }
    for (const tip of mcpTips) {
      lines.push(`- **MCP / 工具底座净身**: ${tip}`);
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
