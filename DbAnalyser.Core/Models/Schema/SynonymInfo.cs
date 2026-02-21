namespace DbAnalyser.Models.Schema;

public record SynonymInfo(
    string SchemaName,
    string SynonymName,
    string BaseObjectName)
{
    public string? DatabaseName { get; init; }
    public string FullName => DatabaseName is not null
        ? $"{DatabaseName}.{SchemaName}.{SynonymName}"
        : $"{SchemaName}.{SynonymName}";

    /// <summary>Parse the base object to extract database, schema, name parts.</summary>
    public (string? Database, string Schema, string Name) ParseBaseObject()
    {
        var clean = BaseObjectName.Replace("[", "").Replace("]", "");
        var parts = clean.Split('.');
        return parts.Length switch
        {
            >= 4 => (parts[^3], parts[^2], parts[^1]), // server.db.schema.name or db.schema.name
            3 => (parts[0], parts[1], parts[2]),
            2 => (null, parts[0], parts[1]),
            _ => (null, "dbo", parts[0])
        };
    }
}
