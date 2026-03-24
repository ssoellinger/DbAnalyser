using System.Data;
using DbAnalyser.Providers;
using NSubstitute;
using System.Data.Common;

namespace DbAnalyser.Tests;

public class ReaderColumnHelperTests
{
    private static DbDataReader CreateMockReader(string[] columnNames, Type[]? columnTypes = null)
    {
        var reader = Substitute.For<DbDataReader>();
        reader.FieldCount.Returns(columnNames.Length);

        for (var i = 0; i < columnNames.Length; i++)
        {
            var idx = i;
            reader.GetName(idx).Returns(columnNames[idx]);
            reader.GetFieldType(idx).Returns(columnTypes?[idx] ?? typeof(string));
        }

        return reader;
    }

    [Fact]
    public void AddColumnsFromReader_SimpleColumns_AddsAll()
    {
        var table = new DataTable();
        var reader = CreateMockReader(["Id", "Name", "Email"]);

        ReaderColumnHelper.AddColumnsFromReader(table, reader);

        Assert.Equal(3, table.Columns.Count);
        Assert.Equal("Id", table.Columns[0].ColumnName);
        Assert.Equal("Name", table.Columns[1].ColumnName);
        Assert.Equal("Email", table.Columns[2].ColumnName);
    }

    [Fact]
    public void AddColumnsFromReader_DuplicateColumns_AddsSuffix()
    {
        var table = new DataTable();
        var reader = CreateMockReader(["Id", "Name", "Id", "Name"]);

        // GetSchemaTable returns null by default (no base table info)
        reader.GetSchemaTable().Returns((DataTable?)null);

        ReaderColumnHelper.AddColumnsFromReader(table, reader);

        Assert.Equal(4, table.Columns.Count);
        // First occurrences keep original names
        Assert.Equal("Id", table.Columns[0].ColumnName);
        Assert.Equal("Name", table.Columns[1].ColumnName);
        // Duplicates get suffix
        Assert.Contains("Id", table.Columns[2].ColumnName);
        Assert.Contains("Name", table.Columns[3].ColumnName);
        // All names are unique
        var names = new HashSet<string>();
        for (var i = 0; i < table.Columns.Count; i++)
            Assert.True(names.Add(table.Columns[i].ColumnName), $"Duplicate column name: {table.Columns[i].ColumnName}");
    }

    [Fact]
    public void AddColumnsFromReader_DuplicatesWithSchemaTable_UsesTablePrefix()
    {
        var table = new DataTable();
        var reader = CreateMockReader(["Id", "Id"]);

        // Mock GetSchemaTable to return base table names
        var schemaTable = new DataTable();
        schemaTable.Columns.Add("BaseTableName", typeof(string));
        schemaTable.Rows.Add("Orders");
        schemaTable.Rows.Add("Customers");
        reader.GetSchemaTable().Returns(schemaTable);

        ReaderColumnHelper.AddColumnsFromReader(table, reader);

        Assert.Equal(2, table.Columns.Count);
        Assert.Equal("Orders.Id", table.Columns[0].ColumnName);
        Assert.Equal("Customers.Id", table.Columns[1].ColumnName);
    }

    [Fact]
    public void AddColumnsFromReader_PreservesColumnTypes()
    {
        var table = new DataTable();
        var types = new[] { typeof(int), typeof(string), typeof(DateTime) };
        var reader = CreateMockReader(["Id", "Name", "CreatedAt"], types);

        ReaderColumnHelper.AddColumnsFromReader(table, reader);

        Assert.Equal(typeof(int), table.Columns[0].DataType);
        Assert.Equal(typeof(string), table.Columns[1].DataType);
        Assert.Equal(typeof(DateTime), table.Columns[2].DataType);
    }

    [Fact]
    public void AddRecordsAffectedMessage_PositiveCount_AddsMessage()
    {
        var reader = Substitute.For<DbDataReader>();
        reader.RecordsAffected.Returns(42);
        var messages = new List<string>();

        ReaderColumnHelper.AddRecordsAffectedMessage(reader, messages);

        Assert.Single(messages);
        Assert.Contains("42", messages[0]);
        Assert.Contains("row(s) affected", messages[0]);
    }

    [Fact]
    public void AddRecordsAffectedMessage_NegativeCount_NoMessage()
    {
        var reader = Substitute.For<DbDataReader>();
        reader.RecordsAffected.Returns(-1);
        var messages = new List<string>();

        ReaderColumnHelper.AddRecordsAffectedMessage(reader, messages);

        Assert.Empty(messages);
    }

    [Fact]
    public void AddRecordsAffectedMessage_ZeroCount_AddsMessage()
    {
        var reader = Substitute.For<DbDataReader>();
        reader.RecordsAffected.Returns(0);
        var messages = new List<string>();

        ReaderColumnHelper.AddRecordsAffectedMessage(reader, messages);

        Assert.Single(messages);
        Assert.Contains("0", messages[0]);
    }
}
