const fs = require('fs');
const path = require('path');
const { estimateTokens } = require('./analyzer');

const ALWAYS_ON_LINE_LIMIT = 100;
const SKILL_LINE_LIMIT = 120;
const ALWAYS_ON_BYTE_ADVISORY = 4000;
const SKILL_BYTE_ADVISORY = 8000;

function findFileCaseInsensitive(dir, targetName) {
  if (!fs.existsSync(dir)) return null;
  const exact = path.join(dir, targetName);
  if (fs.existsSync(exact) && fs.statSync(exact).isFile()) {
    return exact;
  }
  const lower = targetName.toLowerCase();
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const match = entries.find(e => e.isFile() && e.name.toLowerCase() === lower);
  return match ? path.join(dir, match.name) : null;
}

function inspectDocFile(filePath, rootDir, category, loadMode) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.length === 0 ? 0 : content.split(/\r?\n/).length;
  const chars = content.length;
  const bytes = Buffer.byteLength(content, 'utf8');
  const estTokens = estimateTokens(chars);
  const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');

  const isAlwaysOn = loadMode === 'Always-On';
  const lineLimit = isAlwaysOn ? ALWAYS_ON_LINE_LIMIT : SKILL_LINE_LIMIT;
  const byteAdvisory = isAlwaysOn ? ALWAYS_ON_BYTE_ADVISORY : SKILL_BYTE_ADVISORY;

  const exceedsLineLimit = lines > lineLimit;
  const highDensity = bytes > byteAdvisory;

  const suggestions = [];
  if (exceedsLineLimit) {
    if (isAlwaysOn) {
      suggestions.push(
        `行数超标 (${lines} 行 > ${lineLimit} 行上限)：将命令模板、操作步骤与长示例下沉到 .agents/skills/*/SKILL.md（改为按需加载），常驻规则仅保留硬性边界与目录分工，压至 80 行以内。`
      );
    } else {
      suggestions.push(
        `行数超标 (${lines} 行 > ${lineLimit} 行上限)：将长篇参考表、模板代码拆分到同级 references/ 或 scripts/ 目录，SKILL.md 主体只保留触发条件与核心步骤（控制在 100 行以内）。`
      );
    }
  }
  if (highDensity) {
    if (isAlwaysOn) {
      suggestions.push(
        `高密度体积偏大 (${bytes} 字节 / 约 ${estTokens} Token，每轮对话必扣)：建议删减长段落背景描述与内联示例，精简为短句清单，将常驻成本压到 2,000 字节 (~600 Token) 以内。`
      );
    } else {
      suggestions.push(
        `单次触发体积偏大 (${bytes} 字节 / 约 ${estTokens} Token)：建议精简冗长散文描述，将大段规范/示例外置到 references/*.md 按需读取。`
      );
    }
  }

  let status = 'OK';
  if (exceedsLineLimit) {
    status = 'BLOAT';
  } else if (highDensity) {
    status = 'DENSE';
  }

  return {
    relativePath: relPath,
    absolutePath: filePath,
    category,
    loadMode,
    lineLimit,
    lines,
    chars,
    bytes,
    estTokens,
    exceedsLineLimit,
    highDensity,
    status,
    suggestions
  };
}

function auditProject(dirPath) {
  if (!dirPath) {
    throw new Error('Project directory path is required.');
  }
  const rootDir = path.resolve(dirPath);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`Project directory not found: ${rootDir}`);
  }

  const files = [];

  // 1. Root AGENTS.md & GEMINI.md (Always-On)
  const agentsPath = findFileCaseInsensitive(rootDir, 'AGENTS.md');
  if (agentsPath) {
    files.push(inspectDocFile(agentsPath, rootDir, 'AGENTS.md', 'Always-On'));
  }

  const geminiPath = findFileCaseInsensitive(rootDir, 'GEMINI.md');
  if (geminiPath) {
    files.push(inspectDocFile(geminiPath, rootDir, 'GEMINI.md', 'Always-On'));
  }

  // 2. .agents/rules/*.md (Always-On)
  const rulesDir = path.join(rootDir, '.agents', 'rules');
  if (fs.existsSync(rulesDir) && fs.statSync(rulesDir).isDirectory()) {
    const ruleEntries = fs.readdirSync(rulesDir, { withFileTypes: true });
    for (const entry of ruleEntries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        files.push(inspectDocFile(path.join(rulesDir, entry.name), rootDir, 'rule', 'Always-On'));
      }
    }
  }

  // 3. .agents/skills/*/SKILL.md (Progressive Disclosure)
  const skillsDir = path.join(rootDir, '.agents', 'skills');
  if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
    const skillEntries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of skillEntries) {
      if (entry.isDirectory()) {
        const skillFile = findFileCaseInsensitive(path.join(skillsDir, entry.name), 'SKILL.md');
        if (skillFile) {
          files.push(inspectDocFile(skillFile, rootDir, 'skill', 'Progressive Disclosure'));
        }
      }
    }
  }

  const alwaysOnFiles = files.filter(f => f.loadMode === 'Always-On');
  const skillFiles = files.filter(f => f.loadMode === 'Progressive Disclosure');

  const sum = arr => ({
    count: arr.length,
    lines: arr.reduce((s, f) => s + f.lines, 0),
    chars: arr.reduce((s, f) => s + f.chars, 0),
    bytes: arr.reduce((s, f) => s + f.bytes, 0),
    estTokens: arr.reduce((s, f) => s + f.estTokens, 0)
  });

  const flaggedFiles = files.filter(f => f.exceedsLineLimit || f.highDensity);

  return {
    projectDir: rootDir,
    projectName: path.basename(rootDir),
    thresholds: {
      alwaysOnLineLimit: ALWAYS_ON_LINE_LIMIT,
      skillLineLimit: SKILL_LINE_LIMIT,
      alwaysOnByteAdvisory: ALWAYS_ON_BYTE_ADVISORY,
      skillByteAdvisory: SKILL_BYTE_ADVISORY
    },
    summary: {
      totalFiles: files.length,
      alwaysOn: sum(alwaysOnFiles),
      progressiveDisclosure: sum(skillFiles),
      lineViolations: files.filter(f => f.exceedsLineLimit).length,
      densityWarnings: files.filter(f => !f.exceedsLineLimit && f.highDensity).length
    },
    files,
    flaggedFiles
  };
}

module.exports = {
  auditProject
};
