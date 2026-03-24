import type { ColumnInfo } from '../../api/types';

const NO_LENGTH_TYPES = new Set(['int', 'bigint', 'smallint', 'tinyint', 'bit', 'datetime', 'datetime2', 'date', 'time', 'float', 'real', 'uniqueidentifier', 'money', 'smallmoney', 'xml', 'image', 'text', 'ntext']);

export function formatColumnType(c: ColumnInfo): string {
  let t = c.dataType;
  if (c.maxLength !== null && (c.maxLength > 0 || c.maxLength === -1) && !NO_LENGTH_TYPES.has(c.dataType.toLowerCase()))
    t += `(${c.maxLength === -1 ? 'max' : c.maxLength})`;
  if (c.precision !== null && c.scale !== null && ['decimal', 'numeric'].includes(c.dataType.toLowerCase()))
    t += `(${c.precision},${c.scale})`;
  return t;
}
