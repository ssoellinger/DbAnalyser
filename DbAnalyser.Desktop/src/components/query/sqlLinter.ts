import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import type { SQLNamespace } from '@codemirror/lang-sql';

// SQL keywords that look like identifiers but aren't table/column names
const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'join', 'inner', 'left', 'right', 'outer', 'cross',
  'on', 'and', 'or', 'not', 'in', 'is', 'null', 'as', 'case', 'when', 'then',
  'else', 'end', 'group', 'by', 'order', 'having', 'limit', 'offset', 'top',
  'distinct', 'all', 'union', 'intersect', 'except', 'exists', 'between', 'like',
  'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'alter', 'drop',
  'table', 'view', 'index', 'procedure', 'function', 'trigger', 'schema', 'database',
  'primary', 'key', 'foreign', 'references', 'constraint', 'unique', 'check', 'default',
  'begin', 'end', 'commit', 'rollback', 'transaction', 'declare', 'if', 'while',
  'return', 'exec', 'execute', 'print', 'raiserror', 'throw', 'try', 'catch',
  'with', 'nolock', 'rowlock', 'updlock', 'holdlock', 'go', 'use',
  'asc', 'desc', 'over', 'partition', 'row_number', 'rank', 'dense_rank',
  'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'isnull', 'cast', 'convert',
  'getdate', 'getutcdate', 'dateadd', 'datediff', 'year', 'month', 'day',
  'len', 'substring', 'replace', 'trim', 'ltrim', 'rtrim', 'upper', 'lower',
  'charindex', 'patindex', 'stuff', 'concat', 'format', 'newid', 'scope_identity',
  'identity_insert', 'nocount', 'xact_abort', 'ansi_nulls', 'quoted_identifier',
  'nvarchar', 'varchar', 'int', 'bigint', 'smallint', 'tinyint', 'bit', 'decimal',
  'numeric', 'float', 'real', 'money', 'smallmoney', 'date', 'datetime', 'datetime2',
  'time', 'char', 'nchar', 'text', 'ntext', 'image', 'binary', 'varbinary',
  'uniqueidentifier', 'xml', 'cursor', 'sql_variant', 'hierarchyid', 'geography',
  'output', 'merge', 'using', 'matched', 'target', 'source', 'when',
  'cross', 'apply', 'pivot', 'unpivot', 'tablesample', 'option', 'maxrecursion',
  'fetch', 'next', 'open', 'close', 'deallocate', 'for', 'after', 'instead',
  'of', 'truncate', 'save', 'savepoint', 'grant', 'revoke', 'deny',
  'add', 'column', 'type', 'clustered', 'nonclustered', 'include', 'fillfactor',
  'explain', 'analyze', 'verbose', 'costs', 'buffers', 'timing', 'rows',
  'serial', 'bigserial', 'boolean', 'json', 'jsonb', 'uuid', 'timestamptz',
  'ilike', 'similar', 'to', 'some', 'any', 'lateral', 'returning',
]);

// Build a case-insensitive lookup from the SQLNamespace
// Returns: { tables: Set<lowercase name>, columns: Map<lowercase table, Set<lowercase col>> }
function buildSchemaLookup(schema: SQLNamespace) {
  const known = new Set<string>(); // all known object names (lowercase)
  const columns = new Map<string, Set<string>>(); // table -> columns (lowercase)

  for (const [schemaName, objects] of Object.entries(schema)) {
    if (!objects || typeof objects !== 'object') continue;
    // Add schema name itself as known (e.g. "dbo")
    known.add(schemaName.toLowerCase());

    for (const [objectName, cols] of Object.entries(objects as Record<string, string[]>)) {
      // Register with and without schema prefix
      const lower = objectName.toLowerCase();
      const full = `${schemaName}.${objectName}`.toLowerCase();
      known.add(lower);
      known.add(full);

      if (Array.isArray(cols) && cols.length > 0) {
        const colSet = new Set(cols.map((c: string) => c.toLowerCase()));
        columns.set(lower, colSet);
        columns.set(full, colSet);
      }
    }
  }

  return { known, columns };
}

