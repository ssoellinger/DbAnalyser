import { foldService } from '@codemirror/language';

/**
 * Custom SQL fold service that detects foldable blocks:
 * - BEGIN ... END
 * - CASE ... END
 * - Multi-line comments /* ... * /
 * - CREATE PROCEDURE/FUNCTION/TRIGGER/VIEW ... AS (fold body)
 * - Parenthesized blocks spanning multiple lines
 */
export const sqlFoldService = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart);
  const text = line.text.trimStart();
  const textUpper = text.toUpperCase();

  // BEGIN ... END folding
  if (/^\bBEGIN\b/i.test(text)) {
    const endPos = findMatchingEnd(state.doc, line.number, 'BEGIN', 'END');
    if (endPos !== null) {
      return { from: lineEnd, to: endPos };
    }
  }

  // CASE ... END folding
  if (/\bCASE\b/i.test(text) && !/\bEND\b/i.test(text)) {
    const endPos = findMatchingEnd(state.doc, line.number, 'CASE', 'END');
    if (endPos !== null) {
      return { from: lineEnd, to: endPos };
    }
  }

  // Multi-line comment /* ... */
  if (text.startsWith('/*') && !text.includes('*/')) {
    for (let i = line.number + 1; i <= state.doc.lines; i++) {
      const nextLine = state.doc.line(i);
      const closeIdx = nextLine.text.indexOf('*/');
      if (closeIdx !== -1) {
        return { from: lineEnd, to: nextLine.from + closeIdx + 2 };
      }
    }
  }

  // CREATE ... AS — fold everything after AS
  if (/^CREATE\s+(PROCEDURE|PROC|FUNCTION|TRIGGER|VIEW)\b/i.test(text)) {
    // Find the AS keyword on this line or subsequent lines
    for (let i = line.number; i <= Math.min(line.number + 20, state.doc.lines); i++) {
      const scanLine = state.doc.line(i);
      const asMatch = scanLine.text.match(/\bAS\b/i);
      if (asMatch) {
        const asEnd = scanLine.from + asMatch.index! + asMatch[0].length;
        // Fold from after AS to end of document (or last END)
        const lastLine = state.doc.line(state.doc.lines);
        if (i < state.doc.lines) {
          return { from: asEnd, to: lastLine.to };
        }
        break;
      }
    }
  }

  // ALTER PROCEDURE/FUNCTION/TRIGGER/VIEW ... AS
  if (/^ALTER\s+(PROCEDURE|PROC|FUNCTION|TRIGGER|VIEW)\b/i.test(text)) {
    for (let i = line.number; i <= Math.min(line.number + 20, state.doc.lines); i++) {
      const scanLine = state.doc.line(i);
      const asMatch = scanLine.text.match(/\bAS\b/i);
      if (asMatch) {
        const asEnd = scanLine.from + asMatch.index! + asMatch[0].length;
        const lastLine = state.doc.line(state.doc.lines);
        if (i < state.doc.lines) {
          return { from: asEnd, to: lastLine.to };
        }
        break;
      }
    }
  }

  // Parenthesized blocks: opening ( with no closing ) on same line
  const openParen = text.indexOf('(');
  if (openParen !== -1) {
    const afterOpen = text.slice(openParen);
    const openCount = (afterOpen.match(/\(/g) || []).length;
    const closeCount = (afterOpen.match(/\)/g) || []).length;
    if (openCount > closeCount) {
      // Find matching close paren
      let depth = openCount - closeCount;
      for (let i = line.number + 1; i <= state.doc.lines; i++) {
        const nextLine = state.doc.line(i);
        const lineOpens = (nextLine.text.match(/\(/g) || []).length;
        const lineCloses = (nextLine.text.match(/\)/g) || []).length;
        depth += lineOpens - lineCloses;
        if (depth <= 0) {
          const closeIdx = nextLine.text.lastIndexOf(')');
          return { from: line.from + line.text.indexOf('(') + 1, to: nextLine.from + closeIdx };
        }
      }
    }
  }

  return null;
});

/**
 * Find matching END for a BEGIN or CASE block, handling nesting.
 */
function findMatchingEnd(
  doc: { lines: number; line: (n: number) => { text: string; from: number; to: number } },
  startLine: number,
  openKeyword: string,
  closeKeyword: string,
): number | null {
  let depth = 0;
  const openRe = new RegExp(`\\b${openKeyword}\\b`, 'gi');
  const closeRe = new RegExp(`\\b${closeKeyword}\\b`, 'gi');

  for (let i = startLine; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;

    // Skip lines inside string literals or comments (simplified)
    openRe.lastIndex = 0;
    closeRe.lastIndex = 0;

    const opens = text.match(openRe)?.length ?? 0;
    const closes = text.match(closeRe)?.length ?? 0;

    depth += opens - closes;

    if (depth <= 0 && i > startLine) {
      // Find the position of the closing END
      closeRe.lastIndex = 0;
      let match: RegExpExecArray | null;
      let lastMatch: RegExpExecArray | null = null;
      while ((match = closeRe.exec(text)) !== null) {
        lastMatch = match;
      }
      if (lastMatch) {
        return line.from + lastMatch.index;
      }
    }
  }

  return null;
}
