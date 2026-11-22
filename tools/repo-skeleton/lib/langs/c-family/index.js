'use strict';

const {
  preprocessBraceLines,
  hasTopLevelChar,
} = require('../../core/lexer');
const {
  DEFAULT_CONTROL_KEYWORDS,
  stripLeadingAttributesAndAnnotations,
  scanBraceLanguage,
} = require('../../core/block-anchor');

const ID = 'c-family';
const EXTENSIONS = ['.c', '.h', '.cpp', '.hpp', '.cc', '.cs'];
const HEADER_EXTS = new Set(['.h', '.hpp']);
const CPP_CONTAINERS = new Set(['class', 'struct', 'union', 'enum', 'namespace']);
const CS_CONTAINERS = new Set(['class', 'struct', 'interface', 'enum', 'record', 'namespace']);

function parse(lines, ext = '.c', options = {}) {
  if (ext && typeof ext === 'object') {
    options = ext;
    ext = '.c';
  }
  const normalizedExt = String(ext || '.c').toLowerCase();
  const isCs = normalizedExt === '.cs';
  const isHeader = HEADER_EXTS.has(normalizedExt);
  const lineOffset = options.lineOffset || 0;

  const analyzed = preprocessBraceLines(lines, 'c');

  return scanBraceLanguage(analyzed, {
    lexer: 'c',
    containers: isCs ? CS_CONTAINERS : CPP_CONTAINERS,
    lineOffset,
    onStatementLine({
      analyzed: rows,
      lineIdx,
      scopeStack,
      items,
      lineOffset: offset,
      findDeclarationRange,
      buildCompactSignature,
    }) {
      const trimmed = rows[lineIdx].clean.trim();
      if (!trimmed || trimmed.startsWith('#')) return null;

      const core = stripLeadingAttributesAndAnnotations(trimmed);
      if (!core) return null;

      const activeScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : null;
      const inTypeScope =
        activeScope !== null && activeScope.kind !== 'namespace' && activeScope.kind !== 'enum';

      if (isCs && inTypeScope) {
        const propMatch = core.match(
          /^(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|readonly|new|required|unsafe)\s+)+[\w.<>,?\[\]\s]+\s+([A-Za-z_]\w*)\s*(?:\{|=>)/
        );
        if (propMatch && !DEFAULT_CONTROL_KEYWORDS.has(propMatch[1])) {
          const beforeBraceOrArrow = core.split(/\{|=>/)[0];
          if (!beforeBraceOrArrow.includes('(') && !hasTopLevelChar(beforeBraceOrArrow, '=')) {
            const range = findDeclarationRange(rows, lineIdx, 'c');
            const signature = buildCompactSignature(
              rows,
              lineIdx,
              range.headerEndIdx,
              range.hasBlock
            );
            items.push({
              kind: 'property',
              name: propMatch[1],
              signature,
              startLine: lineIdx + 1 + offset,
              endLine: range.endIdx + 1 + offset,
              depth: scopeStack.length,
            });
            return { jumpToLine: range.endIdx };
          }
        }
      }

      if (!isCs && /\boperator\s*(?:<<|>>|\+|-|\*|\/|%|\^|&|\|)=/.test(core)) {
        const range = findDeclarationRange(rows, lineIdx, 'c');
        if (range.hasBlock || isHeader) {
          const opMatch = core.match(/\b(operator\s*(?:<<|>>|\+|-|\*|\/|%|\^|&|\|)=)/);
          if (opMatch) {
            const signature = buildCompactSignature(
              rows,
              lineIdx,
              range.headerEndIdx,
              range.hasBlock
            );
            items.push({
              kind: inTypeScope ? 'method' : 'function',
              name: opMatch[1].replace(/\s+/g, ''),
              signature,
              startLine: lineIdx + 1 + offset,
              endLine: range.endIdx + 1 + offset,
              depth: scopeStack.length,
            });
            return { jumpToLine: range.endIdx };
          }
        }
      }

      if (isHeader || (isCs && activeScope && activeScope.kind === 'interface')) {
        const range = findDeclarationRange(rows, lineIdx, 'c');
        if (range.hasBlock) return null;

        const joined = stripLeadingAttributesAndAnnotations(
          rows
            .slice(lineIdx, range.endIdx + 1)
            .map((r) => r.clean)
            .join(' ')
        ).trim();
        if (!joined.endsWith(';')) return null;
        if (/^(?:typedef|using|friend|extern\s+"C"|template\b[^;]*;$)/.test(joined)) return null;

        const cleanedProto = joined.replace(/^(?:public|private|protected)\s*:\s*/, '').trim();
        const parenIdx = cleanedProto.indexOf('(');
        if (parenIdx <= 0) return null;
        const beforeParen = cleanedProto.slice(0, parenIdx).trim();
        if (hasTopLevelChar(beforeParen, '=')) return null;

        const firstWordMatch = beforeParen.match(/^([A-Za-z_]\w*)\b/);
        if (firstWordMatch && DEFAULT_CONTROL_KEYWORDS.has(firstWordMatch[1])) return null;

        let name = '';
        const opProto = beforeParen.match(/\b(operator\s*(?:\(\)|\[\]|[^\s(]+))\s*$/);
        if (opProto) {
          name = opProto[1].replace(/\s+/g, '');
        } else {
          const nm = beforeParen.match(/([~A-Za-z_]\w*)$/);
          if (!nm || DEFAULT_CONTROL_KEYWORDS.has(nm[1])) return null;
          name = nm[1];
          const prefix = beforeParen.slice(0, beforeParen.length - name.length).trim();
          const isCtorOrDtor =
            inTypeScope &&
            activeScope &&
            (name === activeScope.name || name === `~${activeScope.name}`);
          // 陷阱: 头文件宏调用（如 `DECLARE_API(foo);`）无返回类型前缀，必须要求显式返回类型或类构造/析构名才认作函数原型
          if (!prefix && !isCtorOrDtor) return null;
        }

        const afterCloseIdx = cleanedProto.lastIndexOf(')');
        if (afterCloseIdx === -1) return null;
        const tail = cleanedProto.slice(afterCloseIdx + 1, -1).trim();
        if (
          tail &&
          !/^(?:(?:const|volatile|noexcept(?:\([^)]*\))?|override|final)\s*)*(?:=\s*(?:0|default|delete))?$/.test(
            tail
          )
        ) {
          return null;
        }

        const signature = buildCompactSignature(rows, lineIdx, range.headerEndIdx, false);
        items.push({
          kind: inTypeScope ? 'method' : 'function',
          name,
          signature,
          startLine: lineIdx + 1 + offset,
          endLine: range.endIdx + 1 + offset,
          depth: scopeStack.length,
        });
        return { jumpToLine: range.endIdx };
      }

      return null;
    },
  });
}

module.exports = {
  id: ID,
  extensions: EXTENSIONS,
  parse,
};
