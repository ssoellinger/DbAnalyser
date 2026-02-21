using System.Data;
using DbAnalyser.Models.Indexing;

namespace DbAnalyser.Providers.PostgreSql;

public class PostgreSqlPerformanceQueries : IPerformanceQueries
{
    public async Task<List<IndexInventoryItem>> GetIndexInventoryAsync(IDbProvider provider, CancellationToken ct)
    {
        const string sql = """
            SELECT
                n.nspname AS schema_name,
                t.relname AS table_name,
                i.relname AS index_name,
                am.amname AS index_type,
                ix.indisunique AS is_unique,
                CASE WHEN ix.indisclustered THEN true ELSE false END AS is_clustered,
                string_agg(a.attname, ', ' ORDER BY array_position(ix.indkey, a.attnum)) AS columns,
                COALESCE(s.idx_scan, 0) AS idx_scan,
                pg_relation_size(i.oid) / 1024 AS size_kb
            FROM pg_index ix
            JOIN pg_class i ON ix.indexrelid = i.oid
            JOIN pg_class t ON ix.indrelid = t.oid
            JOIN pg_namespace n ON t.relnamespace = n.oid
            JOIN pg_am am ON i.relam = am.oid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.oid
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND i.relname IS NOT NULL
            GROUP BY n.nspname, t.relname, i.relname, am.amname, ix.indisunique,
                     ix.indisclustered, s.idx_scan, i.oid
            ORDER BY n.nspname, t.relname, i.relname
            """;

        try
        {
            var dt = await provider.ExecuteQueryAsync(sql, ct);
            return dt.Rows.Cast<DataRow>().Select(row => new IndexInventoryItem(
                SchemaName: row["schema_name"]?.ToString() ?? "public",
                TableName: row["table_name"]?.ToString() ?? "",
                IndexName: row["index_name"]?.ToString() ?? "",
                IndexType: row["index_type"]?.ToString() ?? "",
                IsUnique: Convert.ToBoolean(row["is_unique"]),
                IsClustered: Convert.ToBoolean(row["is_clustered"]),
                Columns: row["columns"]?.ToString() ?? "",
                UserSeeks: 0,
                UserScans: Convert.ToInt64(row["idx_scan"]),
                UserLookups: 0,
                UserUpdates: 0,
                SizeKB: Convert.ToInt64(row["size_kb"])
            )).ToList();
        }
        catch
        {
            return [];
        }
    }

    public Task<List<MissingIndexRow>> GetMissingIndexesAsync(IDbProvider provider, CancellationToken ct) =>
        Task.FromResult<List<MissingIndexRow>>([]);

    public async Task<List<TableUsageRow>> GetTableUsageStatsAsync(IDbProvider provider, CancellationToken ct)
    {
        const string sql = """
            SELECT
                schemaname AS schema_name,
                relname AS table_name,
                COALESCE(seq_scan, 0) + COALESCE(idx_scan, 0) AS total_reads,
                COALESCE(n_tup_ins, 0) + COALESCE(n_tup_upd, 0) + COALESCE(n_tup_del, 0) AS total_writes,
                last_seq_scan AS last_scan,
                last_idx_scan AS last_seek
            FROM pg_stat_user_tables
            ORDER BY schemaname, relname
            """;

        try
        {
            var table = await provider.ExecuteQueryAsync(sql, ct);
            return table.Rows.Cast<DataRow>().Select(r => new TableUsageRow(
                SchemaName: r["schema_name"]?.ToString() ?? "public",
                TableName: r["table_name"]?.ToString() ?? "",
                TotalReads: Convert.ToInt64(r["total_reads"]),
                TotalWrites: Convert.ToInt64(r["total_writes"]),
                LastSeek: r["last_seek"] is DBNull ? null : Convert.ToDateTime(r["last_seek"]),
                LastScan: r["last_scan"] is DBNull ? null : Convert.ToDateTime(r["last_scan"]),
                LastLookup: null
            )).ToList();
        }
        catch
        {
            return [];
        }
    }

    public Task<List<ProcUsageRow>> GetProcExecutionStatsAsync(IDbProvider provider, CancellationToken ct) =>
        Task.FromResult<List<ProcUsageRow>>([]);

    public Task<List<FuncUsageRow>> GetFunctionExecutionStatsAsync(IDbProvider provider, CancellationToken ct) =>
        Task.FromResult<List<FuncUsageRow>>([]);

    public Task<bool> IsQueryStoreEnabledAsync(IDbProvider provider, CancellationToken ct) =>
        Task.FromResult(false);

    public Task<List<QsProcRow>> GetQueryStoreProcStatsAsync(IDbProvider provider, CancellationToken ct) =>
        Task.FromResult<List<QsProcRow>>([]);

    public Task<List<QsTextRow>> GetQueryStoreTopQueriesAsync(IDbProvider provider, int topN, CancellationToken ct) =>
        Task.FromResult<List<QsTextRow>>([]);
}
