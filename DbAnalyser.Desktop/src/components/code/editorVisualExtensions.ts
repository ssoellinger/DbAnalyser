import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

/* ── Indent Guides ────────────────────────────────────────────────────── */

const indentGuideTheme = EditorView.baseTheme({
  '.cm-indent-guide': {
    display: 'inline-block',
    borderLeft: '1px solid #2a2a4060',
    width: '0',
    position: 'relative',
  },
});

const indentGuideMark = Decoration.mark({ class: 'cm-indent-guide' });

const indentGuidePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildIndentGuides(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildIndentGuides(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

function buildIndentGuides(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tabSize = view.state.tabSize;

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;

      // Count leading whitespace
      let indent = 0;
      let charIdx = 0;
      while (charIdx < text.length) {
        if (text[charIdx] === ' ') { indent++; charIdx++; }
        else if (text[charIdx] === '\t') { indent += tabSize; charIdx++; }
        else break;
      }

      // Add guide marks at each indent level (respects editor tab size)
      const step = tabSize;
      if (indent >= step && charIdx > 0) {
        let guideCol = step;
        while (guideCol <= indent) {
          // Find the character position at this column
          let col = 0;
          let ci = 0;
          while (ci < charIdx && col < guideCol) {
            if (text[ci] === '\t') col += tabSize;
            else col++;
            ci++;
          }
          if (ci > 0 && ci <= charIdx) {
            builder.add(line.from + ci - 1, line.from + ci, indentGuideMark);
          }
          guideCol += step;
        }
      }

      pos = line.to + 1;
    }
  }

  return builder.finish();
}

export const indentGuidesExtension = [indentGuidePlugin, indentGuideTheme];

/* ── Bracket Pair Colorization ────────────────────────────────────────── */

const BRACKET_COLORS = ['#ffd700', '#ff5277', '#00e5ff', '#69f0ae', '#ea80fc', '#ffab40'];

const bracketColorTheme = EditorView.theme(
  Object.fromEntries(
    BRACKET_COLORS.map((color, i) => [
      `& .cm-bracket-color-${i}`,
      { color: `${color} !important`, fontWeight: 'bold' },
    ])
  )
);

const bracketColorPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildBracketColors(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildBracketColors(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

function buildBracketColors(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const marks = BRACKET_COLORS.map((_, i) =>
    Decoration.mark({ class: `cm-bracket-color-${i}` })
  );

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      // Track comments
      if (!inString && !inBlockComment && ch === '-' && next === '-') { inLineComment = true; continue; }
      if (inLineComment && ch === '\n') { inLineComment = false; continue; }
      if (inLineComment) continue;
      if (!inString && !inLineComment && ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
      if (inBlockComment && ch === '*' && next === '/') { inBlockComment = false; i++; continue; }
      if (inBlockComment) continue;

      // Track strings
      if (!inString && (ch === "'" || ch === '"')) { inString = true; stringChar = ch; continue; }
      if (inString && ch === stringChar) {
        if (next === stringChar) { i++; continue; } // escaped quote
        inString = false; continue;
      }
      if (inString) continue;

      if (ch === '(') {
        const colorIdx = depth % BRACKET_COLORS.length;
        builder.add(from + i, from + i + 1, marks[colorIdx]);
        depth++;
      } else if (ch === ')') {
        depth = Math.max(0, depth - 1);
        const colorIdx = depth % BRACKET_COLORS.length;
        builder.add(from + i, from + i + 1, marks[colorIdx]);
      }
    }
  }

  return builder.finish();
}

export const bracketColorsExtension = [bracketColorPlugin, bracketColorTheme];

/* ── Highlight All Occurrences ────────────────────────────────────────── */

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'ON', 'AS', 'SET',
  'NULL', 'IS', 'BY', 'ORDER', 'GROUP', 'HAVING', 'JOIN', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'CROSS', 'INTO', 'INSERT', 'UPDATE', 'DELETE', 'CREATE',
  'ALTER', 'DROP', 'TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION', 'BEGIN', 'END',
  'IF', 'ELSE', 'WHILE', 'RETURN', 'DECLARE', 'EXEC', 'EXECUTE', 'THEN',
  'WHEN', 'CASE', 'WITH', 'VALUES', 'GO', 'USE', 'PRINT', 'RAISERROR',
  'THROW', 'TRY', 'CATCH', 'TRANSACTION', 'COMMIT', 'ROLLBACK', 'INT',
  'VARCHAR', 'NVARCHAR', 'BIT', 'DATETIME', 'FLOAT', 'DECIMAL',
]);

const occurrenceHighlightTheme = EditorView.baseTheme({
  '.cm-occurrence-highlight': {
    backgroundColor: '#4fc3f720',
    outline: '1px solid #4fc3f740',
    borderRadius: '2px',
  },
});

const occurrenceMark = Decoration.mark({ class: 'cm-occurrence-highlight' });

const occurrencePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildOccurrences(view);
    }
    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged || update.viewportChanged) {
        this.decorations = buildOccurrences(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

function buildOccurrences(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { from: selFrom, to: selTo } = view.state.selection.main;

  // Only highlight if there's a word selection (no range selection or single cursor)
  if (selFrom === selTo) {
    // Try to get the word at cursor
    const pos = selFrom;
    const line = view.state.doc.lineAt(pos);
    const text = line.text;
    const offset = pos - line.from;

    // Find word boundaries
    let start = offset;
    let end = offset;
    while (start > 0 && /[\w]/.test(text[start - 1])) start--;
    while (end < text.length && /[\w]/.test(text[end])) end++;

    if (start === end || end - start < 2) return builder.finish();
    const word = text.slice(start, end);

    if (SQL_KEYWORDS.has(word.toUpperCase())) return builder.finish();

    // Find all occurrences in visible ranges
    const wordRe = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    for (const { from, to } of view.visibleRanges) {
      const rangeText = view.state.doc.sliceString(from, to);
      let match: RegExpExecArray | null;
      wordRe.lastIndex = 0;
      while ((match = wordRe.exec(rangeText)) !== null) {
        builder.add(from + match.index, from + match.index + match[0].length, occurrenceMark);
      }
    }
  } else {
    // If user selected text, highlight all occurrences of the exact selection
    const selected = view.state.doc.sliceString(selFrom, selTo).trim();
    if (selected.length < 2 || selected.length > 100 || selected.includes('\n')) return builder.finish();

    const escaped = selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    for (const { from, to } of view.visibleRanges) {
      const rangeText = view.state.doc.sliceString(from, to);
      let match: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((match = re.exec(rangeText)) !== null) {
        const mFrom = from + match.index;
        const mTo = mFrom + match[0].length;
        // Skip the selection itself
        if (mFrom === selFrom && mTo === selTo) continue;
        builder.add(mFrom, mTo, occurrenceMark);
      }
    }
  }

  return builder.finish();
}

export const highlightOccurrencesExtension = [occurrencePlugin, occurrenceHighlightTheme];
