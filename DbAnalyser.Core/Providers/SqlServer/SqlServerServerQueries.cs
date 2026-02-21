using System.Data;

namespace DbAnalyser.Providers.SqlServer;

public class SqlServerServerQueries : IServerQueries
{
    public async Task<List<string>> EnumerateDatabasesAsync(IDbProvider provider, CancellationToken ct)
    {
        const string sql = """
            SELECT name FROM sys.databases
            WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
              AND state_desc = 'ONLINE'
            ORDER BY name
            """;

        var table = await provider.ExecuteQueryAsync(sql, ct);
        return table.Rows.Cast<DataRow>()
            .Select(r => r["name"].ToString()!)
            .ToList();
    }

    public async Task<(DateTime? StartTime, int? UptimeDays)> GetServerUptimeAsync(IDbProvider provider, CancellationToken ct)
    {
        try
        {
            var startTime = await provider.ExecuteScalarAsync(
                "SELECT sqlserver_start_time FROM sys.dm_os_sys_info", ct);

            if (startTime is DateTime st)
            {
                var uptimeDays = (int)(DateTime.UtcNow - st).TotalDays;
                return (st, uptimeDays);
            }
        }
        catch
        {
            // DMV may not be accessible
        }

        return (null, null);
    }
}
