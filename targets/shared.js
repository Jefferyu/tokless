'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveHomeDir(options = {}) {
  return options.homeDir || os.homedir();
}

function shouldForceCopy(sourceDir, explicitCopy) {
  if (explicitCopy) return true;
  const normalized = String(sourceDir || '').replace(/\\/g, '/');
  return normalized.includes('/_npx/') || normalized.includes('/node_modules/');
}

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
    } catch (_) {}
  }

  copyDirRecursive(srcDir, destDir);
  return 'copy';
}

function resolveNodeBinary() {
  // 陷阱: macOS Homebrew 升级 Node 会使 Cellar 版本化路径失效，优先复用稳定软链
  if (process.platform === 'darwin') {
    for (const stable of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
      try {
        if (fs.existsSync(stable) && fs.realpathSync(stable) === fs.realpathSync(process.execPath)) {
          return stable;
        }
      } catch (_) {}
    }
  }
  const argv0 = process.argv[0];
  if (argv0 && path.isAbsolute(argv0) && fs.existsSync(argv0)) {
    return argv0;
  }
  return process.execPath;
}

function quoteCommandBinary(binPath) {
  return `"${String(binPath).replace(/"/g, '\\"')}"`;
}

module.exports = {
  resolveHomeDir,
  shouldForceCopy,
  removePathSafe,
  copyDirRecursive,
  linkOrCopyDir,
  resolveNodeBinary,
  quoteCommandBinary,
};
