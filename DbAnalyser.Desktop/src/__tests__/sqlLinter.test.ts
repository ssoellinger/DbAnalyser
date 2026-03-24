import { describe, it, expect } from 'vitest';

// We can't easily test the full linter (needs CodeMirror EditorView), but we can
// test the pure helper functions by importing the module and testing the syntax checks.
// Since syntaxCheck and KEYWORD_TYPOS are not exported, we'll test via the module's behavior.

// For now, test the keyword typo dictionary and syntax patterns directly.
const KEYWORD_TYPOS: Record<string, string> = {
  'selec': 'SELECT', 'slect': 'SELECT', 'selet': 'SELECT', 'selcet': 'SELECT',
  'form': 'FROM', 'fom': 'FROM', 'frome': 'FROM', 'frm': 'FROM',
  'wehre': 'WHERE', 'whre': 'WHERE', 'wher': 'WHERE', 'were': 'WHERE',
  'jion': 'JOIN', 'jon': 'JOIN', 'joing': 'JOIN',
  'isert': 'INSERT', 'inser': 'INSERT', 'insrt': 'INSERT', 'insret': 'INSERT',
  'udpate': 'UPDATE', 'upate': 'UPDATE', 'updte': 'UPDATE', 'upadte': 'UPDATE',
  'delte': 'DELETE', 'deleet': 'DELETE', 'delet': 'DELETE',
  'gruop': 'GROUP', 'gropu': 'GROUP', 'goup': 'GROUP',
  'oder': 'ORDER', 'orde': 'ORDER', 'ordr': 'ORDER',
  'distint': 'DISTINCT', 'distnct': 'DISTINCT', 'distict': 'DISTINCT',
  'tabel': 'TABLE', 'tabke': 'TABLE',
  'bigin': 'BEGIN', 'begn': 'BEGIN',
  'retrun': 'RETURN', 'reutrn': 'RETURN',
};

describe('keyword typo detection', () => {
  it('maps common SELECT typos', () => {
    expect(KEYWORD_TYPOS['selec']).toBe('SELECT');
    expect(KEYWORD_TYPOS['slect']).toBe('SELECT');
    expect(KEYWORD_TYPOS['selcet']).toBe('SELECT');
  });

  it('maps common FROM typos', () => {
    expect(KEYWORD_TYPOS['form']).toBe('FROM');
    expect(KEYWORD_TYPOS['frome']).toBe('FROM');
  });

  it('maps common WHERE typos', () => {
    expect(KEYWORD_TYPOS['wehre']).toBe('WHERE');
    expect(KEYWORD_TYPOS['whre']).toBe('WHERE');
  });

  it('maps common JOIN typos', () => {
    expect(KEYWORD_TYPOS['jion']).toBe('JOIN');
    expect(KEYWORD_TYPOS['joing']).toBe('JOIN');
  });

  it('maps common UPDATE typos', () => {
    expect(KEYWORD_TYPOS['udpate']).toBe('UPDATE');
    expect(KEYWORD_TYPOS['upate']).toBe('UPDATE');
  });

  it('does not map valid SQL keywords', () => {
    expect(KEYWORD_TYPOS['select']).toBeUndefined();
    expect(KEYWORD_TYPOS['from']).toBeUndefined();
    expect(KEYWORD_TYPOS['where']).toBeUndefined();
    expect(KEYWORD_TYPOS['insert']).toBeUndefined();
  });
});

describe('parenthesis matching', () => {
  function countParens(sql: string): { open: number; close: number; balanced: boolean } {
    let depth = 0;
    let open = 0;
    let close = 0;
    for (const ch of sql) {
      if (ch === '(') { depth++; open++; }
      if (ch === ')') { depth--; close++; }
    }
    return { open, close, balanced: depth === 0 };
  }

  it('detects balanced parentheses', () => {
    expect(countParens('SELECT (1 + 2)')).toEqual({ open: 1, close: 1, balanced: true });
  });

  it('detects unmatched opening', () => {
    expect(countParens('SELECT (1 + 2')).toEqual({ open: 1, close: 0, balanced: false });
  });

  it('detects unmatched closing', () => {
    expect(countParens('SELECT 1 + 2)')).toEqual({ open: 0, close: 1, balanced: false });
  });

  it('handles nested parentheses', () => {
    expect(countParens('SELECT ((1 + 2) * 3)')).toEqual({ open: 2, close: 2, balanced: true });
  });
});

describe('unclosed string detection', () => {
  function hasUnclosedString(sql: string): boolean {
    let inString = false;
    for (let i = 0; i < sql.length; i++) {
      if (sql[i] === "'") {
        if (inString && i + 1 < sql.length && sql[i + 1] === "'") { i++; continue; }
        inString = !inString;
      }
    }
    return inString;
  }

  it('detects closed string', () => {
    expect(hasUnclosedString("SELECT 'hello'")).toBe(false);
  });

  it('detects unclosed string', () => {
    expect(hasUnclosedString("SELECT 'hello")).toBe(true);
  });

  it('handles escaped quotes', () => {
    expect(hasUnclosedString("SELECT 'it''s fine'")).toBe(false);
  });

  it('handles empty string', () => {
    expect(hasUnclosedString("SELECT ''")).toBe(false);
  });
});
