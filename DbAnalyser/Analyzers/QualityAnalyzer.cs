using System.Text.RegularExpressions;
using DbAnalyser.Models.Quality;
using DbAnalyser.Models.Schema;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers;

public partial class QualityAnalyzer : IAnalyzer
{
    public string Name => "quality";

    public Task AnalyzeAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct = default)
    {
        if (result.Schema is null)
            throw new InvalidOperationException("Schema analysis must run before quality analysis.");

        var issues = new List<QualityIssue>();

        foreach (var table in result.Schema.Tables)
        {
            CheckMissingPrimaryKey(table, issues);
            CheckMissingIndexes(table, issues);
            CheckNamingConventions(table, issues);
            CheckWidenColumns(table, issues);
        }

        CheckOrphanedTables(result.Schema.Tables, issues);

        result.QualityIssues = issues;
        return Task.CompletedTask;
    }

    private void CheckMissingPrimaryKey(TableInfo table, List<QualityIssue> issues)
    {
        if (!table.Columns.Any(c => c.IsPrimaryKey))
        {
            issues.Add(new QualityIssue(
                Category: "Design",
                Severity: IssueSeverity.Error,
                ObjectName: table.FullName,
                Description: "Table has no primary key.",
                Recommendation: "Add a primary key to ensure entity integrity and improve query performance."));
        }
    }

    private void CheckMissingIndexes(TableInfo table, List<QualityIssue> issues)
    {
        // Check FK columns that have no index
        foreach (var fk in table.ForeignKeys)
        {
            var hasIndex = table.Indexes.Any(idx =>
                idx.Columns.Count > 0 &&
                string.Equals(idx.Columns[0], fk.FromColumn, StringComparison.OrdinalIgnoreCase));

            if (!hasIndex)
            {
                issues.Add(new QualityIssue(
                    Category: "Performance",
                    Severity: IssueSeverity.Warning,
                    ObjectName: $"{table.FullName}.{fk.FromColumn}",
                    Description: $"Foreign key column '{fk.FromColumn}' has no index.",
                    Recommendation: "Add an index on the FK column to improve JOIN and DELETE performance."));
            }
        }
    }

    private void CheckNamingConventions(TableInfo table, List<QualityIssue> issues)
    {
        // Check for inconsistent casing
        if (MixedCaseRegex().IsMatch(table.TableName) && table.TableName.Contains('_'))
        {
            issues.Add(new QualityIssue(
                Category: "Naming",
                Severity: IssueSeverity.Info,
                ObjectName: table.FullName,
                Description: "Table name mixes PascalCase and snake_case.",
                Recommendation: "Choose a consistent naming convention."));
        }

        foreach (var col in table.Columns)
        {
            // Check for reserved words used as column names
            if (SqlReservedWords.Contains(col.Name.ToUpperInvariant()))
            {
                issues.Add(new QualityIssue(
                    Category: "Naming",
                    Severity: IssueSeverity.Warning,
                    ObjectName: $"{table.FullName}.{col.Name}",
                    Description: $"Column name '{col.Name}' is a SQL reserved word.",
                    Recommendation: "Rename the column to avoid potential issues with queries."));
            }
        }
    }

    private void CheckWidenColumns(TableInfo table, List<QualityIssue> issues)
    {
        foreach (var col in table.Columns)
        {
            if (col.DataType.Equals("nvarchar", StringComparison.OrdinalIgnoreCase) && col.MaxLength == -1)
            {
                issues.Add(new QualityIssue(
                    Category: "Design",
                    Severity: IssueSeverity.Info,
                    ObjectName: $"{table.FullName}.{col.Name}",
                    Description: $"Column uses NVARCHAR(MAX).",
                    Recommendation: "Consider whether a bounded length would be more appropriate."));
            }
        }
    }

    private void CheckOrphanedTables(List<TableInfo> tables, List<QualityIssue> issues)
    {
        var allFkTargets = tables
            .SelectMany(t => t.ForeignKeys)
            .Select(fk => $"{fk.ToSchema}.{fk.ToTable}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var allFkSources = tables
            .Where(t => t.ForeignKeys.Count > 0)
            .Select(t => t.FullName)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var table in tables)
        {
            var isReferenced = allFkTargets.Contains(table.FullName);
            var hasOutgoingFks = allFkSources.Contains(table.FullName);

            if (!isReferenced && !hasOutgoingFks && tables.Count > 1)
            {
                issues.Add(new QualityIssue(
                    Category: "Design",
                    Severity: IssueSeverity.Info,
                    ObjectName: table.FullName,
                    Description: "Table has no foreign key relationships (orphaned).",
                    Recommendation: "Verify this table is intentionally standalone."));
            }
        }
    }

    [GeneratedRegex("[A-Z][a-z]")]
    private static partial Regex MixedCaseRegex();

    private static readonly HashSet<string> SqlReservedWords =
    [
        "SELECT", "INSERT", "UPDATE", "DELETE", "FROM", "WHERE", "ORDER", "GROUP", "BY",
        "TABLE", "INDEX", "VIEW", "CREATE", "ALTER", "DROP", "KEY", "PRIMARY", "FOREIGN",
        "COLUMN", "DATABASE", "SCHEMA", "USER", "ROLE", "GRANT", "REVOKE", "TYPE",
        "NAME", "VALUE", "VALUES", "STATUS", "DATE", "TIME", "TIMESTAMP", "LEVEL",
        "COMMENT", "ACTION", "CONDITION", "RESULT", "FUNCTION", "PROCEDURE"
    ];
}
