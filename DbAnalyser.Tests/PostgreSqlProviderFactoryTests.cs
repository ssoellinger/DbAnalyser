using DbAnalyser.Providers.PostgreSql;
using Npgsql;

namespace DbAnalyser.Tests;

public class PostgreSqlProviderFactoryTests
{
    private readonly PostgreSqlProviderFactory _factory = new();

    [Fact]
    public void ProviderType_IsPostgresql()
    {
        Assert.Equal("postgresql", _factory.ProviderType);
    }

    [Fact]
    public void DefaultSystemDatabase_IsPostgres()
    {
        Assert.Equal("postgres", _factory.DefaultSystemDatabase);
    }

    [Fact]
    public void NormalizeConnectionString_PreservesHostAndDatabase()
    {
        var input = "Host=localhost;Database=MyDb";

        var normalized = _factory.NormalizeConnectionString(input);

        var builder = new NpgsqlConnectionStringBuilder(normalized);
        Assert.Equal("localhost", builder.Host);
        Assert.Equal("MyDb", builder.Database);
    }

    [Fact]
    public void IsServerMode_NoDatabase_ReturnsTrue()
    {
        Assert.True(_factory.IsServerMode("Host=localhost"));
    }

    [Fact]
    public void IsServerMode_EmptyDatabase_ReturnsTrue()
    {
        Assert.True(_factory.IsServerMode("Host=localhost;Database="));
    }

    [Fact]
    public void IsServerMode_WithDatabase_ReturnsFalse()
    {
        Assert.False(_factory.IsServerMode("Host=localhost;Database=MyDb"));
    }

    [Fact]
    public void SetDatabase_SetsDatabase()
    {
        var result = _factory.SetDatabase("Host=localhost", "MyDb");

        var builder = new NpgsqlConnectionStringBuilder(result);
        Assert.Equal("MyDb", builder.Database);
    }

    [Fact]
    public void SetDatabase_ReplacesExistingDatabase()
    {
        var result = _factory.SetDatabase("Host=localhost;Database=OldDb", "NewDb");

        var builder = new NpgsqlConnectionStringBuilder(result);
        Assert.Equal("NewDb", builder.Database);
    }

    [Fact]
    public void SetDatabase_PreservesOtherProperties()
    {
        var result = _factory.SetDatabase(
            "Host=localhost;Port=5433;Username=admin",
            "MyDb");

        var builder = new NpgsqlConnectionStringBuilder(result);
        Assert.Equal("MyDb", builder.Database);
        Assert.Equal("localhost", builder.Host);
        Assert.Equal(5433, builder.Port);
        Assert.Equal("admin", builder.Username);
    }
}
