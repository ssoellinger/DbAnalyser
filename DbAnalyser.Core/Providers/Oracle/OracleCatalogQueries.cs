using System.Data;

namespace DbAnalyser.Providers.Oracle;

public class OracleCatalogQueries : ICatalogQueries
{
    // Exclude Oracle system schemas
    private const string SchemaFilter = @"
        AND t.OWNER NOT IN ('SYS','SYSTEM','DBSNMP','OUTLN','DIP','ORACLE_OCM','APPQOSSYS',
            'WMSYS','XDB','CTXSYS','ANONYMOUS','MDSYS','OLAPSYS','ORDDATA','ORDPLUGINS',
            'ORDSYS','SI_INFORMTN_SCHEMA','LBACSYS','DVSYS','AUDSYS','GSMADMIN_INTERNAL',
            'OJVMSYS','DVF','REMOTE_SCHEDULER_AGENT','DBSFWUSER','GSMCATUSER','GSMUSER',
            'SYSBACKUP','SYSDG','SYSKM','SYSRAC','SYS$UMF','XS$NULL','GGSHAREDCAP')";

    private static string EscapeIdentifier(string name) => $"\"{name}\"";

    public async Task<List<ColumnRow>> GetAllColumnsAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync($"""
            SELECT
                t.OWNER AS SchemaName,
                t.TABLE_NAME AS TableName,
                ao.OBJECT_TYPE AS ObjectType,
                t.COLUMN_NAME AS ColumnName,
                t.DATA_TYPE AS DataType,
                t.DATA_LENGTH AS MaxLength,
                t.DATA_PRECISION AS Precision,
                t.DATA_SCALE AS Scale,
                CASE WHEN t.NULLABLE = 'Y' THEN 1 ELSE 0 END AS IsNullable,
                CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IsPrimaryKey,
                0 AS IsIdentity,
                0 AS IsComputed,
                t.DATA_DEFAULT AS DefaultValue,
                t.COLUMN_ID AS OrdinalPosition
            FROM ALL_TAB_COLUMNS t
            JOIN ALL_OBJECTS ao ON t.OWNER = ao.OWNER AND t.TABLE_NAME = ao.OBJECT_NAME AND ao.OBJECT_TYPE IN ('TABLE', 'VIEW')
            LEFT JOIN (
                SELECT ac.OWNER, ac.TABLE_NAME, acc.COLUMN_NAME
                FROM ALL_CONSTRAINTS ac
                JOIN ALL_CONS_COLUMNS acc ON ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME AND ac.OWNER = acc.OWNER
                WHERE ac.CONSTRAINT_TYPE = 'P'
            ) pk ON t.OWNER = pk.OWNER AND t.TABLE_NAME = pk.TABLE_NAME AND t.COLUMN_NAME = pk.COLUMN_NAME
            WHERE 1=1
            {SchemaFilter.Replace("t.OWNER", "t.OWNER")}
            ORDER BY t.OWNER, t.TABLE_NAME, t.COLUMN_ID
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new ColumnRow(
            Schema: r["SchemaName"].ToString()!,
            Table: r["TableName"].ToString()!,
            TableType: r["ObjectType"].ToString()! == "VIEW" ? "VIEW" : "BASE TABLE",
            Name: r["ColumnName"].ToString()!,
            DataType: r["DataType"].ToString()!,
            MaxLength: r["MaxLength"] is DBNull ? null : Convert.ToInt32(r["MaxLength"]),
            Precision: r["Precision"] is DBNull ? null : Convert.ToInt32(r["Precision"]),
            Scale: r["Scale"] is DBNull ? null : Convert.ToInt32(r["Scale"]),
            IsNullable: Convert.ToInt32(r["IsNullable"]) == 1,
            IsPrimaryKey: Convert.ToInt32(r["IsPrimaryKey"]) == 1,
            IsIdentity: Convert.ToInt32(r["IsIdentity"]) == 1,
            IsComputed: Convert.ToInt32(r["IsComputed"]) == 1,
            DefaultValue: r["DefaultValue"] is DBNull ? null : r["DefaultValue"].ToString()?.Trim(),
            OrdinalPosition: r["OrdinalPosition"] is DBNull ? 0 : Convert.ToInt32(r["OrdinalPosition"])
        )).ToList();
    }

    public async Task<List<IndexRow>> GetAllIndexesAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync($"""
            SELECT
                i.TABLE_OWNER AS SchemaName,
                i.TABLE_NAME AS TableName,
                i.INDEX_NAME AS IndexName,
                i.INDEX_TYPE AS IndexType,
                CASE WHEN i.UNIQUENESS = 'UNIQUE' THEN 1 ELSE 0 END AS IsUnique,
                LISTAGG(ic.COLUMN_NAME, ', ') WITHIN GROUP (ORDER BY ic.COLUMN_POSITION) AS Columns
            FROM ALL_INDEXES i
            JOIN ALL_IND_COLUMNS ic ON i.INDEX_NAME = ic.INDEX_NAME AND i.OWNER = ic.INDEX_OWNER
            WHERE 1=1
            {SchemaFilter.Replace("t.OWNER", "i.TABLE_OWNER")}
            GROUP BY i.TABLE_OWNER, i.TABLE_NAME, i.INDEX_NAME, i.INDEX_TYPE, i.UNIQUENESS
            ORDER BY i.TABLE_OWNER, i.TABLE_NAME, i.INDEX_NAME
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new IndexRow(
            SchemaName: r["SchemaName"].ToString()!,
            TableName: r["TableName"].ToString()!,
            IndexName: r["IndexName"].ToString()!,
            IndexType: r["IndexType"].ToString()!,
            IsUnique: Convert.ToInt32(r["IsUnique"]) == 1,
            IsClustered: false,
            Columns: r["Columns"].ToString()!
        )).ToList();
    }

    public async Task<List<ForeignKeyRow>> GetAllForeignKeysAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync($"""
            SELECT
                ac.OWNER AS FromSchema,
                ac.TABLE_NAME AS FromTable,
                acc_from.COLUMN_NAME AS FromColumn,
                ac_ref.OWNER AS ToSchema,
                ac_ref.TABLE_NAME AS ToTable,
                acc_to.COLUMN_NAME AS ToColumn,
                ac.CONSTRAINT_NAME AS FkName,
                ac.DELETE_RULE AS DeleteRule
            FROM ALL_CONSTRAINTS ac
            JOIN ALL_CONS_COLUMNS acc_from ON ac.CONSTRAINT_NAME = acc_from.CONSTRAINT_NAME AND ac.OWNER = acc_from.OWNER
            JOIN ALL_CONSTRAINTS ac_ref ON ac.R_CONSTRAINT_NAME = ac_ref.CONSTRAINT_NAME AND ac.R_OWNER = ac_ref.OWNER
            JOIN ALL_CONS_COLUMNS acc_to ON ac_ref.CONSTRAINT_NAME = acc_to.CONSTRAINT_NAME AND ac_ref.OWNER = acc_to.OWNER
                AND acc_from.POSITION = acc_to.POSITION
            WHERE ac.CONSTRAINT_TYPE = 'R'
            {SchemaFilter.Replace("t.OWNER", "ac.OWNER")}
            ORDER BY ac.OWNER, ac.TABLE_NAME, ac.CONSTRAINT_NAME
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new ForeignKeyRow(
            FkName: r["FkName"].ToString()!,
            FromSchema: r["FromSchema"].ToString()!,
            FromTable: r["FromTable"].ToString()!,
            FromColumn: r["FromColumn"].ToString()!,
            ToSchema: r["ToSchema"].ToString()!,
            ToTable: r["ToTable"].ToString()!,
            ToColumn: r["ToColumn"].ToString()!,
            DeleteRule: r["DeleteRule"]?.ToString() ?? "NO ACTION",
            UpdateRule: "NO ACTION" // Oracle doesn't support ON UPDATE CASCADE
        )).ToList();
    }

    public async Task<List<ViewRow>> GetAllViewsAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync($"""
            SELECT
                v.OWNER AS SchemaName,
                v.VIEW_NAME AS ViewName,
                v.TEXT AS Definition
            FROM ALL_VIEWS v
            WHERE 1=1
            {SchemaFilter.Replace("t.OWNER", "v.OWNER")}
            ORDER BY v.OWNER, v.VIEW_NAME
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => {
            var schema = r["SchemaName"].ToString()!;
            var name = r["ViewName"].ToString()!;
            var body = r["Definition"]?.ToString()?.Trim() ?? "";
            var definition = string.IsNullOrEmpty(body)
                ? $"-- No definition available for {schema}.{name}"
                : $"CREATE OR REPLACE VIEW \"{schema}\".\"{name}\" AS\n{body}";
            return new ViewRow(Schema: schema, Name: name, Definition: definition);
        }).ToList();
    }

    public async Task<List<StoredProcRow>> GetStoredProceduresAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync($"""
            SELECT
                p.OWNER AS SchemaName,
                p.OBJECT_NAME AS ProcName,
                o.LAST_DDL_TIME AS LastModified
            FROM ALL_PROCEDURES p
            JOIN ALL_OBJECTS o ON p.OBJECT_NAME = o.OBJECT_NAME AND p.OWNER = o.OWNER AND o.OBJECT_TYPE = 'PROCEDURE'
            WHERE p.OBJECT_TYPE = 'PROCEDURE'
            {SchemaFilter.Replace("t.OWNER", "p.OWNER")}
            ORDER BY p.OWNER, p.OBJECT_NAME
            """, ct);

        var procs = new List<StoredProcRow>();
        foreach (DataRow r in data.Rows)
        {
            var schema = r["SchemaName"].ToString()!;
            var name = r["ProcName"].ToString()!;
            var modified = r["LastModified"] is DBNull ? null : (DateTime?)Convert.ToDateTime(r["LastModified"]);

            // Get source code from ALL_SOURCE
            string definition;
            try
            {
                var srcData = await provider.ExecuteQueryAsync(
                    $"SELECT TEXT FROM ALL_SOURCE WHERE OWNER = '{schema.Replace("'", "''")}' AND NAME = '{name.Replace("'", "''")}' AND TYPE = 'PROCEDURE' ORDER BY LINE", ct);
                definition = string.Join("", srcData.Rows.Cast<DataRow>().Select(sr => sr["TEXT"].ToString()));
                if (string.IsNullOrWhiteSpace(definition))
                    definition = $"-- No source available for {schema}.{name}";
            }
            catch
            {
                definition = $"-- Unable to retrieve source for {schema}.{name}";
            }

            procs.Add(new StoredProcRow(SchemaName: schema, ProcedureName: name, Definition: definition, LastModified: modified));
        }
        return procs;
    }

    public async Task<List<FunctionRow>> GetFunctionsAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync($"""
            SELECT
                p.OWNER AS SchemaName,
                p.OBJECT_NAME AS FuncName,
                'FUNCTION' AS FuncType,
                o.LAST_DDL_TIME AS LastModified
            FROM ALL_PROCEDURES p
            JOIN ALL_OBJECTS o ON p.OBJECT_NAME = o.OBJECT_NAME AND p.OWNER = o.OWNER AND o.OBJECT_TYPE = 'FUNCTION'
            WHERE p.OBJECT_TYPE = 'FUNCTION'
            {SchemaFilter.Replace("t.OWNER", "p.OWNER")}
            ORDER BY p.OWNER, p.OBJECT_NAME
            """, ct);

        var funcs = new List<FunctionRow>();
        foreach (DataRow r in data.Rows)
        {
            var schema = r["SchemaName"].ToString()!;
            var name = r["FuncName"].ToString()!;
            var modified = r["LastModified"] is DBNull ? null : (DateTime?)Convert.ToDateTime(r["LastModified"]);

            string definition;
            try
            {
                var srcData = await provider.ExecuteQueryAsync(
                    $"SELECT TEXT FROM ALL_SOURCE WHERE OWNER = '{schema.Replace("'", "''")}' AND NAME = '{name.Replace("'", "''")}' AND TYPE = 'FUNCTION' ORDER BY LINE", ct);
                definition = string.Join("", srcData.Rows.Cast<DataRow>().Select(sr => sr["TEXT"].ToString()));
                if (string.IsNullOrWhiteSpace(definition))
                    definition = $"-- No source available for {schema}.{name}";
            }
            catch
            {
                definition = $"-- Unable to retrieve source for {schema}.{name}";
            }

            funcs.Add(new FunctionRow(SchemaName: schema, FunctionName: name, FunctionType: "FUNCTION", Definition: definition, LastModified: modified));
        }
        return funcs;
    }

    public async Task<List<TriggerRow>> GetTriggersAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync($"""
            SELECT
                t.OWNER AS SchemaName,
                t.TRIGGER_NAME AS TriggerName,
                t.TABLE_OWNER AS ParentSchema,
                t.TABLE_NAME AS ParentTable,
                t.TRIGGER_TYPE AS TriggerType,
                t.TRIGGERING_EVENT AS TriggerEvents,
                CASE WHEN t.STATUS = 'ENABLED' THEN 1 ELSE 0 END AS IsEnabled,
                t.TRIGGER_BODY AS Definition
            FROM ALL_TRIGGERS t
            WHERE 1=1
            {SchemaFilter}
            ORDER BY t.OWNER, t.TRIGGER_NAME
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new TriggerRow(
            SchemaName: r["SchemaName"].ToString()!,
            TriggerName: r["TriggerName"].ToString()!,
            ParentTable: $"{r["ParentSchema"]}.{r["ParentTable"]}",
            TriggerType: r["TriggerType"].ToString()!,
            TriggerEvents: r["TriggerEvents"].ToString()!,
            IsEnabled: Convert.ToInt32(r["IsEnabled"]) == 1,
            Definition: r["Definition"]?.ToString() ?? ""
        )).ToList();
    }

    public async Task<List<SynonymRow>> GetSynonymsAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync($"""
            SELECT
                s.OWNER AS SchemaName,
                s.SYNONYM_NAME AS SynonymName,
                CASE WHEN s.TABLE_OWNER IS NOT NULL THEN s.TABLE_OWNER || '.' ELSE '' END || s.TABLE_NAME AS BaseObjectName
            FROM ALL_SYNONYMS s
            WHERE s.OWNER NOT IN ('SYS','SYSTEM','PUBLIC')
            ORDER BY s.OWNER, s.SYNONYM_NAME
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new SynonymRow(
            SchemaName: r["SchemaName"].ToString()!,
            SynonymName: r["SynonymName"].ToString()!,
            BaseObjectName: r["BaseObjectName"].ToString()!
        )).ToList();
    }

    public async Task<List<SequenceRow>> GetSequencesAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync($"""
            SELECT
                s.SEQUENCE_OWNER AS SchemaName,
                s.SEQUENCE_NAME AS SequenceName,
                'NUMBER' AS DataType,
                s.LAST_NUMBER AS CurrentValue,
                s.INCREMENT_BY AS IncrementBy,
                s.MIN_VALUE AS MinValue,
                s.MAX_VALUE AS MaxValue,
                CASE WHEN s.CYCLE_FLAG = 'Y' THEN 1 ELSE 0 END AS IsCycling
            FROM ALL_SEQUENCES s
            WHERE 1=1
            {SchemaFilter.Replace("t.OWNER", "s.SEQUENCE_OWNER")}
            ORDER BY s.SEQUENCE_OWNER, s.SEQUENCE_NAME
            """, ct);

        // Oracle NUMBER can hold up to 38 digits but SequenceRow uses long (max 19 digits).
        // Oracle's default MAX_VALUE for sequences is 10^28 which overflows Int64.
        // We cap at long.MaxValue — consider changing SequenceRow.MaxValue to decimal if exact values are needed.
        return data.Rows.Cast<DataRow>().Select(r => {
            long SafeToLong(object val, long fallback) {
                if (val is DBNull) return fallback;
                try { return Convert.ToInt64(val); }
                catch { return fallback; }
            }
            return new SequenceRow(
                SchemaName: r["SchemaName"].ToString()!,
                SequenceName: r["SequenceName"].ToString()!,
                DataType: "NUMBER",
                CurrentValue: SafeToLong(r["CurrentValue"], 0),
                Increment: SafeToLong(r["IncrementBy"], 1),
                MinValue: SafeToLong(r["MinValue"], 0),
                MaxValue: SafeToLong(r["MaxValue"], long.MaxValue),
                IsCycling: Convert.ToInt32(r["IsCycling"]) == 1
            );
        }).ToList();
    }

    public Task<List<UdtRow>> GetUserDefinedTypesAsync(IDbProvider provider, CancellationToken ct)
    {
        // MVP: return empty — Oracle types are complex (object types, collections, etc.)
        return Task.FromResult(new List<UdtRow>());
    }

    public Task<List<JobRow>> GetJobsAsync(IDbProvider provider, string databaseName, CancellationToken ct)
    {
        // MVP: return empty — DBMS_SCHEDULER requires DBA privileges
        return Task.FromResult(new List<JobRow>());
    }

    public async Task<List<ObjectDependencyRow>> GetObjectDependenciesAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync($"""
            SELECT
                d.OWNER AS FromSchema,
                d.NAME AS FromName,
                d.TYPE AS FromType,
                d.REFERENCED_OWNER AS ToSchema,
                d.REFERENCED_NAME AS ToName,
                d.REFERENCED_TYPE AS ToType
            FROM ALL_DEPENDENCIES d
            WHERE d.REFERENCED_OWNER != d.OWNER OR d.REFERENCED_NAME != d.NAME
            {SchemaFilter.Replace("t.OWNER", "d.OWNER")}
            ORDER BY d.OWNER, d.NAME
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r =>
        {
            var fromType = MapOracleObjectType(r["FromType"].ToString()!);
            var toType = MapOracleObjectType(r["ToType"].ToString()!);
            return new ObjectDependencyRow(
                FromSchema: r["FromSchema"].ToString()!,
                FromName: r["FromName"].ToString()!,
                FromType: fromType,
                ToSchema: r["ToSchema"].ToString()!,
                ToName: r["ToName"].ToString()!,
                ToType: toType,
                ToDatabase: null
            );
        }).ToList();
    }

    private static string MapOracleObjectType(string oracleType) => oracleType switch
    {
        "TABLE" => "Table",
        "VIEW" => "View",
        "PROCEDURE" => "Procedure",
        "FUNCTION" => "Function",
        "TRIGGER" => "Trigger",
        "PACKAGE" => "Procedure",
        "PACKAGE BODY" => "Procedure",
        "SYNONYM" => "Synonym",
        "SEQUENCE" => "Sequence",
        "TYPE" => "Type",
        _ => "Table"
    };

    public string BuildCountSql(string schema, string table)
        => $"SELECT COUNT(*) FROM {EscapeIdentifier(schema)}.{EscapeIdentifier(table)}";

    public string BuildColumnProfileSql(string schema, string table, string column, bool canMinMax)
    {
        var minMax = canMinMax
            ? $"CAST(MIN({EscapeIdentifier(column)}) AS VARCHAR2(500)) AS MinVal, CAST(MAX({EscapeIdentifier(column)}) AS VARCHAR2(500)) AS MaxVal"
            : "NULL AS MinVal, NULL AS MaxVal";

        return $"""
            SELECT
                COUNT(DISTINCT {EscapeIdentifier(column)}) AS DistinctCount,
                {minMax}
            FROM {EscapeIdentifier(schema)}.{EscapeIdentifier(table)}
            """;
    }

    public string BuildNullCountSql(string schema, string table, string column)
        => $"SELECT COUNT(*) FROM {EscapeIdentifier(schema)}.{EscapeIdentifier(table)} WHERE {EscapeIdentifier(column)} IS NULL";
}
