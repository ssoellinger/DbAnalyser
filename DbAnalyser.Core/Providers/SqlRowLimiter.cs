using System.Text.RegularExpressions;

namespace DbAnalyser.Providers;

/// <summary>
/// Injects TOP (SQL Server) or LIMIT (PostgreSQL) into SELECT queries
/// so the database engine can optimize and stop early.
/// </summary>
public static partial class SqlRowLimiter
{
    [GeneratedRegex(@"\bTOP\s*[\(\d]", RegexOptions.IgnoreCase)]
    private static partial Regex HasTopRegex();

    [GeneratedRegex(@"\bLIMIT\s+\d", RegexOptions.IgnoreCase)]
    private static partial Regex HasLimitRegex();

    // Detect non-SELECT statements
    [GeneratedRegex(@"^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXEC|EXECUTE|SET|USE|BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|MERGE|TRUNCATE)\b", RegexOptions.IgnoreCase)]
    private static partial Regex NonSelectRegex();

    // Strip leading SQL comments (-- line comments and /* block comments */) and whitespace
    [GeneratedRegex(@"^(\s*(--[^\r\n]*[\r\n]*|/\*[\s\S]*?\*/\s*))*", RegexOptions.Singleline)]
    private static partial Regex LeadingCommentsRegex();

    /// <summary>
    /// Strip leading whitespace and SQL comments to find the actual first statement.
    /// Returns the position in the original string where the real SQL starts.
    /// </summary>
    private static int SkipLeadingComments(string sql)
    {
        var match = LeadingCommentsRegex().Match(sql);
        return match.Success ? match.Length : 0;
    }

    /// <summary>
    /// Inject TOP(n) into a SQL Server SELECT query.
    /// Returns the original SQL unchanged if it's not a simple SELECT or already has TOP.
    /// </summary>
    public static string ApplyTopForSqlServer(string sql, int maxRows)
    {
        if (maxRows <= 0 || maxRows == int.MaxValue) return sql;

        // Already has TOP
        if (HasTopRegex().IsMatch(sql)) return sql;

        // Find where the real SQL starts (skip comments)
        var codeStart = SkipLeadingComments(sql);
        var codePart = sql[codeStart..];

        // Skip non-SELECT statements
        if (NonSelectRegex().IsMatch(codePart)) return sql;

        // Must start with SELECT
        var selectMatch = Regex.Match(codePart, @"^SELECT(\s+(?:ALL|DISTINCT))?\s+", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        if (!selectMatch.Success) return sql;

        // Find insertion point after SELECT [ALL|DISTINCT]
        var insertOffset = codeStart + "SELECT".Length;
        if (selectMatch.Groups[1].Success)
            insertOffset = codeStart + selectMatch.Groups[1].Index + selectMatch.Groups[1].Length;

        return string.Concat(sql.AsSpan(0, insertOffset), $" TOP({maxRows})", sql.AsSpan(insertOffset));
    }

    /// <summary>
    /// Append LIMIT n to a PostgreSQL SELECT query.
    /// Returns the original SQL unchanged if it's not a simple SELECT or already has LIMIT.
    /// </summary>
    public static string ApplyLimitForPostgreSql(string sql, int maxRows)
    {
        if (maxRows <= 0 || maxRows == int.MaxValue) return sql;

        // Already has LIMIT
        if (HasLimitRegex().IsMatch(sql)) return sql;

        // Find where the real SQL starts (skip comments)
        var codeStart = SkipLeadingComments(sql);
        var codePart = sql[codeStart..];

        // Skip non-SELECT statements
        if (NonSelectRegex().IsMatch(codePart)) return sql;

        // Must start with SELECT
        if (!Regex.IsMatch(codePart, @"^SELECT\s+", RegexOptions.IgnoreCase)) return sql;

        // Strip trailing semicolon, append LIMIT
        var trimmed = sql.TrimEnd();
        if (trimmed.EndsWith(';'))
            trimmed = trimmed[..^1].TrimEnd();

        return $"{trimmed} LIMIT {maxRows}";
    }
}
