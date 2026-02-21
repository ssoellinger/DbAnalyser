using DbAnalyser.Providers.SqlServer;
using Microsoft.Data.SqlClient;

namespace DbAnalyser.Tests;

public class SqlServerProviderFactoryTests
{
    private readonly SqlServerProviderFactory _factory = new();

    [Fact]
    public void ProviderType_IsSqlServer()
    {
        Assert.Equal("sqlserver", _factory.ProviderType);
    }

    [Fact]
    public void DefaultSystemDatabase_IsMaster()
    {
        Assert.Equal("master", _factory.DefaultSystemDatabase);
    }

    [Fact]
    public void NormalizeConnectionString_AddsMars()
    {
        var input = "Server=localhost;Database=MyDb";

        var normalized = _factory.NormalizeConnectionString(input);

        var builder = new SqlConnectionStringBuilder(normalized);
        Assert.True(builder.MultipleActiveResultSets);
    }

    [Fact]
    public void NormalizeConnectionString_PreservesExistingMars()
    {
        var input = "Server=localhost;Database=MyDb;MultipleActiveResultSets=True";

        var normalized = _factory.NormalizeConnectionString(input);

        var builder = new SqlConnectionStringBuilder(normalized);
        Assert.True(builder.MultipleActiveResultSets);
    }

    [Fact]
    public void NormalizeConnectionString_PreservesServerAndDatabase()
    {
        var input = "Server=myserver;Database=MyDb";

        var normalized = _factory.NormalizeConnectionString(input);

        var builder = new SqlConnectionStringBuilder(normalized);
        Assert.Equal("myserver", builder.DataSource);
        Assert.Equal("MyDb", builder.InitialCatalog);
    }

    [Fact]
    public void IsServerMode_NoCatalog_ReturnsTrue()
    {
        Assert.True(_factory.IsServerMode("Server=localhost"));
    }

    [Fact]
    public void IsServerMode_EmptyCatalog_ReturnsTrue()
    {
        Assert.True(_factory.IsServerMode("Server=localhost;Initial Catalog="));
    }

    [Fact]
    public void IsServerMode_WithCatalog_ReturnsFalse()
    {
        Assert.False(_factory.IsServerMode("Server=localhost;Initial Catalog=MyDb"));
    }

    [Fact]
    public void IsServerMode_WithDatabase_ReturnsFalse()
    {
        Assert.False(_factory.IsServerMode("Server=localhost;Database=MyDb"));
    }

    [Fact]
    public void SetDatabase_SetsInitialCatalog()
    {
        var result = _factory.SetDatabase("Server=localhost", "MyDb");

        var builder = new SqlConnectionStringBuilder(result);
        Assert.Equal("MyDb", builder.InitialCatalog);
    }

    [Fact]
    public void SetDatabase_ReplacesExistingCatalog()
    {
        var result = _factory.SetDatabase("Server=localhost;Initial Catalog=OldDb", "NewDb");

        var builder = new SqlConnectionStringBuilder(result);
        Assert.Equal("NewDb", builder.InitialCatalog);
    }

    [Fact]
    public void SetDatabase_PreservesOtherProperties()
    {
        var result = _factory.SetDatabase(
            "Server=localhost;Trusted_Connection=true;Encrypt=true",
            "MyDb");

        var builder = new SqlConnectionStringBuilder(result);
        Assert.Equal("MyDb", builder.InitialCatalog);
        Assert.True(builder.IntegratedSecurity);
        Assert.True(builder.Encrypt);
    }
}
