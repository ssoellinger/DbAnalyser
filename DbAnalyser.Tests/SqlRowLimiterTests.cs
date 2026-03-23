using DbAnalyser.Providers;

namespace DbAnalyser.Tests;

public class SqlRowLimiterTests
{
    [Theory]
    // Basic SELECT
    [InlineData("SELECT * FROM Users", 1000, "SELECT TOP(1000) * FROM Users")]
    [InlineData("Select  * from dbo.invoice \norder by invoiceId desc;", 1000, "Select TOP(1000)  * from dbo.invoice \norder by invoiceId desc;")]
    [InlineData("select distinct Name from Users", 500, "select distinct TOP(500) Name from Users")]
    [InlineData("  SELECT * FROM Users", 100, "  SELECT TOP(100) * FROM Users")]
    // Already has TOP — don't touch
    [InlineData("SELECT TOP 10 * FROM Users", 1000, "SELECT TOP 10 * FROM Users")]
    [InlineData("SELECT TOP(50) * FROM Users", 1000, "SELECT TOP(50) * FROM Users")]
    // Non-SELECT — don't touch
    [InlineData("INSERT INTO Users VALUES (1)", 1000, "INSERT INTO Users VALUES (1)")]
    [InlineData("UPDATE Users SET Name='x'", 1000, "UPDATE Users SET Name='x'")]
    [InlineData("DELETE FROM Users WHERE Id=1", 1000, "DELETE FROM Users WHERE Id=1")]
    [InlineData("EXEC sp_help", 1000, "EXEC sp_help")]
    [InlineData("CREATE TABLE Foo (Id INT)", 1000, "CREATE TABLE Foo (Id INT)")]
    // maxRows=0 or int.MaxValue — don't touch
    [InlineData("SELECT * FROM Users", 0, "SELECT * FROM Users")]
    // Leading comments
    [InlineData("-- comment\nSELECT * FROM Users", 1000, "-- comment\nSELECT TOP(1000) * FROM Users")]
    [InlineData("-- line1\n-- line2\nSELECT * FROM Users", 1000, "-- line1\n-- line2\nSELECT TOP(1000) * FROM Users")]
    [InlineData("/* block */\nSELECT * FROM Users", 1000, "/* block */\nSELECT TOP(1000) * FROM Users")]
    [InlineData("-- Write your SQL query here\nSelect  * from dbo.invoice \norder by invoiceId desc;", 1000, "-- Write your SQL query here\nSelect TOP(1000)  * from dbo.invoice \norder by invoiceId desc;")]
    [InlineData("-- comment\nINSERT INTO Users VALUES (1)", 1000, "-- comment\nINSERT INTO Users VALUES (1)")]
    // Subquery in FROM — TOP goes on outer SELECT only
    [InlineData("SELECT * FROM (SELECT Id, Name FROM Users) AS sub", 1000, "SELECT TOP(1000) * FROM (SELECT Id, Name FROM Users) AS sub")]
    // CTE — TOP goes on the final SELECT
    [InlineData("WITH cte AS (SELECT * FROM Users) SELECT * FROM cte", 1000, "WITH cte AS (SELECT * FROM Users) SELECT TOP(1000) * FROM cte")]
    [InlineData("WITH cte AS (\n  SELECT * FROM Users\n)\nSELECT * FROM cte", 1000, "WITH cte AS (\n  SELECT * FROM Users\n)\nSELECT TOP(1000) * FROM cte")]
    // Multiple CTEs
    [InlineData("WITH a AS (SELECT 1 AS x), b AS (SELECT 2 AS y) SELECT * FROM a, b", 1000, "WITH a AS (SELECT 1 AS x), b AS (SELECT 2 AS y) SELECT TOP(1000) * FROM a, b")]
    // CTE with comments
    [InlineData("-- header\nWITH cte AS (SELECT * FROM Users)\nSELECT * FROM cte", 1000, "-- header\nWITH cte AS (SELECT * FROM Users)\nSELECT TOP(1000) * FROM cte")]
    // Joins
    [InlineData("SELECT a.*, b.Name FROM Users a JOIN Roles b ON a.RoleId = b.Id", 1000, "SELECT TOP(1000) a.*, b.Name FROM Users a JOIN Roles b ON a.RoleId = b.Id")]
    // SELECT INTO
    [InlineData("SELECT * INTO #temp FROM Users", 1000, "SELECT TOP(1000) * INTO #temp FROM Users")]
    // Multi-statement — should NOT inject TOP (multiple statements)
    [InlineData("SELECT * FROM A;\nSELECT * FROM B;", 1000, "SELECT * FROM A;\nSELECT * FROM B;")]
    [InlineData("-- comment\nSELECT * FROM A;\nSELECT * FROM B;", 1000, "-- comment\nSELECT * FROM A;\nSELECT * FROM B;")]
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
    // CTE
    [InlineData("WITH cte AS (SELECT * FROM users) SELECT * FROM cte", 1000, "WITH cte AS (SELECT * FROM users) SELECT * FROM cte LIMIT 1000")]
    // Subquery
    [InlineData("SELECT * FROM (SELECT * FROM users) sub", 1000, "SELECT * FROM (SELECT * FROM users) sub LIMIT 1000")]
    public void ApplyLimitForPostgreSql_Works(string input, int maxRows, string expected)
    {
        var result = SqlRowLimiter.ApplyLimitForPostgreSql(input, maxRows);
        Assert.Equal(expected, result);
    }
}
