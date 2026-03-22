using System.Text.RegularExpressions;

namespace DbAnalyser.Providers;

/// <summary>
/// Injects TOP (SQL Server) or LIMIT (PostgreSQL) into SELECT queries
/// so the database engine can optimize and stop early.
/// </summary>
public static partial class SqlRowLimiter
{
    // Matches SELECT at the start (ignoring leading whitespace, comments, CTEs)
    // Captures everything after SELECT [ALL|DISTINCT] to inject TOP before columns
    [GeneratedRegex(@"^\s*SELECT(\s+(?:ALL|DISTINCT))?\s+", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex SelectStartRegex();

    [GeneratedRegex(@"\bTOP\s*[\(\d]", RegexOptions.IgnoreCase)]
    private static partial Regex HasTopRegex();

    [GeneratedRegex(@"\bLIMIT\s+\d", RegexOptions.IgnoreCase)]
    private static partial Regex HasLimitRegex();

    // Detect non-SELECT statements that shouldn't be limited
    [GeneratedRegex(@"^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXEC|EXECUTE|SET|USE|BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|MERGE|TRUNCATE|WITH\s)", RegexOptions.IgnoreCase)]
    private static partial Regex NonSelectRegex();

    /// <summary>
    /// Inject TOP(n) into a SQL Server SELECT query.
    /// Returns the original SQL unchanged if it's not a simple SELECT or already has TOP.
    /// </summary>
    public static string ApplyTopForSqlServer(string sql, int maxRows)
    {
        if (maxRows <= 0 || maxRows == int.MaxValue) return sql;

        // Skip non-SELECT statements
        if (NonSelectRegex().IsMatch(sql)) return sql;

        // Already has TOP
        if (HasTopRegex().IsMatch(sql)) return sql;

        // Inject TOP after SELECT [ALL|DISTINCT]
        var match = SelectStartRegex().Match(sql);
        if (!match.Success) return sql;

        var distinctPart = match.Groups[1].Success ? match.Groups[1].Value : "";
        var insertPos = match.Groups[1].Success ? match.Groups[1].Index + match.Groups[1].Length : match.Index + "SELECT".Length;

        // Find where "SELECT" ends in the original string
        var selectKeywordEnd = sql.IndexOf("SELECT", StringComparison.OrdinalIgnoreCase) + "SELECT".Length;
        if (match.Groups[1].Success)
            selectKeywordEnd = match.Groups[1].Index + match.Groups[1].Length;

        return string.Concat(sql.AsSpan(0, selectKeywordEnd), $" TOP({maxRows})", sql.AsSpan(selectKeywordEnd));
    }

    /// <summary>
    /// Append LIMIT n to a PostgreSQL SELECT query.
    /// Returns the original SQL unchanged if it's not a simple SELECT or already has LIMIT.
    /// </summary>
    public static string ApplyLimitForPostgreSql(string sql, int maxRows)
    {
        if (maxRows <= 0 || maxRows == int.MaxValue) return sql;

        // Skip non-SELECT statements
        if (NonSelectRegex().IsMatch(sql)) return sql;

        // Already has LIMIT
        if (HasLimitRegex().IsMatch(sql)) return sql;

        // Must start with SELECT
        if (!SelectStartRegex().IsMatch(sql)) return sql;

        // Strip trailing semicolon, append LIMIT
        var trimmed = sql.TrimEnd();
        if (trimmed.EndsWith(';'))
            trimmed = trimmed[..^1].TrimEnd();

        return $"{trimmed} LIMIT {maxRows}";
    }
}
