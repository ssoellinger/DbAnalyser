import type { TableInfo, ColumnInfo, JobInfo, SequenceInfo, UserDefinedTypeInfo, SynonymInfo } from '../../api/types';

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

export function generateJobDdl(job: JobInfo): string {
  const lines: string[] = [];

  lines.push(`-- SQL Server Agent Job: ${job.jobName}`);
  lines.push(`-- Status: ${job.isEnabled ? 'Enabled' : 'DISABLED'}`);
  if (job.description) lines.push(`-- Description: ${job.description}`);
  if (job.scheduleDescription) lines.push(`-- Schedule: ${job.scheduleDescription}`);
  if (job.lastRunDate) lines.push(`-- Last Run: ${job.lastRunDate}`);
  lines.push('');

  lines.push(`EXEC msdb.dbo.sp_add_job`);
  lines.push(`    @job_name = N'${job.jobName}',`);
  if (job.description) lines.push(`    @description = N'${job.description}',`);
  lines.push(`    @enabled = ${job.isEnabled ? '1' : '0'};`);
  lines.push('GO');

  for (const step of job.steps) {
    lines.push('');
    lines.push(`-- Step ${step.stepId}: ${step.stepName}`);
    lines.push(`-- Subsystem: ${step.subsystemType}${step.databaseName ? ` | Database: ${step.databaseName}` : ''}`);
    lines.push(`EXEC msdb.dbo.sp_add_jobstep`);
    lines.push(`    @job_name = N'${job.jobName}',`);
    lines.push(`    @step_id = ${step.stepId},`);
    lines.push(`    @step_name = N'${step.stepName}',`);
    lines.push(`    @subsystem = N'${step.subsystemType}',`);
    if (step.databaseName) lines.push(`    @database_name = N'${step.databaseName}',`);
    lines.push(`    @command = N'`);

    // Indent the command for readability
    const cmdLines = step.command.split('\n');
    for (const cl of cmdLines) {
      lines.push(`        ${cl}`);
    }
    lines.push(`    ';`);
    lines.push('GO');
  }

  return lines.join('\n');
}

export function generateSequenceDdl(seq: SequenceInfo): string {
  const lines: string[] = [];
  lines.push(`CREATE SEQUENCE [${seq.schemaName}].[${seq.sequenceName}]`);
  lines.push(`    AS ${seq.dataType}`);
  lines.push(`    START WITH ${seq.currentValue}`);
  lines.push(`    INCREMENT BY ${seq.increment}`);
  lines.push(`    MINVALUE ${seq.minValue}`);
  lines.push(`    MAXVALUE ${seq.maxValue}`);
  lines.push(`    ${seq.isCycling ? 'CYCLE' : 'NO CYCLE'};`);
  return lines.join('\n');
}

export function generateUdtDdl(udt: UserDefinedTypeInfo): string {
  if (udt.isTableType) {
    return `-- Table Type: ${udt.fullName}\nCREATE TYPE [${udt.schemaName}].[${udt.typeName}] AS TABLE (\n    -- columns defined in system catalog\n);`;
  }
  let typeDef = udt.baseType;
  if (udt.maxLength !== null && udt.maxLength > 0) {
    typeDef += `(${udt.maxLength === -1 ? 'max' : udt.maxLength})`;
  }
  return `CREATE TYPE [${udt.schemaName}].[${udt.typeName}]\n    FROM ${typeDef.toUpperCase()} ${udt.isNullable ? 'NULL' : 'NOT NULL'};`;
}

export function generateSynonymDdl(syn: SynonymInfo): string {
  return `-- Synonym: ${syn.fullName}\n-- Points to: ${syn.baseObjectName}\n\nCREATE SYNONYM [${syn.schemaName}].[${syn.synonymName}]\n    FOR ${syn.baseObjectName};`;
}
