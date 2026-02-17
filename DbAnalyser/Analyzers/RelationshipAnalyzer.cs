using System.Data;
using System.Text.RegularExpressions;
using DbAnalyser.Models.Relationships;
using DbAnalyser.Models.Schema;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers;

public partial class RelationshipAnalyzer : IAnalyzer
{
    public string Name => "relationships";

    public async Task AnalyzeAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct = default)
    {
        if (result.Schema is null)
            throw new InvalidOperationException("Schema analysis must run before relationship analysis.");

        var map = new RelationshipMap();

        // Collect all explicit FKs
        foreach (var table in result.Schema.Tables)
        {
            map.ExplicitRelationships.AddRange(table.ForeignKeys);
        }

        // Detect implicit relationships by naming convention
        map.ImplicitRelationships = DetectImplicitRelationships(result.Schema.Tables, map.ExplicitRelationships);

        // Get view/sproc -> table dependencies from both sources and merge
        var sysDeps = await GetObjectDependenciesAsync(provider, ct);
        var parsedDeps = ParseViewDependencies(result.Schema);
        var synonymDeps = ResolveSynonymDependencies(result.Schema);

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        map.ViewDependencies = [];
        foreach (var dep in sysDeps.Concat(parsedDeps).Concat(synonymDeps))
        {
            var key = $"{dep.FromSchema}.{dep.FromName}->{dep.ToFullName}";
            if (seen.Add(key))
                map.ViewDependencies.Add(dep);
        }

        // Build dependency graph (tables + views)
        map.Dependencies = BuildDependencyGraph(result.Schema, map.ExplicitRelationships, map.ViewDependencies);

        result.Relationships = map;
    }

    private List<ImplicitRelationship> DetectImplicitRelationships(
        List<TableInfo> tables,
        List<ForeignKeyInfo> explicitFks)
    {
        var implicit_ = new List<ImplicitRelationship>();

        // Build lookup of table names to their PK columns
        var tablePkLookup = new Dictionary<string, (string Schema, string Table, string PkColumn)>(
            StringComparer.OrdinalIgnoreCase);

        foreach (var table in tables)
        {
            var pk = table.Columns.FirstOrDefault(c => c.IsPrimaryKey);
            if (pk is not null)
            {
                tablePkLookup[table.TableName] = (table.SchemaName, table.TableName, pk.Name);
            }
        }

        // Build set of existing FK relationships for deduplication
        var existingFks = explicitFks
            .Select(fk => $"{fk.FromSchema}.{fk.FromTable}.{fk.FromColumn}->{fk.ToSchema}.{fk.ToTable}.{fk.ToColumn}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var table in tables)
        {
            foreach (var column in table.Columns)
            {
                if (column.IsPrimaryKey) continue;

                var match = TryMatchColumnToTable(column.Name, tablePkLookup);
                if (match is null) continue;

                var key = $"{table.SchemaName}.{table.TableName}.{column.Name}->{match.Value.Schema}.{match.Value.Table}.{match.Value.PkColumn}";
                if (existingFks.Contains(key)) continue;

                // Don't suggest self-references through naming convention
                if (string.Equals(table.TableName, match.Value.Table, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(column.Name, match.Value.PkColumn, StringComparison.OrdinalIgnoreCase))
                    continue;

                implicit_.Add(new ImplicitRelationship(
                    FromSchema: table.SchemaName,
                    FromTable: table.TableName,
                    FromColumn: column.Name,
                    ToSchema: match.Value.Schema,
                    ToTable: match.Value.Table,
                    ToColumn: match.Value.PkColumn,
                    Confidence: match.Value.Confidence,
                    Reason: match.Value.Reason));
            }
        }

        return implicit_;
    }

    private (string Schema, string Table, string PkColumn, double Confidence, string Reason)?
        TryMatchColumnToTable(
            string columnName,
            Dictionary<string, (string Schema, string Table, string PkColumn)> tablePkLookup)
    {
        // Pattern 1: Column named "TableNameId" or "TableName_Id"
        foreach (var (tableName, info) in tablePkLookup)
        {
            if (string.Equals(columnName, $"{tableName}Id", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(columnName, $"{tableName}_Id", StringComparison.OrdinalIgnoreCase))
            {
                return (info.Schema, info.Table, info.PkColumn, 0.9,
                    $"Column name '{columnName}' matches pattern '{{TableName}}Id'");
            }

            // Pattern 2: Singular form match (e.g., column "CategoryId" -> table "Categories")
            if (tableName.EndsWith("s", StringComparison.OrdinalIgnoreCase))
            {
                var singular = tableName[..^1];
                if (string.Equals(columnName, $"{singular}Id", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(columnName, $"{singular}_Id", StringComparison.OrdinalIgnoreCase))
                {
                    return (info.Schema, info.Table, info.PkColumn, 0.8,
                        $"Column name '{columnName}' matches singular form of table '{tableName}'");
                }
            }
        }

        // Pattern 3: Column named "FK_Something" or ending in "_fk"
        if (columnName.StartsWith("FK_", StringComparison.OrdinalIgnoreCase))
        {
            var remainder = columnName[3..];
            if (tablePkLookup.TryGetValue(remainder, out var info))
            {
                return (info.Schema, info.Table, info.PkColumn, 0.7,
                    $"Column name '{columnName}' has FK_ prefix matching table '{remainder}'");
            }
        }

        return null;
    }

    private async Task<List<ObjectDependency>> GetObjectDependenciesAsync(
        IDbProvider provider, CancellationToken ct)
    {
        var data = await provider.ExecuteQueryAsync("""
            SELECT DISTINCT
                OBJECT_SCHEMA_NAME(d.referencing_id) AS FromSchema,
                OBJECT_NAME(d.referencing_id) AS FromName,
                CASE o1.type
                    WHEN 'V' THEN 'View'
                    WHEN 'P' THEN 'Procedure'
                    WHEN 'FN' THEN 'Function'
                    WHEN 'IF' THEN 'Function'
                    WHEN 'TF' THEN 'Function'
                    WHEN 'TR' THEN 'Trigger'
                    ELSE o1.type_desc
                END AS FromType,
                ISNULL(d.referenced_schema_name, 'dbo') AS ToSchema,
                d.referenced_entity_name AS ToName,
                CASE ISNULL(o2.type, 'U')
                    WHEN 'U' THEN 'Table'
                    WHEN 'V' THEN 'View'
                    WHEN 'P' THEN 'Procedure'
                    WHEN 'FN' THEN 'Function'
                    WHEN 'IF' THEN 'Function'
                    WHEN 'TF' THEN 'Function'
                    ELSE ISNULL(o2.type_desc, 'Table')
                END AS ToType,
                d.referenced_database_name AS ToDatabase
            FROM sys.sql_expression_dependencies d
            JOIN sys.objects o1 ON d.referencing_id = o1.object_id
            LEFT JOIN sys.objects o2
                ON o2.object_id = OBJECT_ID(ISNULL(d.referenced_schema_name, 'dbo') + '.' + d.referenced_entity_name)
            WHERE o1.type IN ('V', 'P', 'FN', 'IF', 'TF', 'TR')
              AND d.referenced_entity_name IS NOT NULL
              AND OBJECT_NAME(d.referencing_id) IS NOT NULL
            ORDER BY FromSchema, FromName, ToSchema, ToName
            """, ct);

        return data.Rows.Cast<DataRow>().Select(r => new ObjectDependency(
            FromSchema: r["FromSchema"].ToString()!,
            FromName: r["FromName"].ToString()!,
            FromType: r["FromType"].ToString()!,
            ToSchema: r["ToSchema"].ToString()!,
            ToName: r["ToName"].ToString()!,
            ToType: r["ToType"].ToString()!,
            ToDatabase: r["ToDatabase"] is DBNull ? null : r["ToDatabase"].ToString()
        )).ToList();
    }

    private List<TableDependency> BuildDependencyGraph(
        DatabaseSchema schema,
        List<ForeignKeyInfo> fks,
        List<ObjectDependency> viewDeps)
    {
        var deps = new Dictionary<string, TableDependency>(StringComparer.OrdinalIgnoreCase);

        // Initialize all tables
        foreach (var table in schema.Tables)
        {
            deps[table.FullName] = new TableDependency
            {
                SchemaName = table.SchemaName,
                TableName = table.TableName,
                ObjectType = "Table"
            };
        }

        // Initialize views
        foreach (var view in schema.Views)
        {
            deps[view.FullName] = new TableDependency
            {
                SchemaName = view.SchemaName,
                TableName = view.ViewName,
                ObjectType = "View"
            };
        }

        // Initialize stored procedures
        foreach (var sp in schema.StoredProcedures)
        {
            deps[sp.FullName] = new TableDependency
            {
                SchemaName = sp.SchemaName,
                TableName = sp.ProcedureName,
                ObjectType = "Procedure"
            };
        }

        // Initialize functions
        foreach (var fn in schema.Functions)
        {
            deps[fn.FullName] = new TableDependency
            {
                SchemaName = fn.SchemaName,
                TableName = fn.FunctionName,
                ObjectType = "Function"
            };
        }

        // Initialize triggers
        foreach (var tr in schema.Triggers)
        {
            deps[tr.FullName] = new TableDependency
            {
                SchemaName = tr.SchemaName,
                TableName = tr.TriggerName,
                ObjectType = "Trigger"
            };
        }

        // Initialize synonyms
        foreach (var syn in schema.Synonyms)
        {
            deps[syn.FullName] = new TableDependency
            {
                SchemaName = syn.SchemaName,
                TableName = syn.SynonymName,
                ObjectType = "Synonym"
            };
        }

        // Initialize jobs
        foreach (var job in schema.Jobs)
        {
            var key = $"job.{job.JobName}";
            deps[key] = new TableDependency
            {
                SchemaName = "job",
                TableName = job.JobName,
                ObjectType = "Job"
            };
        }

        // Build direct relationships from FKs
        foreach (var fk in fks)
        {
            var from = $"{fk.FromSchema}.{fk.FromTable}";
            var to = $"{fk.ToSchema}.{fk.ToTable}";

            if (deps.TryGetValue(from, out var fromDep) && !fromDep.DependsOn.Contains(to, StringComparer.OrdinalIgnoreCase))
                fromDep.DependsOn.Add(to);

            if (deps.TryGetValue(to, out var toDep) && !toDep.ReferencedBy.Contains(from, StringComparer.OrdinalIgnoreCase))
                toDep.ReferencedBy.Add(from);
        }

        // Add object dependencies (views, sprocs, functions)
        foreach (var vd in viewDeps)
        {
            var from = $"{vd.FromSchema}.{vd.FromName}";
            var to = vd.ToFullName;

            // Create placeholder node for cross-database targets
            if (vd.IsCrossDatabase && !deps.ContainsKey(to))
            {
                deps[to] = new TableDependency
                {
                    SchemaName = vd.ToSchema,
                    TableName = vd.ToName,
                    ObjectType = "External",
                    ExternalDatabase = vd.ToDatabase
                };
            }

            if (deps.TryGetValue(from, out var fromDep) && !fromDep.DependsOn.Contains(to, StringComparer.OrdinalIgnoreCase))
                fromDep.DependsOn.Add(to);

            if (deps.TryGetValue(to, out var toDep) && !toDep.ReferencedBy.Contains(from, StringComparer.OrdinalIgnoreCase))
                toDep.ReferencedBy.Add(from);
        }

        // Compute transitive impact (BFS: all objects reachable via ReferencedBy chains)
        foreach (var dep in deps.Values)
        {
            dep.TransitiveImpact = ComputeTransitiveImpact(dep.FullName, deps);
        }

        return deps.Values
            .OrderByDescending(d => d.ImportanceScore)
            .ToList();
    }

    private List<string> ComputeTransitiveImpact(
        string tableName,
        Dictionary<string, TableDependency> deps)
    {
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var queue = new Queue<string>();

        // Seed with direct dependents
        if (deps.TryGetValue(tableName, out var root))
        {
            foreach (var child in root.ReferencedBy)
                queue.Enqueue(child);
        }

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (!visited.Add(current)) continue;

            if (deps.TryGetValue(current, out var dep))
            {
                foreach (var child in dep.ReferencedBy)
                {
                    if (!visited.Contains(child))
                        queue.Enqueue(child);
                }
            }
        }

        return visited.Order().ToList();
    }

    private List<ObjectDependency> ParseViewDependencies(DatabaseSchema schema)
    {
        var result = new List<ObjectDependency>();
        var currentDb = schema.DatabaseName;

        // Build lookup of known object names (tables, views, sprocs, functions)
        var knownObjects = new Dictionary<string, (string Schema, string Name, string Type)>(
            StringComparer.OrdinalIgnoreCase);

        foreach (var t in schema.Tables)
        {
            knownObjects[t.TableName] = (t.SchemaName, t.TableName, "Table");
            knownObjects[t.FullName] = (t.SchemaName, t.TableName, "Table");
            knownObjects[$"[{t.SchemaName}].[{t.TableName}]"] = (t.SchemaName, t.TableName, "Table");
            knownObjects[$"[{t.TableName}]"] = (t.SchemaName, t.TableName, "Table");
        }

        foreach (var v in schema.Views)
        {
            knownObjects[v.ViewName] = (v.SchemaName, v.ViewName, "View");
            knownObjects[v.FullName] = (v.SchemaName, v.ViewName, "View");
            knownObjects[$"[{v.SchemaName}].[{v.ViewName}]"] = (v.SchemaName, v.ViewName, "View");
            knownObjects[$"[{v.ViewName}]"] = (v.SchemaName, v.ViewName, "View");
        }

        foreach (var sp in schema.StoredProcedures)
        {
            knownObjects[sp.ProcedureName] = (sp.SchemaName, sp.ProcedureName, "Procedure");
            knownObjects[sp.FullName] = (sp.SchemaName, sp.ProcedureName, "Procedure");
            knownObjects[$"[{sp.SchemaName}].[{sp.ProcedureName}]"] = (sp.SchemaName, sp.ProcedureName, "Procedure");
            knownObjects[$"[{sp.ProcedureName}]"] = (sp.SchemaName, sp.ProcedureName, "Procedure");
        }

        foreach (var fn in schema.Functions)
        {
            knownObjects[fn.FunctionName] = (fn.SchemaName, fn.FunctionName, "Function");
            knownObjects[fn.FullName] = (fn.SchemaName, fn.FunctionName, "Function");
            knownObjects[$"[{fn.SchemaName}].[{fn.FunctionName}]"] = (fn.SchemaName, fn.FunctionName, "Function");
            knownObjects[$"[{fn.FunctionName}]"] = (fn.SchemaName, fn.FunctionName, "Function");
        }

        foreach (var syn in schema.Synonyms)
        {
            knownObjects[syn.SynonymName] = (syn.SchemaName, syn.SynonymName, "Synonym");
            knownObjects[syn.FullName] = (syn.SchemaName, syn.SynonymName, "Synonym");
            knownObjects[$"[{syn.SchemaName}].[{syn.SynonymName}]"] = (syn.SchemaName, syn.SynonymName, "Synonym");
            knownObjects[$"[{syn.SynonymName}]"] = (syn.SchemaName, syn.SynonymName, "Synonym");
        }

        // Parse view definitions
        foreach (var view in schema.Views)
        {
            if (string.IsNullOrWhiteSpace(view.Definition)) continue;

            var refs = ExtractTableReferences(view.Definition, knownObjects, currentDb);
            foreach (var (refSchema, refName, refType, refDb) in refs)
            {
                if (refDb is null
                    && string.Equals(refName, view.ViewName, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(refSchema, view.SchemaName, StringComparison.OrdinalIgnoreCase))
                    continue;

                result.Add(new ObjectDependency(
                    FromSchema: view.SchemaName,
                    FromName: view.ViewName,
                    FromType: "View",
                    ToSchema: refSchema,
                    ToName: refName,
                    ToType: refType,
                    ToDatabase: refDb));
            }
        }

        // Parse stored procedure definitions
        foreach (var sp in schema.StoredProcedures)
        {
            if (string.IsNullOrWhiteSpace(sp.Definition)) continue;

            var refs = ExtractTableReferences(sp.Definition, knownObjects, currentDb);
            foreach (var (refSchema, refName, refType, refDb) in refs)
            {
                if (refDb is null
                    && string.Equals(refName, sp.ProcedureName, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(refSchema, sp.SchemaName, StringComparison.OrdinalIgnoreCase))
                    continue;

                result.Add(new ObjectDependency(
                    FromSchema: sp.SchemaName,
                    FromName: sp.ProcedureName,
                    FromType: "Procedure",
                    ToSchema: refSchema,
                    ToName: refName,
                    ToType: refType,
                    ToDatabase: refDb));
            }
        }

        // Parse function definitions
        foreach (var fn in schema.Functions)
        {
            if (string.IsNullOrWhiteSpace(fn.Definition)) continue;

            var refs = ExtractTableReferences(fn.Definition, knownObjects, currentDb);
            foreach (var (refSchema, refName, refType, refDb) in refs)
            {
                if (refDb is null
                    && string.Equals(refName, fn.FunctionName, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(refSchema, fn.SchemaName, StringComparison.OrdinalIgnoreCase))
                    continue;

                result.Add(new ObjectDependency(
                    FromSchema: fn.SchemaName,
                    FromName: fn.FunctionName,
                    FromType: "Function",
                    ToSchema: refSchema,
                    ToName: refName,
                    ToType: refType,
                    ToDatabase: refDb));
            }
        }

        // Parse trigger definitions
        foreach (var tr in schema.Triggers)
        {
            // Trigger always depends on its parent table
            result.Add(new ObjectDependency(
                FromSchema: tr.SchemaName,
                FromName: tr.TriggerName,
                FromType: "Trigger",
                ToSchema: tr.SchemaName,
                ToName: tr.ParentTable,
                ToType: "Table"));

            // Also parse body for additional references
            if (!string.IsNullOrWhiteSpace(tr.Definition))
            {
                var refs = ExtractTableReferences(tr.Definition, knownObjects, currentDb);
                var execRefs = ExtractExecReferences(tr.Definition, knownObjects);
                foreach (var (refSchema, refName, refType, refDb) in refs.Concat(execRefs))
                {
                    // Skip self-reference and parent table reference
                    if (refDb is null
                        && string.Equals(refName, tr.TriggerName, StringComparison.OrdinalIgnoreCase)
                        && string.Equals(refSchema, tr.SchemaName, StringComparison.OrdinalIgnoreCase))
                        continue;

                    result.Add(new ObjectDependency(
                        FromSchema: tr.SchemaName,
                        FromName: tr.TriggerName,
                        FromType: "Trigger",
                        ToSchema: refSchema,
                        ToName: refName,
                        ToType: refType,
                        ToDatabase: refDb));
                }
            }
        }

        // Parse job step commands
        foreach (var job in schema.Jobs)
        {
            foreach (var step in job.Steps)
            {
                if (string.IsNullOrWhiteSpace(step.Command)) continue;

                // Also match EXEC/EXECUTE calls for procedure references
                var refs = ExtractTableReferences(step.Command, knownObjects, currentDb);
                var execRefs = ExtractExecReferences(step.Command, knownObjects);
                foreach (var (refSchema, refName, refType, refDb) in refs.Concat(execRefs))
                {
                    result.Add(new ObjectDependency(
                        FromSchema: "job",
                        FromName: job.JobName,
                        FromType: "Job",
                        ToSchema: refSchema,
                        ToName: refName,
                        ToType: refType,
                        ToDatabase: refDb));
                }
            }
        }

        return result;
    }

    private HashSet<(string Schema, string Name, string Type, string? Database)> ExtractExecReferences(
        string command,
        Dictionary<string, (string Schema, string Name, string Type)> knownObjects)
    {
        var found = new HashSet<(string Schema, string Name, string Type, string? Database)>();

        var matches = ExecRegex().Matches(command);
        foreach (Match match in matches)
        {
            var reference = match.Groups[1].Value.Trim();
            var clean = reference.Replace("[", "").Replace("]", "").Trim();

            if (knownObjects.TryGetValue(clean, out var obj))
            {
                found.Add((obj.Schema, obj.Name, obj.Type, null));
                continue;
            }
            if (knownObjects.TryGetValue(reference, out obj))
            {
                found.Add((obj.Schema, obj.Name, obj.Type, null));
            }
        }

        return found;
    }

    private HashSet<(string Schema, string Name, string Type, string? Database)> ExtractTableReferences(
        string definition,
        Dictionary<string, (string Schema, string Name, string Type)> knownObjects,
        string currentDatabase)
    {
        var found = new HashSet<(string Schema, string Name, string Type, string? Database)>();

        var matches = FromJoinRegex().Matches(definition);
        foreach (Match match in matches)
        {
            var reference = match.Groups[1].Value.Trim();
            var clean = reference.Replace("[", "").Replace("]", "").Trim();
            var parts = clean.Split('.');

            // 4-part name: server.database.schema.table (linked server)
            if (parts.Length >= 4)
            {
                var db = parts[^3];
                var schema = parts[^2];
                var name = parts[^1];

                found.Add((schema, name, "External", db));
                continue;
            }

            // 3-part name: database.schema.table
            if (parts.Length == 3)
            {
                var db = parts[0];
                var schema = parts[1];
                var name = parts[2];

                // Check if it's a reference to the current database (treat as local)
                if (string.Equals(db, currentDatabase, StringComparison.OrdinalIgnoreCase))
                {
                    var localKey = $"{schema}.{name}";
                    if (knownObjects.TryGetValue(localKey, out var localObj))
                    {
                        found.Add((localObj.Schema, localObj.Name, localObj.Type, null));
                        continue;
                    }
                }

                // Cross-database reference
                found.Add((schema, name, "External", db));
                continue;
            }

            // 1 or 2-part name: try local lookup
            if (knownObjects.TryGetValue(reference, out var obj))
            {
                found.Add((obj.Schema, obj.Name, obj.Type, null));
                continue;
            }

            if (knownObjects.TryGetValue(clean, out obj))
            {
                found.Add((obj.Schema, obj.Name, obj.Type, null));
            }
        }

        return found;
    }

    private List<ObjectDependency> ResolveSynonymDependencies(DatabaseSchema schema)
    {
        var result = new List<ObjectDependency>();
        var currentDb = schema.DatabaseName;

        foreach (var syn in schema.Synonyms)
        {
            var (db, targetSchema, targetName) = syn.ParseBaseObject();

            // If it references the current DB, treat as local
            if (db is not null && string.Equals(db, currentDb, StringComparison.OrdinalIgnoreCase))
                db = null;

            result.Add(new ObjectDependency(
                FromSchema: syn.SchemaName,
                FromName: syn.SynonymName,
                FromType: "Synonym",
                ToSchema: targetSchema,
                ToName: targetName,
                ToType: db is not null ? "External" : "Table",
                ToDatabase: db));
        }

        return result;
    }

    // Match FROM or JOIN followed by a table reference (with optional server, database, schema, brackets)
    // Supports: table, schema.table, database.schema.table, server.database.schema.table
    [GeneratedRegex(
        @"(?:FROM|JOIN)\s+((?:\[?\w+\]?\.)?(?:\[?\w+\]?\.)?(?:\[?\w+\]?\.)?(?:\[?\w+\]?))",
        RegexOptions.IgnoreCase | RegexOptions.Compiled)]
    private static partial Regex FromJoinRegex();

    // Match EXEC or EXECUTE followed by a procedure reference
    [GeneratedRegex(
        @"(?:EXEC|EXECUTE)\s+((?:\[?\w+\]?\.)?(?:\[?\w+\]?\.)?(?:\[?\w+\]?))",
        RegexOptions.IgnoreCase | RegexOptions.Compiled)]
    private static partial Regex ExecRegex();
}
