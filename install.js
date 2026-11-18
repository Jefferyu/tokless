#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN_NAME = 'agy-tokless';
const ROOT_FILES = ['plugin.json', 'hooks.json', 'package.json', 'README.md', 'LICENSE'];
const LINK_DIRS = ['rules', 'skills', 'scripts', 'tools'];

function removePathSafe(targetPath) {
  let stat;
  try {
    stat = fs.lstatSync(targetPath);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  if (stat.isSymbolicLink()) {
    fs.unlinkSync(targetPath);
    return;
  }

  if (stat.isDirectory()) {
    // Recursively remove without following inner symlinks/junctions
    for (const entry of fs.readdirSync(targetPath)) {
      removePathSafe(path.join(targetPath, entry));
    }
    fs.rmdirSync(targetPath);
    return;
  }

  fs.unlinkSync(targetPath);
}

function copyDirRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function linkOrCopyDir(srcDir, destDir, forceCopy) {
  if (!fs.existsSync(srcDir)) return 'skipped';

  if (!forceCopy) {
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    try {
      fs.symlinkSync(srcDir, destDir, linkType);
      return `link(${linkType})`;
    } catch (_) {
      // Fallback to recursive copy if symlink/junction creation is not permitted
    }
  }

  copyDirRecursive(srcDir, destDir);
  return 'copy';
}

function install(options = {}) {
  const sourceDir = __dirname;
  const manifestPath = path.join(sourceDir, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`[${PLUGIN_NAME}] 错误：未在当前目录找到 plugin.json：${sourceDir}`);
    process.exit(1);
  }

  const pluginsBaseDir = path.join(os.homedir(), '.gemini', 'config', 'plugins');
  const targetDir = path.join(pluginsBaseDir, PLUGIN_NAME);
  fs.mkdirSync(pluginsBaseDir, { recursive: true });

  // Clean up any previous installation (symlink, junction, or directory) safely
  removePathSafe(targetDir);

  // Use a real directory at the plugin root so Antigravity's plugin scanner
  // reliably discovers it on Windows/macOS/Linux (Go os.ReadDir skips root symlinks/junctions).
  fs.mkdirSync(targetDir, { recursive: true });

  const copiedFiles = [];
  for (const fileName of ROOT_FILES) {
    const srcFile = path.join(sourceDir, fileName);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(targetDir, fileName));
      copiedFiles.push(fileName);
    }
  }

  const dirModes = {};
  for (const dirName of LINK_DIRS) {
    const mode = linkOrCopyDir(
      path.join(sourceDir, dirName),
      path.join(targetDir, dirName),
      Boolean(options.copy)
    );
    if (mode !== 'skipped') {
      dirModes[dirName] = mode;
    }
  }

  console.log('');
  console.log(`✅ ${PLUGIN_NAME} 已成功安装并启用！`);
  console.log(`   插件源目录 : ${sourceDir}`);
  console.log(`   挂载目录   : ${targetDir}`);
  console.log(`   清单文件   : ${copiedFiles.join(', ')}`);
  console.log(
    `   模块挂载   : ${Object.entries(dirModes)
      .map(([k, v]) => `${k}[${v}]`)
      .join(', ')}`
  );
  console.log('');
  console.log('📌 下一步验证：');
  console.log('   1. 重启或打开 Antigravity（或运行 `agy plugin list`）即可看到 agy-tokless 已处于启用状态。');
  console.log('   2. 包含组件：PreToolUse 防盲读护栏（read-file-guard）、省流规则（AGENTS.md）、');
  console.log('      代码骨架技能（code-skeleton）与账单审计技能（token-audit）。');
  console.log('   3. 如需卸载，运行：node install.js --uninstall');
  console.log('');
}

function uninstall() {
  const targetDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', PLUGIN_NAME);
  if (!fs.existsSync(targetDir)) {
    try {
      fs.lstatSync(targetDir);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log(`ℹ️  未检测到已安装的 ${PLUGIN_NAME}（${targetDir} 不存在）。`);
        return;
      }
    }
  }
  removePathSafe(targetDir);
  console.log(`🗑️  已卸载 ${PLUGIN_NAME}（已清理 ${targetDir}）。`);
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    console.log(`Usage: node install.js [--copy | --uninstall]`);
    console.log(`  (default)    Install ${PLUGIN_NAME} into ~/.gemini/config/plugins/${PLUGIN_NAME} (links subdirs, copies fallback)`);
    console.log(`  --copy       Copy all plugin files instead of creating links`);
    console.log(`  --uninstall  Remove ${PLUGIN_NAME} from ~/.gemini/config/plugins/${PLUGIN_NAME}`);
    return;
  }
  if (args.has('--uninstall')) {
    uninstall();
    return;
  }
  install({ copy: args.has('--copy') });
}

main();
