using DbAnalyser.Providers;
using NSubstitute;

namespace DbAnalyser.Tests;

public class ProviderRegistryTests
{
    private static IProviderBundle CreateMockBundle(string providerType)
    {
        var bundle = Substitute.For<IProviderBundle>();
        bundle.ProviderType.Returns(providerType);
        return bundle;
    }

    [Fact]
    public void GetBundle_ExistingProvider_ReturnsBundle()
    {
        var bundle = CreateMockBundle("sqlserver");
        var registry = new ProviderRegistry([bundle]);

        var result = registry.GetBundle("sqlserver");

        Assert.Same(bundle, result);
    }

    [Fact]
    public void GetBundle_CaseInsensitive()
    {
        var bundle = CreateMockBundle("sqlserver");
        var registry = new ProviderRegistry([bundle]);

        var result = registry.GetBundle("SqlServer");

        Assert.Same(bundle, result);
    }

    [Fact]
    public void GetBundle_UnknownProvider_Throws()
    {
        var bundle = CreateMockBundle("sqlserver");
        var registry = new ProviderRegistry([bundle]);

        var ex = Assert.Throws<ArgumentException>(() => registry.GetBundle("postgresql"));

        Assert.Contains("Unknown provider type", ex.Message);
        Assert.Contains("postgresql", ex.Message);
        Assert.Contains("sqlserver", ex.Message);
    }

    [Fact]
    public void AvailableProviders_ReturnsAllRegistered()
    {
        var sql = CreateMockBundle("sqlserver");
        var pg = CreateMockBundle("postgresql");
        var registry = new ProviderRegistry([sql, pg]);

        var providers = registry.AvailableProviders;

        Assert.Contains("sqlserver", providers);
        Assert.Contains("postgresql", providers);
        Assert.Equal(2, providers.Count);
    }

    [Fact]
    public void AvailableProviders_NoBundles_ReturnsEmpty()
    {
        var registry = new ProviderRegistry([]);

        Assert.Empty(registry.AvailableProviders);
    }

    [Fact]
    public void MultipleProviders_EachResolvesCorrectly()
    {
        var sql = CreateMockBundle("sqlserver");
        var pg = CreateMockBundle("postgresql");
        var registry = new ProviderRegistry([sql, pg]);

        Assert.Same(sql, registry.GetBundle("sqlserver"));
        Assert.Same(pg, registry.GetBundle("postgresql"));
    }
}
