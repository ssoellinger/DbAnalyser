using System.Data;

namespace DbAnalyser.Providers.PostgreSql;

public class PostgreSqlServerQueries : IServerQueries
{
    public async Task<List<string>> EnumerateDatabasesAsync(IDbProvider provider, CancellationToken ct)
    {
        const string sql = """
            SELECT datname FROM pg_database
            WHERE datistemplate = false
              AND datname NOT IN ('postgres')
            ORDER BY datname
            """;

        var table = await provider.ExecuteQueryAsync(sql, ct);
        return table.Rows.Cast<DataRow>()
            .Select(r => r["datname"].ToString()!)
            .ToList();
    }

    public async Task<(DateTime? StartTime, int? UptimeDays)> GetServerUptimeAsync(IDbProvider provider, CancellationToken ct)
    {
        try
        {
            var startTime = await provider.ExecuteScalarAsync(
                "SELECT pg_postmaster_start_time()", ct);

            if (startTime is DateTime st)
            {
                var uptimeDays = (int)(DateTime.UtcNow - st).TotalDays;
                return (st, uptimeDays);
            }
        }
        catch
        {
            // pg_postmaster_start_time may not be accessible
        }

        return (null, null);
    }
}
