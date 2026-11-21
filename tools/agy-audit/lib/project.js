'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { estimateTokens } = require('./analyzer');

const ALWAYS_ON_LINE_LIMIT = 100;
const SKILL_LINE_LIMIT = 120;
const ALWAYS_ON_BYTE_ADVISORY = 4000;
const SKILL_BYTE_ADVISORY = 8000;

// Baseline per-step schema token estimates
const DEFAULT_BUILTIN_TOOLS_EST_TOKENS = 4200;
const DEFAULT_SUBAGENT_READONLY_EST_TOKENS = 900;
const HEAVY_MCP_EST_TOKENS = 3000;
const STANDARD_MCP_EST_TOKENS = 1500;
const HEAVY_MCP_NAME_RE = /chrome|devtools|playwright|puppeteer|browser|github|gitlab|atlassian|jira|confluence|linear|figma|notion|supabase|postgres|mysql|sqlite|databricks|looker/i;

const KNOWN_TOOL_EST_TOKENS = {
  read_file: 220,
  view_file: 220,
  write_file: 260,
  edit_file: 280,
  run_command: 320,
  manage_task: 220,
  search_web: 160,
  ask_question: 220,
  swarm: 580,
  run_workflow: 360
};

function stripJsonCommentsAndTrailingCommas(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let out = '';
  let inStr = false;
  let quote = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\' && i + 1 < raw.length) {
        out += raw[++i];
      } else if (ch === quote) {
        inStr = false;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < raw.length && raw[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(stripJsonCommentsAndTrailingCommas(raw));
  } catch {
    return null;
  }
}

