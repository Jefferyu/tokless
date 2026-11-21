'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveHomeDir,
  shouldForceCopy,
  removePathSafe,
  linkOrCopyDir,
  resolveNodeBinary,
  quoteCommandBinary,
} = require('./shared');

const PLUGIN_NAME = 'agy-tokless';
const ROOT_FILES = ['plugin.json', 'hooks.json', 'package.json', 'index.js', 'README.md', 'LICENSE'];
const LINK_DIRS = ['rules', 'skills', 'agents', 'scripts', 'tools', 'lib'];

function installHooksJson(srcFile, destFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
    const quotedNode = quoteCommandBinary(resolveNodeBinary());
    for (const hookCfg of Object.values(parsed)) {
      if (!hookCfg || typeof hookCfg !== 'object') continue;
      for (const groups of Object.values(hookCfg)) {
        if (!Array.isArray(groups)) continue;
        for (const group of groups) {
          const handlers = Array.isArray(group && group.hooks) ? group.hooks : [group];
          for (const handler of handlers) {
            if (handler && typeof handler.command === 'string' && /^node\s+/.test(handler.command)) {
              handler.command = handler.command.replace(/^node(?=\s+)/, quotedNode);
            }
          }
        }
      }
    }
    fs.writeFileSync(destFile, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  } catch (_) {
    fs.copyFileSync(srcFile, destFile);
  }
}

function detect(options = {}) {
  const homeDir = resolveHomeDir(options);
  return (
    fs.existsSync(path.join(homeDir, '.gemini')) ||
    fs.existsSync(path.join(homeDir, '.gemini', 'config'))
  );
}

function install(options = {}) {
  const sourceDir = options.sourceDir || path.resolve(__dirname, '..');
  const homeDir = resolveHomeDir(options);
  const forceCopy = shouldForceCopy(sourceDir, options.copy);
  const manifestPath = path.join(sourceDir, 'plugin.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`[${PLUGIN_NAME}] 未在源目录找到 plugin.json：${sourceDir}`);
  }

  const pluginsBaseDir = path.join(homeDir, '.gemini', 'config', 'plugins');
  const targetDir = path.join(pluginsBaseDir, PLUGIN_NAME);
  fs.mkdirSync(pluginsBaseDir, { recursive: true });

  removePathSafe(targetDir);
  // 陷阱: Antigravity Go 插件扫描器 os.ReadDir 会跳过根目录软链/Junction，根级必须用真实目录
  fs.mkdirSync(targetDir, { recursive: true });

  const copiedFiles = [];
  for (const fileName of ROOT_FILES) {
    const srcFile = path.join(sourceDir, fileName);
    if (fs.existsSync(srcFile)) {
      const destFile = path.join(targetDir, fileName);
      if (fileName === 'hooks.json') {
        installHooksJson(srcFile, destFile);
      } else {
        fs.copyFileSync(srcFile, destFile);
      }
      copiedFiles.push(fileName);
    }
  }

  const dirModes = {};
  for (const dirName of LINK_DIRS) {
    const mode = linkOrCopyDir(
      path.join(sourceDir, dirName),
      path.join(targetDir, dirName),
      forceCopy
    );
    if (mode !== 'skipped') {
      dirModes[dirName] = mode;
    }
  }

  if (!options.silent) {
    console.log('');
    console.log(`[tokless:antigravity] 已安装至 ${targetDir}`);
    console.log(`   插件源目录 : ${sourceDir}`);
    console.log(`   清单文件   : ${copiedFiles.join(', ')}`);
    console.log(
      `   模块挂载   : ${Object.entries(dirModes)
        .map(([k, v]) => `${k}[${v}]`)
        .join(', ')}`
    );
  }

  return {
    target: 'antigravity',
    targetDir,
    copiedFiles,
    dirModes,
  };
}

function uninstall(options = {}) {
  const homeDir = resolveHomeDir(options);
  const targetDir = path.join(homeDir, '.gemini', 'config', 'plugins', PLUGIN_NAME);
  let existed = fs.existsSync(targetDir);
  if (!existed) {
    try {
      fs.lstatSync(targetDir);
      existed = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  if (!existed) {
    if (!options.silent) {
      console.log(`[tokless:antigravity] 未检测到已安装的 ${PLUGIN_NAME}（${targetDir} 不存在）。`);
    }
    return { target: 'antigravity', targetDir, removed: false };
  }

  removePathSafe(targetDir);
  if (!options.silent) {
    console.log(`[tokless:antigravity] 已卸载 ${PLUGIN_NAME}（已清理 ${targetDir}）。`);
  }
  return { target: 'antigravity', targetDir, removed: true };
}

module.exports = {
  id: 'antigravity',
  aliases: ['agy', 'antigravity'],
  label: 'Antigravity (~/.gemini/config/plugins/agy-tokless)',
  PLUGIN_NAME,
  installHooksJson,
  detect,
  install,
  uninstall,
};
