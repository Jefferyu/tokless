'use strict';

const { preprocessBraceLines } = require('../../core/lexer');
const {
   DEFAULT_CONTROL_KEYWORDS,
  findDeclarationRange,
  buildCompactSignature,
} = require('../../core/block-anchor');

const ID = 'javascript';
const EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];
const TS_EXTS = new Set(['.ts', '.tsx']);

function hasFunctionRhs(analyzed, startIdx, headerEndIdx) {
  let text = '';
  for (let i = startIdx; i <= headerEndIdx; i++) {
    text += ' ' + analyzed[i].clean;
  }
  return /=>/.test(text) || /=\s*(?:async\s+)?function\b/.test(text);
}

function findIifeRange(analyzed, startIdx) {
  const startInfo = analyzed[startIdx];
  const trimmed = startInfo.clean.trim();
  // 陷阱: 仅匹配带显式前缀的顶层 IIFE/UMD（`(function`、`!function`、`(() =>`），避免把普通顶层函数误判为包装器
  const isIifeHeader =
    /^(?:;\s*)?\(\s*(?:async\s+)?function\b/.test(trimmed) ||
    /^(?:;\s*)?(?:[!+~-]\s*|void\s+)(?:async\s+)?function\b/.test(trimmed) ||
    /^(?:;\s*)?\(\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{?/.test(trimmed);
  if (!isIifeHeader) return null;

  let headerEndIdx = -1;
  for (let j = startIdx; j < analyzed.length && j <= startIdx + 2; j++) {
    if (analyzed[j].braceEnd > startInfo.braceStart) {
      headerEndIdx = j;
      break;
    }
  }
  if (headerEndIdx === -1) return null;

  for (let j = headerEndIdx; j < analyzed.length; j++) {
    if (analyzed[j].braceEnd <= startInfo.braceStart) {
      if (j <= headerEndIdx) return null;
      // 陷阱: UMD 头部适配器在闭合 `}` 后紧跟 `, function () {` 工厂块换行开启时，需继续追踪工厂体至末尾
      const tail = (analyzed[j].clean + ' ' + (j + 1 < analyzed.length ? analyzed[j + 1].clean : '')).trim();
      if (/,\s*\(?\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/.test(tail)) {
        if (j + 1 < analyzed.length && analyzed[j + 1].braceEnd > startInfo.braceStart) {
          j++;
          continue;
        }
      }
      return {
        headerEndIdx,
        endIdx: j,
        bodyDepth: startInfo.braceStart + 1,
      };
    }
  }
  return null;
}

function parse(lines, ext = '.js', options = {}) {
  if (ext && typeof ext === 'object') {
    options = ext;
    ext = '.js';
  }
  const normalizedExt = String(ext || '.js').toLowerCase();
  const isTs = TS_EXTS.has(normalizedExt);
  const lineOffset = options.lineOffset || 0;

  const analyzed = preprocessBraceLines(lines, 'js');
  const items = [];
  const classStack = [];
  let activeIifeEnd = -1;
  let activeIifeBodyDepth = -1;

  for (let i = 0; i < analyzed.length; i++) {
    const info = analyzed[i];
    const trimmed = info.clean.trim();
    if (!trimmed) continue;

    while (classStack.length > 0 && i > classStack[classStack.length - 1].endIdx) {
      classStack.pop();
    }
    if (activeIifeEnd !== -1 && i > activeIifeEnd) {
      activeIifeEnd = -1;
      activeIifeBodyDepth = -1;
    }

    if (info.braceStart === 0 && activeIifeEnd === -1 && classStack.length === 0) {
      const iife = findIifeRange(analyzed, i);
      if (iife) {
        activeIifeEnd = iife.endIdx;
        activeIifeBodyDepth = iife.bodyDepth;
        i = iife.headerEndIdx;
        continue;
      }
    }

    const topScopeDepth =
      activeIifeEnd !== -1 && i <= activeIifeEnd ? activeIifeBodyDepth : 0;
    const currentClass = classStack.length > 0 ? classStack[classStack.length - 1] : null;
    const inClassBody =
      currentClass !== null &&
      i <= currentClass.endIdx &&
      info.braceStart === currentClass.bodyDepth;

    if (info.braceStart === topScopeDepth && !inClassBody) {
      let kind = null;
      let name = '';
      let m;

      if (
        (m = trimmed.match(
          /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/
        )) ||
        (m = trimmed.match(/^(?:module\.)?exports\s*=\s*(?:abstract\s+)?class\s*([A-Za-z_$][\w$]*)?/))
      ) {
        kind = 'class';
        name = m[1] || 'default';
      } else if (
        isTs &&
        (m = trimmed.match(
          /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/
        ))
      ) {
        kind = 'interface';
        name = m[1];
      } else if (
        isTs &&
        (m = trimmed.match(
          /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\b/
        ))
      ) {
        kind = 'type';
        name = m[1];
      } else if (
        isTs &&
        (m = trimmed.match(
          /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/
        ))
      ) {
        kind = 'enum';
        name = m[1];
      } else if (
        isTs &&
        (m = trimmed.match(
          /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:namespace|module)\s+([A-Za-z_$][\w$]*)/
        ))
      ) {
        kind = 'namespace';
        name = m[1];
      } else if (
        (m = trimmed.match(
          /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*(?:<[\s\S]*>)?\s*\(/
        )) ||
        (m = trimmed.match(
          /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\b/
        ))
      ) {
        kind = 'function';
        name = m[1] || 'default';
      } else if (
        (m = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/))
      ) {
        const rangeProbe = findDeclarationRange(analyzed, i, 'js');
        if (hasFunctionRhs(analyzed, i, rangeProbe.headerEndIdx)) {
          kind = 'function';
          name = m[1];
        } else if (/=\s*(?:abstract\s+)?class\b/.test(trimmed)) {
          kind = 'class';
          name = m[1];
        }
      } else if ((m = trimmed.match(/^(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/))) {
        const rangeProbe = findDeclarationRange(analyzed, i, 'js');
        if (hasFunctionRhs(analyzed, i, rangeProbe.headerEndIdx)) {
          kind = 'function';
          name = m[1];
        }
      } else if (/^module\.exports\s*=\s*\{/.test(trimmed)) {
        kind = 'export';
        name = 'module.exports';
      } else if (/^export\s+default\s+(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(trimmed)) {
        kind = 'function';
        name = 'default';
      } else if (/^export\s+default\s+(?:async\s+)?function\b/.test(trimmed)) {
        kind = 'function';
        name = 'default';
      }

      if (kind) {
        const range = findDeclarationRange(analyzed, i, 'js');
        let signature = buildCompactSignature(analyzed, i, range.headerEndIdx, range.hasBlock);
        if (kind === 'export' && name === 'module.exports') {
          const exportNames = [];
          for (let k = i; k <= range.endIdx; k++) {
            const lineClean = analyzed[k].clean
              .replace(/^module\.exports\s*=\s*\{?/, '')
              .replace(/\}?;?\s*$/, '');
            for (const token of lineClean.split(',')) {
              const keyMatch = token.trim().match(/^([A-Za-z_$][\w$]*)/);
              if (keyMatch) exportNames.push(keyMatch[1]);
            }
          }
          if (exportNames.length > 0) {
            const joined = exportNames.join(', ');
            signature =
              joined.length > 100
                ? `module.exports = { ${joined.slice(0, 97)}... }`
                : `module.exports = { ${joined} }`;
          }
        }

        items.push({
          kind,
          name,
          signature,
          startLine: i + 1 + lineOffset,
          endLine: range.endIdx + 1 + lineOffset,
          depth: 0,
        });

        if (kind === 'class' && range.hasBlock) {
          classStack.push({
            endIdx: range.endIdx,
            bodyDepth: info.braceStart + 1,
          });
          i = range.headerEndIdx;
        } else {
          i = range.endIdx;
        }
        continue;
      }
    }

    if (inClassBody) {
      let methodMatch = trimmed.match(
        /^(?:@[A-Za-z_$][\w$.]*(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|static|async|readonly|override|abstract|accessor|get|set)\s+)*\*?\s*(#?[A-Za-z_$][\w$]*|\[[^\]]+\])\s*\??\s*(?:<[^>]*>)?\s*\(/
      );
      let isArrowField = false;
      if (!methodMatch) {
        const fieldMatch = trimmed.match(
          /^(?:@[A-Za-z_$][\w$.]*(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|static|readonly|override)\s+)*(#?[A-Za-z_$][\w$]*)\s*(?:!\s*)?(?::[^=]+)?=(?!=)/
        );
        if (fieldMatch) {
          const rangeProbe = findDeclarationRange(analyzed, i, 'js');
          if (hasFunctionRhs(analyzed, i, rangeProbe.headerEndIdx)) {
            methodMatch = fieldMatch;
            isArrowField = true;
          }
        }
      }

      if (methodMatch) {
        const methodName = methodMatch[1];
        if (!DEFAULT_CONTROL_KEYWORDS.has(methodName)) {
          const range = findDeclarationRange(analyzed, i, 'js');
          if (range.hasBlock || isArrowField || (isTs && trimmed.endsWith(';'))) {
            const signature = buildCompactSignature(
              analyzed,
              i,
              range.headerEndIdx,
              range.hasBlock
            );
            items.push({
              kind: 'method',
              name: methodName,
              signature,
              startLine: i + 1 + lineOffset,
              endLine: range.endIdx + 1 + lineOffset,
              depth: classStack.length,
            });
            i = range.endIdx;
            continue;
          }
        }
      }
    }
  }

  return items;
}

module.exports = {
  id: ID,
  extensions: EXTENSIONS,
  parse,
};
