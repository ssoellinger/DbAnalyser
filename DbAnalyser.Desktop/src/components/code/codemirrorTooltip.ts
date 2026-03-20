import { EditorView, hoverTooltip, type Tooltip } from '@codemirror/view';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import type { ColumnInfo } from '../../api/types';

/** Info returned by the tooltip resolver */
export interface TooltipInfo {
  objectType: string;
  fullName: string;
  columns?: ColumnInfo[];
  functionType?: string;
  definition?: string; // first few lines for peek
}

const IDENTIFIER_RE =
  /(?:\[[\w\s]+\]\.\[[\w\s]+\]|[A-Za-z_][\w]*\.[A-Za-z_][\w]*|\[[\w\s]+\]|[A-Za-z_][\w]+)/g;

/**
 * Creates a CM6 hover tooltip extension.
 * Shows column list for tables/views, or a code peek for procedures/functions.
 */
export function hoverTooltipExtension(
  resolveTooltip: (text: string) => TooltipInfo | null,
) {
  return hoverTooltip((view: EditorView, pos: number, side: number): Tooltip | null => {
    const line = view.state.doc.lineAt(pos);
    const lineText = line.text;
    const lineOffset = pos - line.from;

    IDENTIFIER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IDENTIFIER_RE.exec(lineText)) !== null) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      if (lineOffset >= matchStart && lineOffset <= matchEnd) {
        const info = resolveTooltip(match[0]);
        if (info) {
          return {
            pos: line.from + matchStart,
            end: line.from + matchEnd,
            above: true,
            create() {
              const dom = document.createElement('div');
              dom.className = 'cm-sql-tooltip';
              dom.innerHTML = buildTooltipHtml(info);
              return { dom };
            },
          };
        }
      }
    }

    return null;
  }, { hoverTime: 300 });
}

function buildTooltipHtml(info: TooltipInfo): string {
  const color = OBJECT_TYPE_COLORS[info.objectType] ?? '#666';
  let html = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">`;
  html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>`;
  html += `<strong style="color:#e0e0e0">${escHtml(info.fullName)}</strong>`;
  html += `<span style="color:#888;font-size:10px">${escHtml(info.objectType)}</span>`;
  if (info.functionType) {
    html += `<span style="color:#888;font-size:10px">(${escHtml(info.functionType)})</span>`;
  }
  html += `</div>`;

  // Columns for tables/views
  if (info.columns && info.columns.length > 0) {
    html += `<div style="font-size:11px;color:#888;margin-bottom:2px">${info.columns.length} column${info.columns.length !== 1 ? 's' : ''}</div>`;
    html += `<table style="border-collapse:collapse;font-size:11px;width:100%">`;
    const maxCols = Math.min(info.columns.length, 12);
    for (let i = 0; i < maxCols; i++) {
      const col = info.columns[i];
      const badges: string[] = [];
      if (col.isPrimaryKey) badges.push('<span style="color:#4fc3f7;font-size:9px;padding:0 2px;background:#4fc3f720;border-radius:2px">PK</span>');
      if (col.isIdentity) badges.push('<span style="color:#bb86fc;font-size:9px;padding:0 2px;background:#bb86fc20;border-radius:2px">ID</span>');
      html += `<tr style="color:#ccc">`;
      html += `<td style="padding:1px 8px 1px 0;white-space:nowrap">${escHtml(col.name)} ${badges.join(' ')}</td>`;
      html += `<td style="padding:1px 0;color:#888;white-space:nowrap">${escHtml(formatType(col))}</td>`;
      html += `<td style="padding:1px 0 1px 8px;color:#666;font-size:10px">${col.isNullable ? 'NULL' : 'NOT NULL'}</td>`;
      html += `</tr>`;
    }
    html += `</table>`;
    if (info.columns.length > maxCols) {
      html += `<div style="color:#666;font-size:10px;margin-top:2px">... ${info.columns.length - maxCols} more</div>`;
    }
  }

  // Code peek for procs/functions/triggers
  if (info.definition && (info.objectType === 'Procedure' || info.objectType === 'Function' || info.objectType === 'Trigger')) {
    const lines = info.definition.split('\n').slice(0, 6);
    html += `<pre style="margin:4px 0 0;padding:4px 6px;background:#0a0a0f;border-radius:3px;font-size:10px;color:#888;overflow:hidden;white-space:pre;max-width:400px">${escHtml(lines.join('\n'))}</pre>`;
    if (info.definition.split('\n').length > 6) {
      html += `<div style="color:#666;font-size:10px">... ${info.definition.split('\n').length} lines total</div>`;
    }
  }

  return html;
}

function formatType(col: ColumnInfo): string {
  let t = col.dataType;
  if (col.maxLength !== null && col.maxLength > 0 && !['int', 'bigint', 'bit', 'datetime', 'date', 'float', 'real', 'uniqueidentifier'].includes(col.dataType))
    t += `(${col.maxLength === -1 ? 'max' : col.maxLength})`;
  if (col.precision !== null && col.scale !== null && ['decimal', 'numeric'].includes(col.dataType))
    t += `(${col.precision},${col.scale})`;
  return t;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
