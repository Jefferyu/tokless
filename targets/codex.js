'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveHomeDir,
  shouldForceCopy,
  removePathSafe,
  linkOrCopyDir,
} = require('./shared');

function rewriteCodexSkillDoc(rawSkillMd, cliPath) {
  const unixCli = cliPath.replace(/\\/g, '/');
  const winCli = cliPath.replace(/\//g, '\\');
  return rawSkillMd
    .replace(/\$HOME\/\.gemini\/config\/plugins\/agy-tokless\/tools\/repo-skeleton\/cli\.js/g, unixCli)
    .replace(/\$env:USERPROFILE\\\.gemini\\config\\plugins\\agy-tokless\\tools\\repo-skeleton\\cli\.js/g, winCli);
}

function detect(options = {}) {
  const homeDir = resolveHomeDir(options);
  return fs.existsSync(path.join(homeDir, '.codex'));
}

function install(options = {}) {
  const sourceDir = options.sourceDir || path.resolve(__dirname, '..');
  const homeDir = resolveHomeDir(options);
  const forceCopy = shouldForceCopy(sourceDir, options.copy);

  const codexRoot = path.join(homeDir, '.codex');
  const skillDestDir = path.join(codexRoot, 'skills', 'code-skeleton');
  const toolsDestDir = path.join(skillDestDir, 'tools');

  removePathSafe(skillDestDir);
  fs.mkdirSync(skillDestDir, { recursive: true });

  const mode = linkOrCopyDir(
    path.join(sourceDir, 'tools'),
    toolsDestDir,
    forceCopy
  );

  const srcSkillFile = path.join(sourceDir, 'skills', 'code-skeleton', 'SKILL.md');
  const skeletonCliPath = path.join(toolsDestDir, 'repo-skeleton', 'cli.js');
  if (fs.existsSync(srcSkillFile)) {
    const rawSkill = fs.readFileSync(srcSkillFile, 'utf8');
    fs.writeFileSync(
      path.join(skillDestDir, 'SKILL.md'),
      rewriteCodexSkillDoc(rawSkill, skeletonCliPath),
      'utf8'
    );
  }

  if (!options.silent) {
    console.log('');
    console.log(`[tokless:codex] 已安装 code-skeleton 技能至 ${skillDestDir} (${mode})`);
  }

  return {
    target: 'codex',
    skillDestDir,
    mode,
  };
}

function uninstall(options = {}) {
  const homeDir = resolveHomeDir(options);
  const skillDestDir = path.join(homeDir, '.codex', 'skills', 'code-skeleton');
  let existed = fs.existsSync(skillDestDir);
  if (!existed) {
    try {
      fs.lstatSync(skillDestDir);
      existed = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  if (!existed) {
    if (!options.silent) {
      console.log(`[tokless:codex] 未检测到已安装的 Codex 技能（${skillDestDir} 不存在）。`);
    }
    return { target: 'codex', skillDestDir, removed: false };
  }

  removePathSafe(skillDestDir);
  if (!options.silent) {
    console.log(`[tokless:codex] 已卸载 Codex 技能（已清理 ${skillDestDir}）。`);
  }
  return { target: 'codex', skillDestDir, removed: true };
}

module.exports = {
  id: 'codex',
  aliases: ['codex', 'codex-cli'],
  label: 'Codex CLI (~/.codex/skills/code-skeleton)',
  detect,
  install,
  uninstall,
};
