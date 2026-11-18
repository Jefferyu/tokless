#!/usr/bin/env node

const { analyzeSession } = require('./lib/analyzer');
const { compareSessions } = require('./lib/compare');
const { auditProject } = require('./lib/project');
const {
  formatSessionMarkdown,
  formatCompareMarkdown,
  formatProjectMarkdown
} = require('./lib/formatter');

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[key] = argv[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

function printHelp() {
  console.log(`
Antigravity 本地账单体检与前后对比工具 (agy-audit CLI · 0 Token 运行)

使用说明:
  node cli.js session <id-or-prefix> [--json]
    解剖单个反重力会话日志，统计轮次、步数、实测 Token、估算注入 Token，并揪出 Top 5 烧钱步骤。

  node cli.js compare <id_before> <id_after> [--json]
    对比两个会话的量化指标与节省比例 (%)，输出 Markdown 对比表。

  node cli.js project <dirPath> [--json]
    检查单个热点项目的 AGENTS.md / GEMINI.md / .agents/rules/*.md / .agents/skills/*/SKILL.md 肥胖度并给出瘦身建议。

示例:
  node tools/agy-audit/cli.js session 3e4efc2c
  node tools/agy-audit/cli.js compare 3e4efc2c e966d1b6
  node tools/agy-audit/cli.js project ./my-project
`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const { flags, positionals } = parseArgs(argv);
  const cmd = (positionals[0] || '').toLowerCase();

  try {
    if (cmd === 'session') {
      const id = positionals[1];
      if (!id) {
        console.error('❌ 请提供会话 ID 或短前缀，例如: node cli.js session 3e4efc2c');
        process.exit(1);
      }
      const report = analyzeSession(id);
      if (flags.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatSessionMarkdown(report));
      }
    } else if (cmd === 'compare') {
      const idBefore = positionals[1];
      const idAfter = positionals[2];
      if (!idBefore || !idAfter) {
        console.error('❌ 请提供两个会话 ID 进行对比，例如: node cli.js compare <before> <after>');
        process.exit(1);
      }
      const cmp = compareSessions(idBefore, idAfter);
      if (flags.json) {
        console.log(JSON.stringify(cmp, null, 2));
      } else {
        console.log(formatCompareMarkdown(cmp));
      }
    } else if (cmd === 'project') {
      const dirPath = positionals[1];
      if (!dirPath) {
        console.error('❌ 请提供单个目标项目路径，例如: node cli.js project ./my-project');
        process.exit(1);
      }
      const report = auditProject(dirPath);
      if (flags.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatProjectMarkdown(report));
      }
    } else {
      console.error(`❌ 未知子命令 "${cmd}"。支持: session, compare, project`);
      printHelp();
      process.exit(1);
    }
  } catch (err) {
    console.error(`❌ 执行失败: ${err.message}`);
    process.exit(1);
  }
}

main();
