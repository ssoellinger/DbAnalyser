using System.Data;

namespace DbAnalyser.Providers.PostgreSql;

public class PostgreSqlCatalogQueries : ICatalogQueries
{
    public async Task<List<ColumnRow>> GetAllColumnsAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                c.table_schema,
                c.table_name,
                t.table_type,
                c.column_name,
                c.data_type,
                c.character_maximum_length,
                c.numeric_precision,
                c.numeric_scale,
                c.is_nullable,
                c.column_default,
                c.ordinal_position,
                CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key,
                CASE WHEN c.column_default LIKE 'nextval(%' THEN 1
                     WHEN c.is_identity = 'YES' THEN 1
                     ELSE 0 END AS is_identity,
                CASE WHEN c.is_generated = 'ALWAYS' THEN 1 ELSE 0 END AS is_computed
            FROM information_schema.columns c
            JOIN information_schema.tables t
                ON c.table_schema = t.table_schema AND c.table_name = t.table_name
            LEFT JOIN (
                SELECT tc.table_schema, tc.table_name, ku.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage ku
                    ON tc.constraint_name = ku.constraint_name
                    AND tc.table_schema = ku.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
            ) pk ON c.table_schema = pk.table_schema
                AND c.table_name = pk.table_name
                AND c.column_name = pk.column_name
            WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY c.table_schema, c.table_name, c.ordinal_position
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new ColumnRow(
            Schema: r["table_schema"].ToString()!,
            Table: r["table_name"].ToString()!,
            TableType: r["table_type"].ToString()! == "BASE TABLE" ? "BASE TABLE" : "VIEW",
            Name: r["column_name"].ToString()!,
            DataType: r["data_type"].ToString()!,
            MaxLength: r["character_maximum_length"] is DBNull ? null : Convert.ToInt32(r["character_maximum_length"]),
            Precision: r["numeric_precision"] is DBNull ? null : Convert.ToInt32(r["numeric_precision"]),
            Scale: r["numeric_scale"] is DBNull ? null : Convert.ToInt32(r["numeric_scale"]),
            IsNullable: r["is_nullable"].ToString() == "YES",
            IsPrimaryKey: Convert.ToInt32(r["is_primary_key"]) == 1,
            IsIdentity: Convert.ToInt32(r["is_identity"]) == 1,
            IsComputed: Convert.ToInt32(r["is_computed"]) == 1,
            DefaultValue: r["column_default"] as string,
            OrdinalPosition: Convert.ToInt32(r["ordinal_position"])
        )).ToList();
    }

    public async Task<List<IndexRow>> GetAllIndexesAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                n.nspname AS schema_name,
                t.relname AS table_name,
                i.relname AS index_name,
                am.amname AS index_type,
                ix.indisunique AS is_unique,
                CASE WHEN ix.indisclustered THEN true ELSE false END AS is_clustered,
                string_agg(a.attname, ', ' ORDER BY array_position(ix.indkey, a.attnum)) AS columns
            FROM pg_index ix
            JOIN pg_class i ON ix.indexrelid = i.oid
            JOIN pg_class t ON ix.indrelid = t.oid
            JOIN pg_namespace n ON t.relnamespace = n.oid
            JOIN pg_am am ON i.relam = am.oid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND i.relname IS NOT NULL
            GROUP BY n.nspname, t.relname, i.relname, am.amname, ix.indisunique, ix.indisclustered
            ORDER BY n.nspname, t.relname, i.relname
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new IndexRow(
            SchemaName: r["schema_name"].ToString()!,
            TableName: r["table_name"].ToString()!,
            IndexName: r["index_name"].ToString()!,
            IndexType: r["index_type"].ToString()!,
            IsUnique: Convert.ToBoolean(r["is_unique"]),
            IsClustered: Convert.ToBoolean(r["is_clustered"]),
            Columns: r["columns"].ToString()!
        )).ToList();
    }

    public async Task<List<ForeignKeyRow>> GetAllForeignKeysAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                rc.constraint_name AS fk_name,
                kcu1.table_schema AS from_schema,
                kcu1.table_name AS from_table,
                kcu1.column_name AS from_column,
                kcu2.table_schema AS to_schema,
                kcu2.table_name AS to_table,
                kcu2.column_name AS to_column,
                rc.delete_rule,
                rc.update_rule
            FROM information_schema.referential_constraints rc
            JOIN information_schema.key_column_usage kcu1
                ON rc.constraint_name = kcu1.constraint_name
                AND rc.constraint_schema = kcu1.constraint_schema
            JOIN information_schema.key_column_usage kcu2
                ON rc.unique_constraint_name = kcu2.constraint_name
                AND rc.unique_constraint_schema = kcu2.constraint_schema
                AND kcu1.ordinal_position = kcu2.ordinal_position
            WHERE kcu1.table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY kcu1.table_schema, kcu1.table_name, rc.constraint_name
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new ForeignKeyRow(
            FkName: r["fk_name"].ToString()!,
            FromSchema: r["from_schema"].ToString()!,
            FromTable: r["from_table"].ToString()!,
            FromColumn: r["from_column"].ToString()!,
            ToSchema: r["to_schema"].ToString()!,
            ToTable: r["to_table"].ToString()!,
            ToColumn: r["to_column"].ToString()!,
            DeleteRule: r["delete_rule"].ToString()!,
            UpdateRule: r["update_rule"].ToString()!
        )).ToList();
    }

    public async Task<List<ViewRow>> GetAllViewsAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                v.table_schema,
                v.table_name,
                COALESCE(pg_get_viewdef(c.oid, true), '') AS definition
            FROM information_schema.views v
            JOIN pg_class c ON c.relname = v.table_name
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = v.table_schema
            WHERE v.table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY v.table_schema, v.table_name
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new ViewRow(
            r["table_schema"].ToString()!,
            r["table_name"].ToString()!,
            r["definition"].ToString()!
        )).ToList();
    }

    public async Task<List<StoredProcRow>> GetStoredProceduresAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                n.nspname AS schema_name,
                p.proname AS procedure_name,
                COALESCE(pg_get_functiondef(p.oid), '') AS definition,
                NULL AS last_modified
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE p.prokind = 'p'
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY n.nspname, p.proname
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new StoredProcRow(
            SchemaName: r["schema_name"].ToString()!,
            ProcedureName: r["procedure_name"].ToString()!,
            Definition: r["definition"].ToString()!,
            LastModified: r["last_modified"] is DBNull ? null : Convert.ToDateTime(r["last_modified"])
        )).ToList();
    }

    public async Task<List<FunctionRow>> GetFunctionsAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                n.nspname AS schema_name,
                p.proname AS function_name,
                CASE p.proretset
                    WHEN true THEN 'Set-Returning'
                    ELSE 'Scalar'
                END AS function_type,
                COALESCE(pg_get_functiondef(p.oid), '') AS definition,
                NULL AS last_modified
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE p.prokind = 'f'
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY n.nspname, p.proname
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new FunctionRow(
            SchemaName: r["schema_name"].ToString()!,
            FunctionName: r["function_name"].ToString()!,
            FunctionType: r["function_type"].ToString()!,
            Definition: r["definition"].ToString()!,
            LastModified: r["last_modified"] is DBNull ? null : Convert.ToDateTime(r["last_modified"])
        )).ToList();
    }

    public async Task<List<TriggerRow>> GetTriggersAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                t.trigger_schema AS schema_name,
                t.trigger_name,
                t.event_object_table AS parent_table,
                t.action_timing AS trigger_type,
                string_agg(t.event_manipulation, ', ' ORDER BY t.event_manipulation) AS trigger_events,
                true AS is_enabled,
                COALESCE(pg_get_triggerdef(pg_trigger.oid), '') AS definition
            FROM information_schema.triggers t
            JOIN pg_trigger ON pg_trigger.tgname = t.trigger_name
            JOIN pg_class c ON c.oid = pg_trigger.tgrelid AND c.relname = t.event_object_table
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.trigger_schema
            WHERE t.trigger_schema NOT IN ('pg_catalog', 'information_schema')
              AND NOT pg_trigger.tgisinternal
            GROUP BY t.trigger_schema, t.trigger_name, t.event_object_table,
                     t.action_timing, pg_trigger.oid
            ORDER BY t.trigger_schema, t.event_object_table, t.trigger_name
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new TriggerRow(
            SchemaName: r["schema_name"].ToString()!,
            TriggerName: r["trigger_name"].ToString()!,
            ParentTable: r["parent_table"].ToString()!,
            TriggerType: r["trigger_type"].ToString()!,
            TriggerEvents: r["trigger_events"].ToString()!,
            IsEnabled: Convert.ToBoolean(r["is_enabled"]),
            Definition: r["definition"].ToString()!
        )).ToList();
    }

    public Task<List<SynonymRow>> GetSynonymsAsync(IDbProvider provider, CancellationToken ct) =>
        Task.FromResult<List<SynonymRow>>([]);

    public async Task<List<SequenceRow>> GetSequencesAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                s.sequence_schema AS schema_name,
                s.sequence_name,
                s.data_type,
                COALESCE(s.start_value::bigint, 0) AS current_value,
                COALESCE(s.increment::bigint, 1) AS increment,
                COALESCE(s.minimum_value::bigint, 0) AS min_value,
                COALESCE(s.maximum_value::bigint, 0) AS max_value,
                s.cycle_option = 'YES' AS is_cycling
            FROM information_schema.sequences s
            WHERE s.sequence_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY s.sequence_schema, s.sequence_name
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new SequenceRow(
            SchemaName: r["schema_name"].ToString()!,
            SequenceName: r["sequence_name"].ToString()!,
            DataType: r["data_type"].ToString()!,
            CurrentValue: Convert.ToInt64(r["current_value"]),
            Increment: Convert.ToInt64(r["increment"]),
            MinValue: Convert.ToInt64(r["min_value"]),
            MaxValue: Convert.ToInt64(r["max_value"]),
            IsCycling: Convert.ToBoolean(r["is_cycling"])
        )).ToList();
    }

    public async Task<List<UdtRow>> GetUserDefinedTypesAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT
                n.nspname AS schema_name,
                t.typname AS type_name,
                CASE t.typtype
                    WHEN 'c' THEN 'composite'
                    WHEN 'e' THEN 'enum'
                    ELSE t.typtype::text
                END AS base_type,
                false AS is_table_type,
                true AS is_nullable,
                NULL AS max_length
            FROM pg_type t
            JOIN pg_namespace n ON t.typnamespace = n.oid
            WHERE t.typtype IN ('c', 'e')
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND NOT EXISTS (
                  SELECT 1 FROM pg_class c
                  WHERE c.reltype = t.oid AND c.relkind IN ('r', 'v', 'm', 'p')
              )
            ORDER BY n.nspname, t.typname
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new UdtRow(
            SchemaName: r["schema_name"].ToString()!,
            TypeName: r["type_name"].ToString()!,
            BaseType: r["base_type"].ToString()!,
            IsTableType: Convert.ToBoolean(r["is_table_type"]),
            IsNullable: Convert.ToBoolean(r["is_nullable"]),
            MaxLength: r["max_length"] is DBNull ? null : Convert.ToInt32(r["max_length"])
        )).ToList();
    }

    public Task<List<JobRow>> GetJobsAsync(IDbProvider provider, string databaseName, CancellationToken ct) =>
        Task.FromResult<List<JobRow>>([]);

    public async Task<List<ObjectDependencyRow>> GetObjectDependenciesAsync(IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT DISTINCT
                src_ns.nspname AS from_schema,
                src_cl.relname AS from_name,
                CASE src_cl.relkind
                    WHEN 'v' THEN 'View'
                    WHEN 'r' THEN 'Table'
                    WHEN 'm' THEN 'Materialized View'
                    ELSE 'Other'
                END AS from_type,
                dep_ns.nspname AS to_schema,
                dep_cl.relname AS to_name,
                CASE dep_cl.relkind
                    WHEN 'r' THEN 'Table'
                    WHEN 'v' THEN 'View'
                    WHEN 'm' THEN 'Materialized View'
                    ELSE 'Other'
                END AS to_type,
                NULL AS to_database
            FROM pg_depend d
            JOIN pg_rewrite rw ON d.objid = rw.oid
            JOIN pg_class src_cl ON rw.ev_class = src_cl.oid
            JOIN pg_namespace src_ns ON src_cl.relnamespace = src_ns.oid
            JOIN pg_class dep_cl ON d.refobjid = dep_cl.oid
            JOIN pg_namespace dep_ns ON dep_cl.relnamespace = dep_ns.oid
            WHERE d.classid = 'pg_rewrite'::regclass
              AND d.deptype = 'n'
              AND src_cl.oid <> dep_cl.oid
              AND src_ns.nspname NOT IN ('pg_catalog', 'information_schema')
              AND dep_ns.nspname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY from_schema, from_name, to_schema, to_name
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new ObjectDependencyRow(
            FromSchema: r["from_schema"].ToString()!,
            FromName: r["from_name"].ToString()!,
            FromType: r["from_type"].ToString()!,
            ToSchema: r["to_schema"].ToString()!,
            ToName: r["to_name"].ToString()!,
            ToType: r["to_type"].ToString()!,
            ToDatabase: r["to_database"] is DBNull ? null : r["to_database"].ToString()
        )).ToList();
    }

    public string BuildCountSql(string schema, string table) =>
        $"SELECT COUNT(*) FROM \"{schema}\".\"{table}\"";

    public string BuildColumnProfileSql(string schema, string table, string column, bool canMinMax) =>
        canMinMax
            ? $"""
               SELECT
                   SUM(CASE WHEN "{column}" IS NULL THEN 1 ELSE 0 END) AS "NullCount",
                   COUNT(DISTINCT "{column}") AS "DistinctCount",
                   CAST(MIN("{column}") AS VARCHAR(500)) AS "MinVal",
                   CAST(MAX("{column}") AS VARCHAR(500)) AS "MaxVal"
               FROM "{schema}"."{table}"
               """
            : $"""
               SELECT
                   SUM(CASE WHEN "{column}" IS NULL THEN 1 ELSE 0 END) AS "NullCount",
                   COUNT(DISTINCT "{column}") AS "DistinctCount",
                   NULL AS "MinVal",
                   NULL AS "MaxVal"
               FROM "{schema}"."{table}"
               """;

    public string BuildNullCountSql(string schema, string table, string column) =>
        $"SELECT COUNT(*) FROM \"{schema}\".\"{table}\" WHERE \"{column}\" IS NULL";
}
