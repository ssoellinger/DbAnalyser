using DbAnalyser.Models.Schema;

namespace DbAnalyser.Models.Relationships;

public class RelationshipMap
{
    public List<ForeignKeyInfo> ExplicitRelationships { get; set; } = [];
    public List<ImplicitRelationship> ImplicitRelationships { get; set; } = [];
    public List<TableDependency> Dependencies { get; set; } = [];
}
