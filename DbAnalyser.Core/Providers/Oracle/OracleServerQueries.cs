using System.Data;

namespace DbAnalyser.Providers.Oracle;

public class OracleServerQueries : IServerQueries
{
    public async Task<List<string>> EnumerateDatabasesAsync(IDbProvider provider, CancellationToken ct)
    {
        // Oracle "databases" are schemas — list accessible user schemas
        var data = await provider.ExecuteQueryAsync("""
            SELECT USERNAME
            FROM ALL_USERS
            WHERE USERNAME NOT IN ('SYS','SYSTEM','DBSNMP','OUTLN','DIP','ORACLE_OCM','APPQOSSYS',
                'WMSYS','XDB','CTXSYS','ANONYMOUS','MDSYS','OLAPSYS','ORDDATA','ORDPLUGINS',
                'ORDSYS','SI_INFORMTN_SCHEMA','LBACSYS','DVSYS','AUDSYS','GSMADMIN_INTERNAL',
                'OJVMSYS','DVF','REMOTE_SCHEDULER_AGENT','DBSFWUSER','GSMCATUSER','GSMUSER',
                'SYSBACKUP','SYSDG','SYSKM','SYSRAC','SYS$UMF','XS$NULL','GGSHAREDCAP')
            ORDER BY USERNAME
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => r["USERNAME"].ToString()!).ToList();
    }

    public async Task<(DateTime? StartTime, int? UptimeDays)> GetServerUptimeAsync(IDbProvider provider, CancellationToken ct)
    {
        try
        {
            var startTime = await provider.ExecuteScalarAsync("SELECT STARTUP_TIME FROM V$INSTANCE", ct);
            if (startTime is DateTime dt)
            {
                var uptime = (DateTime.UtcNow - dt).Days;
                return (dt, uptime);
            }
        }
        catch
        {
            // V$INSTANCE requires privileges — return null
        }

        return (null, null);
    }
}
