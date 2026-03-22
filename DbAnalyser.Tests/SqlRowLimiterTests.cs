using DbAnalyser.Providers;

namespace DbAnalyser.Tests;

public class SqlRowLimiterTests
{
    [Theory]
    [InlineData("SELECT * FROM Users", 1000, "SELECT TOP(1000) * FROM Users")]
    [InlineData("Select  * from dbo.invoice \norder by invoiceId desc;", 1000, "Select TOP(1000)  * from dbo.invoice \norder by invoiceId desc;")]
    [InlineData("select distinct Name from Users", 500, "select distinct TOP(500) Name from Users")]
    [InlineData("SELECT TOP 10 * FROM Users", 1000, "SELECT TOP 10 * FROM Users")] // already has TOP
    [InlineData("INSERT INTO Users VALUES (1)", 1000, "INSERT INTO Users VALUES (1)")] // non-SELECT
    [InlineData("UPDATE Users SET Name='x'", 1000, "UPDATE Users SET Name='x'")] // non-SELECT
    [InlineData("SELECT * FROM Users", 0, "SELECT * FROM Users")] // maxRows=0, no limit
    // Leading comments
    [InlineData("-- comment\nSELECT * FROM Users", 1000, "-- comment\nSELECT TOP(1000) * FROM Users")]
    [InlineData("-- line1\n-- line2\nSELECT * FROM Users", 1000, "-- line1\n-- line2\nSELECT TOP(1000) * FROM Users")]
    [InlineData("/* block */\nSELECT * FROM Users", 1000, "/* block */\nSELECT TOP(1000) * FROM Users")]
    [InlineData("-- Write your SQL query here\nSelect  * from dbo.invoice \norder by invoiceId desc;", 1000, "-- Write your SQL query here\nSelect TOP(1000)  * from dbo.invoice \norder by invoiceId desc;")]
    [InlineData("-- comment\nINSERT INTO Users VALUES (1)", 1000, "-- comment\nINSERT INTO Users VALUES (1)")] // comment + non-SELECT
    public void ApplyTopForSqlServer_Works(string input, int maxRows, string expected)
    {
        var result = SqlRowLimiter.ApplyTopForSqlServer(input, maxRows);
        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData("SELECT * FROM users", 1000, "SELECT * FROM users LIMIT 1000")]
    [InlineData("SELECT * FROM users;", 1000, "SELECT * FROM users LIMIT 1000")]
    [InlineData("SELECT * FROM users LIMIT 10", 1000, "SELECT * FROM users LIMIT 10")] // already has LIMIT
    [InlineData("INSERT INTO users VALUES (1)", 1000, "INSERT INTO users VALUES (1)")] // non-SELECT
    [InlineData("-- comment\nSELECT * FROM users", 1000, "-- comment\nSELECT * FROM users LIMIT 1000")]
    public void ApplyLimitForPostgreSql_Works(string input, int maxRows, string expected)
    {
        var result = SqlRowLimiter.ApplyLimitForPostgreSql(input, maxRows);
        Assert.Equal(expected, result);
    }
}
