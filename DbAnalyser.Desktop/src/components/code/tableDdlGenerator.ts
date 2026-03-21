import type { TableInfo, ColumnInfo } from '../../api/types';

function formatColumnType(c: ColumnInfo): string {
  let t = c.dataType;
  if (
    c.maxLength !== null &&
    c.maxLength > 0 &&
    !['int', 'bigint', 'bit', 'datetime', 'date', 'float', 'real', 'uniqueidentifier'].includes(c.dataType)
  )
    t += `(${c.maxLength === -1 ? 'max' : c.maxLength})`;
  if (c.precision !== null && c.scale !== null && ['decimal', 'numeric'].includes(c.dataType))
    t += `(${c.precision},${c.scale})`;
  return t;
}

export function generateTableDdl(table: TableInfo): string {
  const lines: string[] = [];
  lines.push(`CREATE TABLE [${table.schemaName}].[${table.tableName}] (`);

  const colLines: string[] = table.columns.map((c) => {
    let line = `    [${c.name}] ${formatColumnType(c).toUpperCase()}`;
    if (c.isIdentity) line += ' IDENTITY';
    if (c.isComputed) line += ' /* computed */';
    else line += c.isNullable ? ' NULL' : ' NOT NULL';
    if (c.defaultValue) line += ` DEFAULT ${c.defaultValue}`;
    return line;
  });

  const pkCols = table.columns.filter((c) => c.isPrimaryKey);
  if (pkCols.length > 0) {
    colLines.push(
      `    CONSTRAINT [PK_${table.tableName}] PRIMARY KEY (${pkCols.map((c) => `[${c.name}]`).join(', ')})`
    );
  }

  lines.push(colLines.join(',\n'));
  lines.push(');');

  if (table.foreignKeys.length > 0) {
    lines.push('');
    for (const fk of table.foreignKeys) {
      lines.push(`ALTER TABLE [${table.schemaName}].[${table.tableName}]`);
      lines.push(`    ADD CONSTRAINT [${fk.name}] FOREIGN KEY ([${fk.fromColumn}])`);
      lines.push(`    REFERENCES [${fk.toSchema}].[${fk.toTable}] ([${fk.toColumn}]);`);
    }
  }

  // Indexes (skip primary key — already in CREATE TABLE)
  const nonPkIndexes = table.indexes.filter((idx) => !idx.isClustered || !idx.isUnique || idx.columns.length !== pkCols.length);
  if (nonPkIndexes.length > 0) {
    lines.push('');
    for (const idx of nonPkIndexes) {
      const unique = idx.isUnique ? 'UNIQUE ' : '';
      const clustered = idx.isClustered ? 'CLUSTERED ' : 'NONCLUSTERED ';
      lines.push(`CREATE ${unique}${clustered}INDEX [${idx.name}]`);
      lines.push(`    ON [${table.schemaName}].[${table.tableName}] (${idx.columns.map((c) => `[${c}]`).join(', ')});`);
    }
  }

  return lines.join('\n');
}
