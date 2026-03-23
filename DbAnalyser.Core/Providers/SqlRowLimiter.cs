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

    // Detect non-SELECT, non-WITH statements
    [GeneratedRegex(@"^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXEC|EXECUTE|SET|USE|BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|MERGE|TRUNCATE)\b", RegexOptions.IgnoreCase)]
    private static partial Regex NonSelectRegex();

    /// <summary>
    /// Find the position in the original string where actual SQL code starts,
    /// skipping leading whitespace, single-line comments (--), and block comments (/* */).
    /// </summary>
    private static int SkipLeadingCommentsAndWhitespace(string sql)
    {
        var i = 0;
        while (i < sql.Length)
        {
            // Skip whitespace
            if (char.IsWhiteSpace(sql[i]))
            {
                i++;
                continue;
            }

            // Skip single-line comment
            if (i + 1 < sql.Length && sql[i] == '-' && sql[i + 1] == '-')
            {
                i += 2;
                while (i < sql.Length && sql[i] != '\n' && sql[i] != '\r')
                    i++;
                continue;
            }

            // Skip block comment
            if (i + 1 < sql.Length && sql[i] == '/' && sql[i + 1] == '*')
            {
                i += 2;
                while (i + 1 < sql.Length && !(sql[i] == '*' && sql[i + 1] == '/'))
                    i++;
                if (i + 1 < sql.Length) i += 2; // skip */
                continue;
            }

            break;
        }
        return i;
    }

    /// <summary>
    /// Check if SQL contains multiple statements (semicolon followed by another statement keyword).
    /// Ignores semicolons inside strings, comments, and at the very end.
    /// </summary>
    private static bool IsMultiStatement(string sql)
    {
        var i = 0;
        var foundSemicolon = false;

        while (i < sql.Length)
        {
            var ch = sql[i];

            // Skip string literals
            if (ch == '\'') { i++; while (i < sql.Length && sql[i] != '\'') i++; i++; continue; }
            // Skip line comments
            if (ch == '-' && i + 1 < sql.Length && sql[i + 1] == '-') { while (i < sql.Length && sql[i] != '\n') i++; continue; }
            // Skip block comments
            if (ch == '/' && i + 1 < sql.Length && sql[i + 1] == '*') { i += 2; while (i + 1 < sql.Length && !(sql[i] == '*' && sql[i + 1] == '/')) i++; i += 2; continue; }

            if (ch == ';')
            {
                foundSemicolon = true;
                i++;
                continue;
            }

            // After a semicolon, check if there's a real statement keyword
            if (foundSemicolon && char.IsLetter(ch))
            {
                var rest = sql[i..];
                if (Regex.IsMatch(rest, @"^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXEC|EXECUTE|WITH|MERGE|TRUNCATE|DECLARE|SET|IF|WHILE|BEGIN)\b", RegexOptions.IgnoreCase))
                    return true;
                foundSemicolon = false;
            }

            i++;
        }

        return false;
    }

    /// <summary>
    /// Find the position of the outermost SELECT keyword — the one that's NOT inside parentheses.
    /// For CTEs (WITH ... AS (...) SELECT ...), this finds the final SELECT after all CTE definitions.
    /// Returns -1 if no outer SELECT found.
    /// </summary>
    private static int FindOuterSelectPosition(string sql, int startFrom)
    {
        var depth = 0;
        var i = startFrom;

        while (i < sql.Length)
        {
            var ch = sql[i];

            if (ch == '(') { depth++; i++; continue; }
            if (ch == ')') { depth--; i++; continue; }

            // Skip string literals
            if (ch == '\'')
            {
                i++;
                while (i < sql.Length && sql[i] != '\'') i++;
                if (i < sql.Length) i++; // skip closing quote
                continue;
            }

            // Skip single-line comments inside SQL
            if (ch == '-' && i + 1 < sql.Length && sql[i + 1] == '-')
            {
                while (i < sql.Length && sql[i] != '\n' && sql[i] != '\r') i++;
                continue;
            }

            // Skip block comments inside SQL
            if (ch == '/' && i + 1 < sql.Length && sql[i + 1] == '*')
            {
                i += 2;
                while (i + 1 < sql.Length && !(sql[i] == '*' && sql[i + 1] == '/')) i++;
                if (i + 1 < sql.Length) i += 2;
                continue;
            }

            // Check for SELECT keyword at depth 0
            if (depth == 0 && i + 6 <= sql.Length &&
                sql.Substring(i, 6).Equals("SELECT", StringComparison.OrdinalIgnoreCase))
            {
                // Make sure it's a whole word (not part of another identifier)
                var before = i > 0 ? sql[i - 1] : ' ';
                var after = i + 6 < sql.Length ? sql[i + 6] : ' ';
                if (!char.IsLetterOrDigit(before) && before != '_' &&
                    !char.IsLetterOrDigit(after) && after != '_')
                {
                    return i;
                }
            }

            i++;
        }

        return -1;
    }

    /// <summary>
    /// Inject TOP(n) into a SQL Server SELECT query.
    /// Handles plain SELECTs, CTEs (WITH ... SELECT), leading comments, and subqueries.
    /// Returns the original SQL unchanged if not applicable.
    /// </summary>
    public static string ApplyTopForSqlServer(string sql, int maxRows)
    {
        if (maxRows <= 0 || maxRows == int.MaxValue) return sql;

        // Already has TOP anywhere in the query (user wrote their own)
        if (HasTopRegex().IsMatch(sql)) return sql;

        // Skip leading comments/whitespace to find actual code
        var codeStart = SkipLeadingCommentsAndWhitespace(sql);
        if (codeStart >= sql.Length) return sql;

        var codePart = sql[codeStart..];

        // Skip multi-statement batches — don't inject TOP when there are multiple statements
        if (IsMultiStatement(codePart)) return sql;

        // Skip non-SELECT/non-WITH statements
        if (NonSelectRegex().IsMatch(codePart)) return sql;

        // Find the outermost SELECT (handles CTEs by skipping parenthesized SELECTs)
        int selectPos;
        if (codePart.StartsWith("WITH", StringComparison.OrdinalIgnoreCase) &&
            (codePart.Length <= 4 || !char.IsLetterOrDigit(codePart[4])))
        {
            // CTE: skip past WITH to find the final SELECT outside parens
            selectPos = FindOuterSelectPosition(sql, codeStart + 4);
        }
        else
        {
            selectPos = FindOuterSelectPosition(sql, codeStart);
        }

        if (selectPos < 0) return sql;

        // Check for DISTINCT/ALL after SELECT
        var afterSelect = sql[(selectPos + 6)..];
        var distinctMatch = Regex.Match(afterSelect, @"^(\s+(?:ALL|DISTINCT))\s+", RegexOptions.IgnoreCase);

        var insertPos = selectPos + 6; // right after "SELECT"
        if (distinctMatch.Success)
            insertPos += distinctMatch.Groups[1].Length;

        return string.Concat(sql.AsSpan(0, insertPos), $" TOP({maxRows})", sql.AsSpan(insertPos));
    }

    /// <summary>
    /// Append LIMIT n to a PostgreSQL SELECT query.
    /// Handles CTEs, leading comments, and subqueries.
    /// Returns the original SQL unchanged if not applicable.
    /// </summary>
    public static string ApplyLimitForPostgreSql(string sql, int maxRows)
    {
        if (maxRows <= 0 || maxRows == int.MaxValue) return sql;

        // Already has LIMIT
        if (HasLimitRegex().IsMatch(sql)) return sql;

        // Skip leading comments/whitespace
        var codeStart = SkipLeadingCommentsAndWhitespace(sql);
        if (codeStart >= sql.Length) return sql;

        var codePart = sql[codeStart..];

        // Skip multi-statement batches
        if (IsMultiStatement(codePart)) return sql;

        // Skip non-SELECT/non-WITH statements
        if (NonSelectRegex().IsMatch(codePart)) return sql;

        // Must start with SELECT or WITH (CTE)
        var isSelect = codePart.StartsWith("SELECT", StringComparison.OrdinalIgnoreCase) &&
                       (codePart.Length <= 6 || !char.IsLetterOrDigit(codePart[6]));
        var isWith = codePart.StartsWith("WITH", StringComparison.OrdinalIgnoreCase) &&
                     (codePart.Length <= 4 || !char.IsLetterOrDigit(codePart[4]));

        if (!isSelect && !isWith) return sql;

        // Strip trailing semicolon, append LIMIT
        var trimmed = sql.TrimEnd();
        if (trimmed.EndsWith(';'))
            trimmed = trimmed[..^1].TrimEnd();

        return $"{trimmed} LIMIT {maxRows}";
    }
}