function parseAgentMarkdown(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const norm = raw.replace(/\r\n/g, '\n');
  let frontmatterText = '';
  let bodyText = norm;

  const fmMatch = norm.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (fmMatch) {
    frontmatterText = fmMatch[1];
    bodyText = fmMatch[2];
  }

  const fm = {};
  if (frontmatterText) {
    const lines = frontmatterText.split('\n');
    let currentListKey = null;
    for (const line of lines) {
      const listItemMatch = line.match(/^\s*-\s+(.+?)\s*$/);
      if (listItemMatch && currentListKey) {
        if (!Array.isArray(fm[currentListKey])) fm[currentListKey] = [];
        fm[currentListKey].push(listItemMatch[1].replace(/^['"]|['"]$/g, '').trim());
        continue;
      }
      const kvMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (!kvMatch) continue;
      const key = kvMatch[1];
      const valRaw = kvMatch[2].trim();
      currentListKey = null;

      if (valRaw === '') {
        currentListKey = key;
        fm[key] = [];
      } else if (valRaw.startsWith('[') && valRaw.endsWith(']')) {
        const inner = valRaw.slice(1, -1).trim();
        fm[key] = inner
          ? inner.split(',').map(s => s.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean)
          : [];
      } else if (valRaw === 'true') {
        fm[key] = true;
      } else if (valRaw === 'false') {
        fm[key] = false;
      } else {
        fm[key] = valRaw.replace(/^['"]|['"]$/g, '');
      }
    }
  }

  return { frontmatter: fm, bodyText };
}

function estimateToolsSchemaTokens(toolsField, isMainAgent) {
  if (Array.isArray(toolsField)) {
    if (toolsField.length === 0) return 0;
    return toolsField.reduce((sum, name) => sum + (KNOWN_TOOL_EST_TOKENS[name] || 240), 0);
  }
  return isMainAgent ? DEFAULT_BUILTIN_TOOLS_EST_TOKENS : DEFAULT_SUBAGENT_READONLY_EST_TOKENS;
}

function collectMcpServersFromFile(filePath, scope, displaySource, outList) {
  const parsed = readJsonSafe(filePath);
  if (!parsed || typeof parsed !== 'object') return;
  const serversMap = parsed.mcpServers && typeof parsed.mcpServers === 'object'
    ? parsed.mcpServers
    : null;
  if (!serversMap) return;

  for (const [serverName, cfg] of Object.entries(serversMap)) {
    if (!cfg || typeof cfg !== 'object') continue;
    const enabled = cfg.disabled !== true;
    const transport = cfg.url || cfg.serverUrl ? 'http' : 'stdio';
    const isHeavy = HEAVY_MCP_NAME_RE.test(serverName) ||
      (typeof cfg.command === 'string' && HEAVY_MCP_NAME_RE.test(cfg.command)) ||
      (Array.isArray(cfg.args) && cfg.args.some(a => HEAVY_MCP_NAME_RE.test(String(a))));
    const tier = isHeavy ? 'heavy' : 'standard';
    const estTokensPerStep = enabled ? (isHeavy ? HEAVY_MCP_EST_TOKENS : STANDARD_MCP_EST_TOKENS) : 0;

    outList.push({
      name: serverName,
      scope,
      source: displaySource,
      transport,
      enabled,
      tier,
      estTokensPerStep
    });
  }
}

function auditMcpAndTools(rootDir, options = {}) {
  const homeDir = options.homeDir ? path.resolve(options.homeDir) : os.homedir();
  const mcpServers = [];

  // 1. Global ~/.gemini/config/mcp_config.json
  const globalMcpPath = path.join(homeDir, '.gemini', 'config', 'mcp_config.json');
  collectMcpServersFromFile(
    globalMcpPath,
    'global',
    '~/.gemini/config/mcp_config.json',
    mcpServers
  );

  // 2. Global enabled plugins ~/.gemini/config/plugins/*/mcp_config.json
  const globalConfig = readJsonSafe(path.join(homeDir, '.gemini', 'config', 'config.json')) || {};
  const pluginStateMap = (globalConfig.plugins && typeof globalConfig.plugins === 'object')
    ? globalConfig.plugins
    : {};
  const pluginsDir = path.join(homeDir, '.gemini', 'config', 'plugins');
  if (fs.existsSync(pluginsDir) && fs.statSync(pluginsDir).isDirectory()) {
    for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const pDir = path.join(pluginsDir, entry.name);
      const manifest = readJsonSafe(path.join(pDir, 'plugin.json'));
      const userOverride = pluginStateMap[entry.name];
      const isEnabled = userOverride && typeof userOverride.enabled === 'boolean'
        ? userOverride.enabled
        : !(manifest && manifest.disabled === true);
      if (!isEnabled) continue;

      collectMcpServersFromFile(
        path.join(pDir, 'mcp_config.json'),
        'plugin',
        `~/.gemini/config/plugins/${entry.name}/mcp_config.json`,
        mcpServers
      );
    }
  }

  // 3. Workspace MCP configs (.mcp.json, .agents/mcp_config.json, .agent/mcp_config.json, plugin root mcp_config.json)
  const workspaceMcpCandidates = [
    { p: path.join(rootDir, '.mcp.json'), label: '.mcp.json' },
    { p: path.join(rootDir, '.agents', 'mcp_config.json'), label: '.agents/mcp_config.json' },
    { p: path.join(rootDir, '.agent', 'mcp_config.json'), label: '.agent/mcp_config.json' }
  ];
  if (fs.existsSync(path.join(rootDir, 'plugin.json'))) {
    workspaceMcpCandidates.push({ p: path.join(rootDir, 'mcp_config.json'), label: 'mcp_config.json' });
  }
  for (const item of workspaceMcpCandidates) {
    collectMcpServersFromFile(item.p, 'workspace', item.label, mcpServers);
  }

  const enabledMcpServers = mcpServers.filter(s => s.enabled);
  const activeMcpEstTokensPerStep = enabledMcpServers.reduce((sum, s) => sum + s.estTokensPerStep, 0);
  const defaultToolAndMcpPerStep = DEFAULT_BUILTIN_TOOLS_EST_TOKENS + activeMcpEstTokensPerStep;
  const est30StepSnowballTokens = defaultToolAndMcpPerStep * 30;

  // 4. Scan project agent definitions (.agents/agents/*.md, .agent/agents/*.md, and plugin agents/*.md)
  const agentDirs = [
    path.join(rootDir, '.agents', 'agents'),
    path.join(rootDir, '.agent', 'agents')
  ];
  if (fs.existsSync(path.join(rootDir, 'plugin.json'))) {
    agentDirs.push(path.join(rootDir, 'agents'));
  }

  const agents = [];
  const seenAgentPaths = new Set();
  for (const aDir of agentDirs) {
    if (!fs.existsSync(aDir) || !fs.statSync(aDir).isDirectory()) continue;
    for (const entry of fs.readdirSync(aDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const fullPath = path.resolve(aDir, entry.name);
      if (seenAgentPaths.has(fullPath)) continue;
      seenAgentPaths.add(fullPath);

      const { frontmatter, bodyText } = parseAgentMarkdown(fullPath);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      const agentName = frontmatter.name || path.basename(entry.name, '.md');
      const inheritMcp = frontmatter.inheritMcp === false ? false : true;
      const isMainAgent = frontmatter.mainAgent !== false;
      const hasExplicitTools = Array.isArray(frontmatter.tools);
      const toolsList = hasExplicitTools ? frontmatter.tools : null;
      const toolCount = hasExplicitTools ? toolsList.length : null;
      const toolsEstTokens = estimateToolsSchemaTokens(toolsList, isMainAgent);
      const mcpEstTokens = inheritMcp ? activeMcpEstTokensPerStep : 0;
      const promptEstTokens = estimateTokens(bodyText.trim().length);
      const toolAndMcpPerStep = toolsEstTokens + mcpEstTokens;
      const savedPerStepTokens = Math.max(0, defaultToolAndMcpPerStep - toolAndMcpPerStep);

      agents.push({
        name: agentName,
        relativePath: relPath,
        inheritMcp,
        mainAgent: Boolean(frontmatter.mainAgent),
        subagent: frontmatter.subagent !== false,
        hasExplicitTools,
        tools: toolsList,
        toolCount,
        toolsEstTokens,
        mcpEstTokens,
        promptEstTokens,
        toolAndMcpPerStep,
        totalPerStepEstTokens: toolAndMcpPerStep + promptEstTokens,
        savedPerStepTokens
      });
    }
  }

  const slimAgents = agents.filter(a => !a.inheritMcp);
  const mcpInheritingAgents = agents.filter(a => a.inheritMcp);
  const suggestions = [];

  if (enabledMcpServers.length > 0 && slimAgents.length === 0) {
    suggestions.push(
      `检测到 ${enabledMcpServers.length} 个已启用 MCP Server（每步额外注入约 ${activeMcpEstTokensPerStep.toLocaleString('en-US')} Token，30 步滚雪球约 ${(activeMcpEstTokensPerStep * 30).toLocaleString('en-US')} Token），且当前项目尚未配置净身角色。建议在 .agents/agents/ 下定义 inheritMcp: false 与最小 tools 清单的专属角色（或直接运行 agy --agent tokless-coder / tokless-reviewer）卸除无关 MCP 底座税。`
    );
  } else if (agents.length === 0) {
    suggestions.push(
      `默认全量内置工具底座每步约占 ${DEFAULT_BUILTIN_TOOLS_EST_TOKENS.toLocaleString('en-US')} Token（30 步累计约 ${(DEFAULT_BUILTIN_TOOLS_EST_TOKENS * 30).toLocaleString('en-US')} Cache Read）。高频纯代码子代理建议挂载 inheritMcp: false + tools: [read_file, write_file, edit_file, run_command]（省 ~70% 工具底座），纯文本润色/摘要子代理建议设 tools: []（0 工具底座税）。`
    );
  }

  if (enabledMcpServers.length > 0 && mcpInheritingAgents.length > 0) {
    const names = mcpInheritingAgents.map(a => a.name).join(', ');
    suggestions.push(
      `角色 [${names}] 当前开启或默认继承了 MCP (inheritMcp: true)，每步多付约 ${activeMcpEstTokensPerStep.toLocaleString('en-US')} Token；若该角色无需调用浏览器或外部 MCP 工具，建议显式加上 inheritMcp: false。`
    );
  }

  return {
    builtinDefaultToolsEstTokensPerStep: DEFAULT_BUILTIN_TOOLS_EST_TOKENS,
    totalMcpCount: mcpServers.length,
    enabledMcpCount: enabledMcpServers.length,
    activeMcpEstTokensPerStep,
    defaultSessionEstTokensPerStep: defaultToolAndMcpPerStep,
    est30StepSnowballTokens,
    mcpServers,
    agents,
    suggestions
  };
}

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

function auditProject(dirPath, options = {}) {
  if (!dirPath) {
    throw new Error('Project directory path is required.');
  }
  const rootDir = path.resolve(dirPath);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`Project directory not found: ${rootDir}`);
  }

  const files = [];
  const seenDocPaths = new Set();
  const pushDoc = (filePath, category, loadMode) => {
    const resolved = path.resolve(filePath);
    if (seenDocPaths.has(resolved)) return;
    seenDocPaths.add(resolved);
    files.push(inspectDocFile(resolved, rootDir, category, loadMode));
  };

  // 1. Root AGENTS.md & GEMINI.md (Always-On)
  const agentsPath = findFileCaseInsensitive(rootDir, 'AGENTS.md');
  if (agentsPath) {
    pushDoc(agentsPath, 'AGENTS.md', 'Always-On');
  }

  const geminiPath = findFileCaseInsensitive(rootDir, 'GEMINI.md');
  if (geminiPath) {
    pushDoc(geminiPath, 'GEMINI.md', 'Always-On');
  }

  // 2. .agents/rules/*.md (and plugin rules/*.md if plugin.json exists)
  const rulesDirs = [path.join(rootDir, '.agents', 'rules')];
  if (fs.existsSync(path.join(rootDir, 'plugin.json'))) {
    rulesDirs.push(path.join(rootDir, 'rules'));
  }
  for (const rulesDir of rulesDirs) {
    if (fs.existsSync(rulesDir) && fs.statSync(rulesDir).isDirectory()) {
      for (const entry of fs.readdirSync(rulesDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          pushDoc(path.join(rulesDir, entry.name), 'rule', 'Always-On');
        }
      }
    }
  }

  // 3. .agents/skills/*/SKILL.md (and plugin skills/*/SKILL.md if plugin.json exists)
  const skillsDirs = [path.join(rootDir, '.agents', 'skills')];
  if (fs.existsSync(path.join(rootDir, 'plugin.json'))) {
    skillsDirs.push(path.join(rootDir, 'skills'));
  }
  for (const skillsDir of skillsDirs) {
    if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const skillFile = findFileCaseInsensitive(path.join(skillsDir, entry.name), 'SKILL.md');
          if (skillFile) {
            pushDoc(skillFile, 'skill', 'Progressive Disclosure');
          }
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
  const mcpAndToolTax = auditMcpAndTools(rootDir, options);

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
      densityWarnings: files.filter(f => !f.exceedsLineLimit && f.highDensity).length,
      enabledMcpCount: mcpAndToolTax.enabledMcpCount,
      defaultToolAndMcpPerStepTokens: mcpAndToolTax.defaultSessionEstTokensPerStep,
      agentRoleCount: mcpAndToolTax.agents.length
    },
    files,
    flaggedFiles,
    mcpAndToolTax
  };
}

module.exports = {
  auditProject,
  auditMcpAndTools,
  parseAgentMarkdown
};