// Parse SQL to find table references after FROM/JOIN and column references in SELECT/WHERE/ON
interface IdentifierRef {
  name: string;
  from: number;
  to: number;
  type: 'table' | 'column';
}

function extractIdentifiers(sql: string): IdentifierRef[] {
  const refs: IdentifierRef[] = [];

  // Strip string literals and comments to avoid false matches
  const masked = sql
    .replace(/'[^']*'/g, (m) => ' '.repeat(m.length))
    .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));

  // Table references: FROM/JOIN followed by identifier
  const tableRe = /\b(?:FROM|JOIN)\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))/gi;
  let match;
  while ((match = tableRe.exec(masked)) !== null) {
    const raw = match[1];
    const name = raw.replace(/\[/g, '').replace(/\]/g, '');
    if (!name || name.startsWith('@') || name.startsWith('#')) continue;
    if (SQL_KEYWORDS.has(name.toLowerCase())) continue;
    refs.push({
      name,
      from: match.index + match[0].length - raw.length,
      to: match.index + match[0].length,
      type: 'table',
    });
  }

  // Also catch INSERT INTO, UPDATE, DELETE FROM targets
  const dmlRe = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))/gi;
  while ((match = dmlRe.exec(masked)) !== null) {
    const raw = match[1];
    const name = raw.replace(/\[/g, '').replace(/\]/g, '');
    if (!name || name.startsWith('@') || name.startsWith('#')) continue;
    if (SQL_KEYWORDS.has(name.toLowerCase())) continue;
    refs.push({
      name,
      from: match.index + match[0].length - raw.length,
      to: match.index + match[0].length,
      type: 'table',
    });
  }

  return refs;
}

// Build table alias map from the SQL: alias -> tableName
function buildAliasMap(sql: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const masked = sql
    .replace(/'[^']*'/g, (m) => ' '.repeat(m.length))
    .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));

  // FROM table AS alias, FROM table alias, JOIN table alias
  const aliasRe = /\b(?:FROM|JOIN)\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))\s+(?:AS\s+)?(\[?[\w]+\]?)\b/gi;
  let match;
  while ((match = aliasRe.exec(masked)) !== null) {
    const tableName = match[1].replace(/\[/g, '').replace(/\]/g, '');
    const alias = match[2].replace(/\[/g, '').replace(/\]/g, '');
    if (SQL_KEYWORDS.has(alias.toLowerCase())) continue;
    if (alias.toLowerCase() === 'on' || alias.toLowerCase() === 'where') continue;
    aliases.set(alias.toLowerCase(), tableName.toLowerCase());
  }
  return aliases;
}

export function sqlSemanticLinter(schema: SQLNamespace) {
  const { known, columns } = buildSchemaLookup(schema);

  return linter((view: EditorView): Diagnostic[] => {
    if (known.size === 0) return []; // No schema loaded

    const doc = view.state.doc.toString();
    const diagnostics: Diagnostic[] = [];

    const identifiers = extractIdentifiers(doc);
    const aliasMap = buildAliasMap(doc);

    for (const ref of identifiers) {
      if (ref.type === 'table') {
        const lower = ref.name.toLowerCase();
        const parts = lower.split('.');

        // Check all possible resolutions:
        // 3-part: db.schema.table → try schema.table and table
        // 2-part: schema.table → try schema.table and table
        // 1-part: table → try table
        const candidates = [lower];
        if (parts.length >= 3) candidates.push(parts.slice(1).join('.'), parts[parts.length - 1]);
        if (parts.length >= 2) candidates.push(parts[parts.length - 1]);

        const isKnown = candidates.some((c) => known.has(c)) || aliasMap.has(lower);
        if (!isKnown) {
          diagnostics.push({
            from: ref.from,
            to: ref.to,
            severity: 'warning',
            message: `Unknown object: ${ref.name}`,
          });
        }
      }
    }

    // Syntax checks (run even without schema)
    syntaxCheck(doc, diagnostics);

    return diagnostics;
  }, { delay: 500 });
}

