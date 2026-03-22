using System.Data;
using System.Data.Common;

namespace DbAnalyser.Providers;

/// <summary>
/// Builds DataTable columns from a DbDataReader, resolving duplicate column names
/// by prefixing with the base table name (e.g. "Orders.Id" vs "Customers.Id").
/// </summary>
public static class ReaderColumnHelper
{
    public static void AddColumnsFromReader(DataTable table, DbDataReader reader)
    {
        var names = new string[reader.FieldCount];
        var types = new Type[reader.FieldCount];

        for (var i = 0; i < reader.FieldCount; i++)
        {
            names[i] = reader.GetName(i);
            types[i] = reader.GetFieldType(i) ?? typeof(object);
        }

        // Detect duplicates
        var duplicateNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < names.Length; i++)
        {
            if (!seen.Add(names[i]))
                duplicateNames.Add(names[i]);
        }

        // If duplicates exist, try to get table names from schema
        string?[]? tableNames = null;
        if (duplicateNames.Count > 0)
        {
            try
            {
                // GetSchemaTable() is more widely supported and returns BaseTableName
                var schemaTable = reader.GetSchemaTable();
                if (schemaTable is not null && schemaTable.Rows.Count > 0)
                {
                    tableNames = new string?[reader.FieldCount];
                    var baseTableCol = schemaTable.Columns.IndexOf("BaseTableName");
                    if (baseTableCol >= 0)
                    {
                        for (var i = 0; i < Math.Min(schemaTable.Rows.Count, reader.FieldCount); i++)
                        {
                            var val = schemaTable.Rows[i][baseTableCol];
                            tableNames[i] = val is string s && s.Length > 0 ? s : null;
                        }
                    }
                }
            }
            catch
            {
                // Fall back to numeric suffix
            }
        }

        // Add columns with unique names
        var usedNames = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < names.Length; i++)
        {
            var name = names[i];

            if (duplicateNames.Contains(name))
            {
                // Try table prefix first
                var tableName = tableNames?[i];
                if (!string.IsNullOrEmpty(tableName))
                {
                    var prefixed = $"{tableName}.{name}";
                    if (!usedNames.ContainsKey(prefixed))
                    {
                        name = prefixed;
                    }
                }

                // If still a duplicate (no table name or same table.column), add numeric suffix
                if (usedNames.ContainsKey(name))
                {
                    var count = usedNames.GetValueOrDefault(name, 0) + 1;
                    usedNames[name] = count;
                    name = $"{name}{count}";
                }
            }

            usedNames[name] = usedNames.GetValueOrDefault(name, 0);
            table.Columns.Add(name, types[i]);
        }
    }

    /// <summary>
    /// Read all result sets from a reader into DataTables, capping each at maxRows.
    /// Handles columns (with duplicate resolution) and row reading in one place.
    /// </summary>
    public static async Task<List<DataTable>> ReadResultSetsAsync(DbDataReader reader, int maxRows, CancellationToken ct = default)
    {
        var results = new List<DataTable>();

        do
        {
            var table = new DataTable();
            AddColumnsFromReader(table, reader);

            var rowCount = 0;
            while (rowCount < maxRows && await reader.ReadAsync(ct))
            {
                var values = new object[reader.FieldCount];
                reader.GetValues(values);
                table.Rows.Add(values);
                rowCount++;
            }

            results.Add(table);
        } while (await reader.NextResultAsync(ct));

        return results;
    }

    /// <summary>
    /// Add a "(N row(s) affected)" message if the reader has records affected info.
    /// </summary>
    public static void AddRecordsAffectedMessage(DbDataReader reader, List<string> messages)
    {
        if (reader.RecordsAffected >= 0)
            messages.Add($"({reader.RecordsAffected} row(s) affected)");
    }
}
