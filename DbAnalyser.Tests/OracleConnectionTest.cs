using Oracle.ManagedDataAccess.Client;

namespace DbAnalyser.Tests;

public class OracleConnectionTest
{
    [Fact]
    public async Task CanConnect()
    {
        var connStr = "Data Source=localhost:1521/XEPDB1;User Id=testapp;Password=TestPass2025";
        await using var conn = new OracleConnection(connStr);
        await conn.OpenAsync();
        Assert.NotNull(conn.ServerVersion);

        await using var cmd = new OracleCommand("SELECT 'OK' FROM DUAL", conn);
        var result = await cmd.ExecuteScalarAsync();
        Assert.Equal("OK", result?.ToString());
    }
}