// ── Syntax checks ──

// Common keyword typos → suggested correction
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
  'hvng': 'HAVING', 'havin': 'HAVING', 'havng': 'HAVING',
  'distint': 'DISTINCT', 'distnct': 'DISTINCT', 'distict': 'DISTINCT',
  'valus': 'VALUES', 'vaules': 'VALUES', 'vlues': 'VALUES',
  'crate': 'CREATE', 'creat': 'CREATE', 'craete': 'CREATE',
  'atler': 'ALTER', 'latr': 'ALTER',
  'tabel': 'TABLE', 'tabke': 'TABLE',
  'porcedure': 'PROCEDURE', 'procedur': 'PROCEDURE', 'proceudre': 'PROCEDURE',
  'fuction': 'FUNCTION', 'fucntion': 'FUNCTION', 'funtion': 'FUNCTION',
  'bigin': 'BEGIN', 'begn': 'BEGIN',
  'comit': 'COMMIT', 'commti': 'COMMIT',
  'roolback': 'ROLLBACK', 'rolback': 'ROLLBACK',
  'trasaction': 'TRANSACTION', 'transction': 'TRANSACTION',
  'excec': 'EXEC', 'exce': 'EXEC',
  'declre': 'DECLARE', 'decalre': 'DECLARE', 'delcare': 'DECLARE',
  'retrun': 'RETURN', 'reutrn': 'RETURN',
};

function syntaxCheck(doc: string, diagnostics: Diagnostic[]) {
  // Strip comments and strings for analysis
  const masked = doc
    .replace(/'[^']*'/g, (m) => ' '.repeat(m.length))
    .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));

  // 1. Keyword typo detection
  const wordRe = /\b([a-zA-Z_]\w*)\b/g;
  let match;
  while ((match = wordRe.exec(masked)) !== null) {
    const word = match[1];
    const lower = word.toLowerCase();
    const suggestion = KEYWORD_TYPOS[lower];
    if (suggestion) {
      diagnostics.push({
        from: match.index,
        to: match.index + word.length,
        severity: 'error',
        message: `Did you mean ${suggestion}?`,
      });
    }
  }

  // 2. Unmatched parentheses
  let parenDepth = 0;
  let lastOpenParen = -1;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '(') {
      if (parenDepth === 0) lastOpenParen = i;
      parenDepth++;
    } else if (masked[i] === ')') {
      parenDepth--;
      if (parenDepth < 0) {
        diagnostics.push({
          from: i,
          to: i + 1,
          severity: 'error',
          message: 'Unmatched closing parenthesis',
        });
        parenDepth = 0;
      }
    }
  }
  if (parenDepth > 0 && lastOpenParen >= 0) {
    diagnostics.push({
      from: lastOpenParen,
      to: lastOpenParen + 1,
      severity: 'error',
      message: `Unmatched opening parenthesis (${parenDepth} unclosed)`,
    });
  }

  // 3. Unclosed string literals (check original doc, not masked)
  let inString = false;
  let stringStart = 0;
  for (let i = 0; i < doc.length; i++) {
    // Skip comments
    if (!inString && doc[i] === '-' && doc[i + 1] === '-') {
      while (i < doc.length && doc[i] !== '\n') i++;
      continue;
    }
    if (!inString && doc[i] === '/' && doc[i + 1] === '*') {
      i += 2;
      while (i + 1 < doc.length && !(doc[i] === '*' && doc[i + 1] === '/')) i++;
      i++;
      continue;
    }

    if (doc[i] === '\'') {
      if (inString) {
        // Check for escaped quote ''
        if (i + 1 < doc.length && doc[i + 1] === '\'') { i++; continue; }
        inString = false;
      } else {
        inString = true;
        stringStart = i;
      }
    }
  }
  if (inString) {
    diagnostics.push({
      from: stringStart,
      to: stringStart + 1,
      severity: 'error',
      message: 'Unclosed string literal',
    });
  }
}
