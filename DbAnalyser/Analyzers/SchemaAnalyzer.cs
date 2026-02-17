using System.Data;
using DbAnalyser.Models.Schema;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers;

public class SchemaAnalyzer : IAnalyzer
{
    public string Name => "schema";

    public async Task AnalyzeAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct = default)
    {
        var schema = new DatabaseSchema { DatabaseName = provider.DatabaseName };

        // Bulk-fetch all metadata in parallel
        var allColumnsTask = GetAllColumnsAsync(provider, ct);
        var allIndexesTask = GetAllIndexesAsync(provider, ct);
        var allForeignKeysTask = GetAllForeignKeysAsync(provider, ct);
        var viewsTask = GetAllViewsAsync(provider, ct);
        var sprocsTask = GetStoredProceduresAsync(provider, ct);
        var functionsTask = GetFunctionsAsync(provider, ct);
        var triggersTask = GetTriggersAsync(provider, ct);
        var synonymsTask = GetSynonymsAsync(provider, ct);
        var sequencesTask = GetSequencesAsync(provider, ct);
        var udtsTask = GetUserDefinedTypesAsync(provider, ct);

        await Task.WhenAll(allColumnsTask, allIndexesTask, allForeignKeysTask,
            viewsTask, sprocsTask, functionsTask,
            triggersTask, synonymsTask, sequencesTask, udtsTask);

        var allColumns = await allColumnsTask;
        var allIndexes = await allIndexesTask;
        var allForeignKeys = await allForeignKeysTask;

        // Group into tables
        var tableKeys = allColumns
            .Where(c => c.TableType == "BASE TABLE")
            .Select(c => (c.Schema, c.Table))
            .Distinct()
            .OrderBy(t => t.Schema).ThenBy(t => t.Table);

        schema.Tables = tableKeys.Select(t => new TableInfo(
            t.Schema,
            t.Table,
            allColumns
                .Where(c => c.Schema == t.Schema && c.Table == t.Table && c.TableType == "BASE TABLE")
                .Select(c => c.ToColumnInfo())
                .OrderBy(c => c.OrdinalPosition)
                .ToList(),
            allIndexes.TryGetValue($"{t.Schema}.{t.Table}", out var idxList) ? idxList : [],
            allForeignKeys.TryGetValue($"{t.Schema}.{t.Table}", out var fkList) ? fkList : []
        )).ToList();

        // Build views with their columns
        var viewData = await viewsTask;
        schema.Views = viewData.Select(v => new ViewInfo(
            v.Schema,
            v.Name,
            v.Definition,
            allColumns
                .Where(c => c.Schema == v.Schema && c.Table == v.Name && c.TableType == "VIEW")
                .Select(c => c.ToColumnInfo())
                .OrderBy(c => c.OrdinalPosition)
                .ToList()
        )).ToList();

        schema.StoredProcedures = await sprocsTask;
        schema.Functions = await functionsTask;
        schema.Triggers = await triggersTask;
        schema.Synonyms = await synonymsTask;
        schema.Sequences = await sequencesTask;
        schema.UserDefinedTypes = await udtsTask;
        schema.Jobs = await GetJobsAsync(provider, ct);

        result.Schema = schema;
    }

    private record ColumnRow(
        string Schema, string Table, string TableType,
        string Name, string DataType, int? MaxLength, int? Precision, int? Scale,
        bool IsNullable, bool IsPrimaryKey, bool IsIdentity, bool IsComputed,
        string? DefaultValue, int OrdinalPosition)
    {
        public ColumnInfo ToColumnInfo() => new(
            Name, DataType, MaxLength, Precision, Scale,
            IsNullable, IsPrimaryKey, IsIdentity, IsComputed, DefaultValue, OrdinalPosition);
    }

    private async Task<List<ColumnRow>> GetAllColumnsAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                c.TABLE_SCHEMA,
                c.TABLE_NAME,
                t.TABLE_TYPE,
                c.COLUMN_NAME,
                c.DATA_TYPE,
                c.CHARACTER_MAXIMUM_LENGTH,
                c.NUMERIC_PRECISION,
                c.NUMERIC_SCALE,
                c.IS_NULLABLE,
                c.COLUMN_DEFAULT,
                c.ORDINAL_POSITION,
                CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PRIMARY_KEY,
                COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsIdentity') AS IS_IDENTITY,
                COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsComputed') AS IS_COMPUTED
            FROM INFORMATION_SCHEMA.COLUMNS c
            JOIN INFORMATION_SCHEMA.TABLES t
                ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
            LEFT JOIN (
                SELECT tc.TABLE_SCHEMA, tc.TABLE_NAME, ku.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
                    ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
                    AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
                WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
            ) pk ON c.TABLE_SCHEMA = pk.TABLE_SCHEMA
                AND c.TABLE_NAME = pk.TABLE_NAME
                AND c.COLUMN_NAME = pk.COLUMN_NAME
            ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new ColumnRow(
            Schema: r["TABLE_SCHEMA"].ToString()!,
            Table: r["TABLE_NAME"].ToString()!,
            TableType: r["TABLE_TYPE"].ToString()!,
            Name: r["COLUMN_NAME"].ToString()!,
            DataType: r["DATA_TYPE"].ToString()!,
            MaxLength: r["CHARACTER_MAXIMUM_LENGTH"] as int?,
            Precision: r["NUMERIC_PRECISION"] is DBNull ? null : Convert.ToInt32(r["NUMERIC_PRECISION"]),
            Scale: r["NUMERIC_SCALE"] is DBNull ? null : Convert.ToInt32(r["NUMERIC_SCALE"]),
            IsNullable: r["IS_NULLABLE"].ToString() == "YES",
            IsPrimaryKey: Convert.ToInt32(r["IS_PRIMARY_KEY"]) == 1,
            IsIdentity: Convert.ToInt32(r["IS_IDENTITY"]) == 1,
            IsComputed: Convert.ToInt32(r["IS_COMPUTED"]) == 1,
            DefaultValue: r["COLUMN_DEFAULT"] as string,
            OrdinalPosition: Convert.ToInt32(r["ORDINAL_POSITION"])
        )).ToList();
    }

    private async Task<Dictionary<string, List<IndexInfo>>> GetAllIndexesAsync(
        IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                s.name AS SchemaName,
                t.name AS TableName,
                i.name AS IndexName,
                i.type_desc AS IndexType,
                i.is_unique AS IsUnique,
                CASE WHEN i.type = 1 THEN 1 ELSE 0 END AS IsClustered,
                STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS Columns
            FROM sys.indexes i
            JOIN sys.tables t ON i.object_id = t.object_id
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            WHERE i.name IS NOT NULL
            GROUP BY s.name, t.name, i.name, i.type_desc, i.is_unique, i.type
            ORDER BY s.name, t.name, i.name
            """, ct);

        return data.Rows.Cast<DataRow>()
            .GroupBy(r => $"{r["SchemaName"]}.{r["TableName"]}")
            .ToDictionary(
                g => g.Key,
                g => g.Select(r => new IndexInfo(
                    Name: r["IndexName"].ToString()!,
                    Type: r["IndexType"].ToString()!,
                    IsUnique: Convert.ToBoolean(r["IsUnique"]),
                    IsClustered: Convert.ToInt32(r["IsClustered"]) == 1,
                    Columns: r["Columns"].ToString()!.Split(", ").ToList()
                )).ToList());
    }

    private async Task<Dictionary<string, List<ForeignKeyInfo>>> GetAllForeignKeysAsync(
        IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                fk.name AS FK_NAME,
                OBJECT_SCHEMA_NAME(fk.parent_object_id) AS FromSchema,
                OBJECT_NAME(fk.parent_object_id) AS FromTable,
                cp.name AS FromColumn,
                OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS ToSchema,
                OBJECT_NAME(fk.referenced_object_id) AS ToTable,
                cr.name AS ToColumn,
                fk.delete_referential_action_desc AS DeleteRule,
                fk.update_referential_action_desc AS UpdateRule
            FROM sys.foreign_keys fk
            JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
            JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
            JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
            ORDER BY OBJECT_SCHEMA_NAME(fk.parent_object_id), OBJECT_NAME(fk.parent_object_id), fk.name
            """, ct);

        return data.Rows.Cast<DataRow>()
            .GroupBy(r => $"{r["FromSchema"]}.{r["FromTable"]}")
            .ToDictionary(
                g => g.Key,
                g => g.Select(r => new ForeignKeyInfo(
                    Name: r["FK_NAME"].ToString()!,
                    FromSchema: r["FromSchema"].ToString()!,
                    FromTable: r["FromTable"].ToString()!,
                    FromColumn: r["FromColumn"].ToString()!,
                    ToSchema: r["ToSchema"].ToString()!,
                    ToTable: r["ToTable"].ToString()!,
                    ToColumn: r["ToColumn"].ToString()!,
                    DeleteRule: r["DeleteRule"].ToString()!,
                    UpdateRule: r["UpdateRule"].ToString()!
                )).ToList());
    }

    private record ViewRow(string Schema, string Name, string Definition);

    private async Task<List<ViewRow>> GetAllViewsAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                v.TABLE_SCHEMA,
                v.TABLE_NAME,
                ISNULL(m.definition, '') AS Definition
            FROM INFORMATION_SCHEMA.VIEWS v
            LEFT JOIN sys.sql_modules m
                ON m.object_id = OBJECT_ID(v.TABLE_SCHEMA + '.' + v.TABLE_NAME)
            ORDER BY v.TABLE_SCHEMA, v.TABLE_NAME
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new ViewRow(
            r["TABLE_SCHEMA"].ToString()!,
            r["TABLE_NAME"].ToString()!,
            r["Definition"].ToString()!
        )).ToList();
    }

    private async Task<List<StoredProcedureInfo>> GetStoredProceduresAsync(
        IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                s.name AS SchemaName,
                p.name AS ProcedureName,
                ISNULL(m.definition, '') AS Definition,
                p.modify_date AS LastModified
            FROM sys.procedures p
            JOIN sys.schemas s ON p.schema_id = s.schema_id
            LEFT JOIN sys.sql_modules m ON p.object_id = m.object_id
            WHERE p.is_ms_shipped = 0
            ORDER BY s.name, p.name
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new StoredProcedureInfo(
            SchemaName: r["SchemaName"].ToString()!,
            ProcedureName: r["ProcedureName"].ToString()!,
            Definition: r["Definition"].ToString()!,
            LastModified: r["LastModified"] as DateTime?
        )).ToList();
    }

    private async Task<List<FunctionInfo>> GetFunctionsAsync(
        IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                s.name AS SchemaName,
                o.name AS FunctionName,
                CASE o.type
                    WHEN 'FN' THEN 'Scalar'
                    WHEN 'IF' THEN 'Inline Table'
                    WHEN 'TF' THEN 'Table'
                    ELSE o.type_desc
                END AS FunctionType,
                ISNULL(m.definition, '') AS Definition,
                o.modify_date AS LastModified
            FROM sys.objects o
            JOIN sys.schemas s ON o.schema_id = s.schema_id
            LEFT JOIN sys.sql_modules m ON o.object_id = m.object_id
            WHERE o.type IN ('FN', 'IF', 'TF')
              AND o.is_ms_shipped = 0
            ORDER BY s.name, o.name
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new FunctionInfo(
            SchemaName: r["SchemaName"].ToString()!,
            FunctionName: r["FunctionName"].ToString()!,
            FunctionType: r["FunctionType"].ToString()!,
            Definition: r["Definition"].ToString()!,
            LastModified: r["LastModified"] as DateTime?
        )).ToList();
    }

    private async Task<List<TriggerInfo>> GetTriggersAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                s.name AS SchemaName,
                tr.name AS TriggerName,
                OBJECT_NAME(tr.parent_id) AS ParentTable,
                CASE WHEN tr.is_instead_of_trigger = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END AS TriggerType,
                STUFF((
                    SELECT ', ' + type_desc
                    FROM sys.trigger_events te
                    WHERE te.object_id = tr.object_id
                    FOR XML PATH(''), TYPE
                ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS TriggerEvents,
                CAST(CASE WHEN tr.is_disabled = 0 THEN 1 ELSE 0 END AS BIT) AS IsEnabled,
                ISNULL(m.definition, '') AS Definition
            FROM sys.triggers tr
            JOIN sys.objects o ON tr.parent_id = o.object_id
            JOIN sys.schemas s ON o.schema_id = s.schema_id
            LEFT JOIN sys.sql_modules m ON tr.object_id = m.object_id
            WHERE tr.parent_class = 1
            ORDER BY s.name, OBJECT_NAME(tr.parent_id), tr.name
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new TriggerInfo(
            SchemaName: r["SchemaName"].ToString()!,
            TriggerName: r["TriggerName"].ToString()!,
            ParentTable: r["ParentTable"].ToString()!,
            TriggerType: r["TriggerType"].ToString()!,
            TriggerEvents: r["TriggerEvents"].ToString()!,
            IsEnabled: Convert.ToBoolean(r["IsEnabled"]),
            Definition: r["Definition"].ToString()!
        )).ToList();
    }

    private async Task<List<SynonymInfo>> GetSynonymsAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                s.name AS SchemaName,
                syn.name AS SynonymName,
                syn.base_object_name AS BaseObjectName
            FROM sys.synonyms syn
            JOIN sys.schemas s ON syn.schema_id = s.schema_id
            ORDER BY s.name, syn.name
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new SynonymInfo(
            SchemaName: r["SchemaName"].ToString()!,
            SynonymName: r["SynonymName"].ToString()!,
            BaseObjectName: r["BaseObjectName"].ToString()!
        )).ToList();
    }

    private async Task<List<SequenceInfo>> GetSequencesAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                s.name AS SchemaName,
                seq.name AS SequenceName,
                TYPE_NAME(seq.system_type_id) AS DataType,
                CAST(seq.current_value AS BIGINT) AS CurrentValue,
                CAST(seq.increment AS BIGINT) AS Increment,
                CAST(seq.minimum_value AS BIGINT) AS MinValue,
                CAST(seq.maximum_value AS BIGINT) AS MaxValue,
                seq.is_cycling AS IsCycling
            FROM sys.sequences seq
            JOIN sys.schemas s ON seq.schema_id = s.schema_id
            ORDER BY s.name, seq.name
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new SequenceInfo(
            SchemaName: r["SchemaName"].ToString()!,
            SequenceName: r["SequenceName"].ToString()!,
            DataType: r["DataType"].ToString()!,
            CurrentValue: Convert.ToInt64(r["CurrentValue"]),
            Increment: Convert.ToInt64(r["Increment"]),
            MinValue: Convert.ToInt64(r["MinValue"]),
            MaxValue: Convert.ToInt64(r["MaxValue"]),
            IsCycling: Convert.ToBoolean(r["IsCycling"])
        )).ToList();
    }

    private async Task<List<UserDefinedTypeInfo>> GetUserDefinedTypesAsync(
        IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                s.name AS SchemaName,
                t.name AS TypeName,
                CASE
                    WHEN t.is_table_type = 1 THEN 'table'
                    ELSE TYPE_NAME(t.system_type_id)
                END AS BaseType,
                t.is_table_type AS IsTableType,
                t.is_nullable AS IsNullable,
                t.max_length AS MaxLength
            FROM sys.types t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE t.is_user_defined = 1
            ORDER BY s.name, t.name
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new UserDefinedTypeInfo(
            SchemaName: r["SchemaName"].ToString()!,
            TypeName: r["TypeName"].ToString()!,
            BaseType: r["BaseType"].ToString()!,
            IsTableType: Convert.ToBoolean(r["IsTableType"]),
            IsNullable: Convert.ToBoolean(r["IsNullable"]),
            MaxLength: r["MaxLength"] is DBNull ? null : Convert.ToInt32(r["MaxLength"])
        )).ToList();
    }

    private async Task<List<JobInfo>> GetJobsAsync(IDbProvider provider, CancellationToken ct)
    {
        try
        {
            var dbName = provider.DatabaseName;

            var data = await provider.ExecuteQueryAsync($"""
                SELECT
                    j.name AS JobName,
                    ISNULL(j.description, '') AS Description,
                    j.enabled AS IsEnabled,
                    js.step_id AS StepId,
                    js.step_name AS StepName,
                    js.subsystem AS SubsystemType,
                    ISNULL(js.database_name, '') AS DatabaseName,
                    ISNULL(js.command, '') AS Command,
                    jh.LastRunDate,
                    STUFF((
                        SELECT ', ' + ss.name
                        FROM msdb.dbo.sysjobschedules jsc
                        JOIN msdb.dbo.sysschedules ss ON jsc.schedule_id = ss.schedule_id
                        WHERE jsc.job_id = j.job_id
                        FOR XML PATH(''), TYPE
                    ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS ScheduleDescription
                FROM msdb.dbo.sysjobs j
                JOIN msdb.dbo.sysjobsteps js ON j.job_id = js.job_id
                LEFT JOIN (
                    SELECT job_id, MAX(
                        CAST(CAST(run_date AS VARCHAR) AS DATETIME)
                    ) AS LastRunDate
                    FROM msdb.dbo.sysjobhistory
                    WHERE step_id = 0
                    GROUP BY job_id
                ) jh ON j.job_id = jh.job_id
                WHERE js.database_name = '{dbName}'
                   OR js.command LIKE '%{dbName}%'
                ORDER BY j.name, js.step_id
                """, ct);

            var jobs = new Dictionary<string, (JobInfo Job, List<JobStepInfo> Steps)>(
                StringComparer.OrdinalIgnoreCase);

            foreach (DataRow r in data.Rows)
            {
                var jobName = r["JobName"].ToString()!;
                var step = new JobStepInfo(
                    StepId: Convert.ToInt32(r["StepId"]),
                    StepName: r["StepName"].ToString()!,
                    SubsystemType: r["SubsystemType"].ToString()!,
                    DatabaseName: r["DatabaseName"] is DBNull ? null : r["DatabaseName"].ToString(),
                    Command: r["Command"].ToString()!);

                if (!jobs.TryGetValue(jobName, out var entry))
                {
                    var job = new JobInfo(
                        JobName: jobName,
                        Description: r["Description"].ToString()!,
                        IsEnabled: Convert.ToBoolean(r["IsEnabled"]),
                        Steps: [],
                        LastRunDate: r["LastRunDate"] is DBNull ? null : Convert.ToDateTime(r["LastRunDate"]),
                        ScheduleDescription: r["ScheduleDescription"] is DBNull ? null : r["ScheduleDescription"].ToString());
                    jobs[jobName] = (job, [step]);
                }
                else
                {
                    entry.Steps.Add(step);
                }
            }

            return jobs.Values.Select(e => e.Job with { Steps = e.Steps }).ToList();
        }
        catch
        {
            // msdb not accessible (Azure SQL, permissions, etc.) — skip silently
            return [];
        }
    }
}
