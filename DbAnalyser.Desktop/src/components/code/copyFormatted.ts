/**
 * Copies SQL code to the clipboard as formatted HTML with syntax highlighting.
 * Falls back to plain text if the clipboard API doesn't support HTML.
 */

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'ON', 'AS', 'SET',
  'NULL', 'IS', 'BY', 'ORDER', 'GROUP', 'HAVING', 'JOIN', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'CROSS', 'INTO', 'INSERT', 'UPDATE', 'DELETE', 'CREATE',
  'ALTER', 'DROP', 'TABLE', 'VIEW', 'PROCEDURE', 'PROC', 'FUNCTION', 'BEGIN',
  'END', 'IF', 'ELSE', 'WHILE', 'RETURN', 'DECLARE', 'EXEC', 'EXECUTE',
  'THEN', 'WHEN', 'CASE', 'WITH', 'VALUES', 'GO', 'USE', 'PRINT', 'TOP',
  'DISTINCT', 'EXISTS', 'BETWEEN', 'LIKE', 'UNION', 'ALL', 'ANY', 'SOME',
  'ASC', 'DESC', 'INDEX', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
  'CONSTRAINT', 'DEFAULT', 'IDENTITY', 'NOLOCK', 'OUTPUT', 'OVER',
  'PARTITION', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'TRIGGER', 'AFTER',
  'INSTEAD', 'OF', 'FOR', 'EACH', 'CURSOR', 'OPEN', 'CLOSE', 'DEALLOCATE',
  'FETCH', 'NEXT', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'TRAN', 'TRY',
  'CATCH', 'THROW', 'RAISERROR', 'MERGE', 'USING', 'MATCHED', 'WHEN',
  'COALESCE', 'ISNULL', 'CAST', 'CONVERT', 'VARCHAR', 'NVARCHAR', 'INT',
  'BIGINT', 'BIT', 'DATETIME', 'DATE', 'FLOAT', 'DECIMAL', 'NUMERIC',
  'CHAR', 'NCHAR', 'TEXT', 'NTEXT', 'UNIQUEIDENTIFIER', 'VARBINARY',
  'NOT', 'ADD', 'SCHEMA',
]);

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightSql(code: string): string {
  const lines = code.split('\n');
  const htmlLines: string[] = [];

  for (const line of lines) {
    let html = '';
    let i = 0;

    while (i < line.length) {
      // Single-line comment
      if (line[i] === '-' && line[i + 1] === '-') {
        html += `<span style="color:#666;font-style:italic">${esc(line.slice(i))}</span>`;
        i = line.length;
        continue;
      }

      // String literal
      if (line[i] === "'") {
        let end = i + 1;
        while (end < line.length) {
          if (line[end] === "'" && line[end + 1] === "'") { end += 2; continue; }
          if (line[end] === "'") { end++; break; }
          end++;
        }
        html += `<span style="color:#f0a500">${esc(line.slice(i, end))}</span>`;
        i = end;
        continue;
      }

      // Number
      if (/\d/.test(line[i]) && (i === 0 || /[\s,=(]/.test(line[i - 1]))) {
        let end = i;
        while (end < line.length && /[\d.]/.test(line[end])) end++;
        html += `<span style="color:#e94560">${esc(line.slice(i, end))}</span>`;
        i = end;
        continue;
      }

      // Word (keyword or identifier)
      if (/[A-Za-z_@#]/.test(line[i])) {
        let end = i;
        while (end < line.length && /[\w@#]/.test(line[end])) end++;
        const word = line.slice(i, end);

        if (word.startsWith('@')) {
          html += `<span style="color:#4fc3f7">${esc(word)}</span>`;
        } else if (SQL_KEYWORDS.has(word.toUpperCase())) {
          html += `<span style="color:#bb86fc">${esc(word)}</span>`;
        } else {
          html += esc(word);
        }
        i = end;
        continue;
      }

      html += esc(line[i]);
      i++;
    }

    htmlLines.push(html);
  }

  return htmlLines.join('\n');
}

export async function copyAsFormatted(code: string): Promise<boolean> {
  const highlighted = highlightSql(code);
  const html = `<pre style="font-family:Consolas,Monaco,'Courier New',monospace;font-size:13px;background:#12121a;color:#e0e0e0;padding:12px 16px;border-radius:6px;line-height:1.5">${highlighted}</pre>`;

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([code], { type: 'text/plain' }),
      }),
    ]);
    return true;
  } catch {
    // Fallback to plain text
    try {
      await navigator.clipboard.writeText(code);
      return true;
    } catch {
      return false;
    }
  }
}
