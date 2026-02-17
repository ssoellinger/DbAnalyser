using System.Data;
using DbAnalyser.Models.Profiling;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers;

public class DataProfileAnalyzer : IAnalyzer
{
    public string Name => "profiling";

    private static readonly HashSet<string> ProfileableTypes =
    [
        "int", "bigint", "smallint", "tinyint", "decimal", "numeric", "float", "real", "money", "smallmoney",
        "char", "varchar", "nchar", "nvarchar", "text", "ntext",
        "date", "datetime", "datetime2", "smalldatetime", "datetimeoffset", "time",
        "bit", "uniqueidentifier"
    ];

    public async Task AnalyzeAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct = default)
    {
        if (result.Schema is null)
            throw new InvalidOperationException("Schema analysis must run before profiling.");

        var profiles = new List<TableProfile>();

        foreach (var table in result.Schema.Tables)
        {
            var profile = await ProfileTableAsync(provider, table.SchemaName, table.TableName, table.Columns, ct);
            profiles.Add(profile);
        }

        result.Profiles = profiles;
    }

    private async Task<TableProfile> ProfileTableAsync(
        IDbProvider provider,
        string schema,
        string table,
        List<Models.Schema.ColumnInfo> columns,
        CancellationToken ct)
    {
        var profile = new TableProfile
        {
            SchemaName = schema,
            TableName = table
        };

        var countResult = await provider.ExecuteScalarAsync(
            $"SELECT COUNT(*) FROM [{schema}].[{table}]", ct);
        profile.RowCount = Convert.ToInt64(countResult ?? 0);

        if (profile.RowCount == 0)
        {
            profile.ColumnProfiles = columns.Select(c => new ColumnProfile
            {
                ColumnName = c.Name,
                DataType = c.DataType,
                TotalCount = 0,
                NullCount = 0,
                DistinctCount = 0
            }).ToList();
            return profile;
        }

        foreach (var col in columns)
        {
            var colProfile = await ProfileColumnAsync(provider, schema, table, col, profile.RowCount, ct);
            profile.ColumnProfiles.Add(colProfile);
        }

        return profile;
    }

    private async Task<ColumnProfile> ProfileColumnAsync(
        IDbProvider provider,
        string schema,
        string table,
        Models.Schema.ColumnInfo column,
        long rowCount,
        CancellationToken ct)
    {
        var colProfile = new ColumnProfile
        {
            ColumnName = column.Name,
            DataType = column.DataType,
            TotalCount = rowCount
        };

        var baseType = column.DataType.ToLowerInvariant();
        if (!ProfileableTypes.Contains(baseType))
        {
            colProfile.NullCount = column.IsNullable
                ? Convert.ToInt64(await provider.ExecuteScalarAsync(
                    $"SELECT COUNT(*) FROM [{schema}].[{table}] WHERE [{column.Name}] IS NULL", ct) ?? 0)
                : 0;
            return colProfile;
        }

        var canMinMax = baseType is not ("bit" or "text" or "ntext" or "uniqueidentifier");

        var sql = canMinMax
            ? $"""
               SELECT
                   SUM(CASE WHEN [{column.Name}] IS NULL THEN 1 ELSE 0 END) AS NullCount,
                   COUNT(DISTINCT [{column.Name}]) AS DistinctCount,
                   CAST(MIN([{column.Name}]) AS NVARCHAR(500)) AS MinVal,
                   CAST(MAX([{column.Name}]) AS NVARCHAR(500)) AS MaxVal
               FROM [{schema}].[{table}]
               """
            : $"""
               SELECT
                   SUM(CASE WHEN [{column.Name}] IS NULL THEN 1 ELSE 0 END) AS NullCount,
                   COUNT(DISTINCT [{column.Name}]) AS DistinctCount,
                   NULL AS MinVal,
                   NULL AS MaxVal
               FROM [{schema}].[{table}]
               """;

        var data = await provider.ExecuteQueryAsync(sql, ct);
        if (data.Rows.Count > 0)
        {
            var row = data.Rows[0];
            colProfile.NullCount = Convert.ToInt64(row["NullCount"]);
            colProfile.DistinctCount = Convert.ToInt64(row["DistinctCount"]);
            colProfile.MinValue = row["MinVal"] as string;
            colProfile.MaxValue = row["MaxVal"] as string;
        }

        return colProfile;
    }
}
