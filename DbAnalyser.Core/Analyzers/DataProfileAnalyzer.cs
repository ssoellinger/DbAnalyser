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

    public async Task AnalyzeAsync(AnalysisContext context, AnalysisResult result, CancellationToken ct = default)
    {
        if (result.Schema is null)
            throw new InvalidOperationException("Schema analysis must run before profiling.");

        var profiles = new List<TableProfile>();

        foreach (var table in result.Schema.Tables)
        {
            var profile = await ProfileTableAsync(context, table.SchemaName, table.TableName, table.Columns, ct);
            profiles.Add(profile);
        }

        result.Profiles = profiles;
    }

    private async Task<TableProfile> ProfileTableAsync(
        AnalysisContext context,
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

        var countSql = context.CatalogQueries.BuildCountSql(schema, table);
        var countResult = await context.Provider.ExecuteScalarAsync(countSql, ct);
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
            var colProfile = await ProfileColumnAsync(context, schema, table, col, profile.RowCount, ct);
            profile.ColumnProfiles.Add(colProfile);
        }

        return profile;
    }

    private async Task<ColumnProfile> ProfileColumnAsync(
        AnalysisContext context,
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
            if (column.IsNullable)
            {
                var nullSql = context.CatalogQueries.BuildNullCountSql(schema, table, column.Name);
                colProfile.NullCount = Convert.ToInt64(
                    await context.Provider.ExecuteScalarAsync(nullSql, ct) ?? 0);
            }
            else
            {
                colProfile.NullCount = 0;
            }
            return colProfile;
        }

        var canMinMax = baseType is not ("bit" or "text" or "ntext" or "uniqueidentifier");
        var sql = context.CatalogQueries.BuildColumnProfileSql(schema, table, column.Name, canMinMax);

        var data = await context.Provider.ExecuteQueryAsync(sql, ct);
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
