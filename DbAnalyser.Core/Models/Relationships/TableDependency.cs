namespace DbAnalyser.Models.Relationships;

public class TableDependency
{
    public string SchemaName { get; set; } = string.Empty;
    public string TableName { get; set; } = string.Empty;
    public string ObjectType { get; set; } = "Table";
    public string? ExternalDatabase { get; set; }
    public bool IsExternal => ExternalDatabase is not null;
    public string FullName => IsExternal ? $"{ExternalDatabase}.{SchemaName}.{TableName}" : $"{SchemaName}.{TableName}";

    /// <summary>Tables this table depends on (this table has FK pointing to them).</summary>
    public List<string> DependsOn { get; set; } = [];

    /// <summary>Tables that depend on this table (they have FK pointing here).</summary>
    public List<string> ReferencedBy { get; set; } = [];

    /// <summary>All tables transitively affected if this table changes.</summary>
    public List<string> TransitiveImpact { get; set; } = [];

    /// <summary>Number of direct inbound + outbound relationships.</summary>
    public int DirectConnections => DependsOn.Count + ReferencedBy.Count;

    /// <summary>Higher = more central to the database.</summary>
    public int ImportanceScore => ReferencedBy.Count * 3 + DependsOn.Count + TransitiveImpact.Count;
}
