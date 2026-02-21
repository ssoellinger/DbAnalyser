namespace DbAnalyser.Providers;

/// <summary>Resolves provider bundles by type name (e.g. "sqlserver", "postgresql").</summary>
public class ProviderRegistry
{
    private readonly Dictionary<string, IProviderBundle> _bundles;

    public ProviderRegistry(IEnumerable<IProviderBundle> bundles)
    {
        _bundles = bundles.ToDictionary(b => b.ProviderType, StringComparer.OrdinalIgnoreCase);
    }

    public IProviderBundle GetBundle(string providerType)
    {
        if (_bundles.TryGetValue(providerType, out var bundle))
            return bundle;

        throw new ArgumentException(
            $"Unknown provider type '{providerType}'. Available: {string.Join(", ", _bundles.Keys)}");
    }

    public IReadOnlyCollection<string> AvailableProviders => _bundles.Keys;
}
