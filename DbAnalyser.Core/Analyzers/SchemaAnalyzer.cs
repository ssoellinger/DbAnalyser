using DbAnalyser.Models.Schema;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers;

public class SchemaAnalyzer : IAnalyzer
{
    public string Name => "schema";

    public async Task AnalyzeAsync(AnalysisContext context, AnalysisResult result, CancellationToken ct = default)
    {
        var provider = context.Provider;
        var catalog = context.CatalogQueries;
        var schema = new DatabaseSchema { DatabaseName = provider.DatabaseName };

        // Bulk-fetch all metadata in parallel
        var allColumnsTask = catalog.GetAllColumnsAsync(provider, ct);
        var allIndexesTask = catalog.GetAllIndexesAsync(provider, ct);
        var allForeignKeysTask = catalog.GetAllForeignKeysAsync(provider, ct);
        var viewsTask = catalog.GetAllViewsAsync(provider, ct);
        var sprocsTask = catalog.GetStoredProceduresAsync(provider, ct);
        var functionsTask = catalog.GetFunctionsAsync(provider, ct);
        var triggersTask = catalog.GetTriggersAsync(provider, ct);
        var synonymsTask = catalog.GetSynonymsAsync(provider, ct);
        var sequencesTask = catalog.GetSequencesAsync(provider, ct);
        var udtsTask = catalog.GetUserDefinedTypesAsync(provider, ct);

        await Task.WhenAll(allColumnsTask, allIndexesTask, allForeignKeysTask,
            viewsTask, sprocsTask, functionsTask,
            triggersTask, synonymsTask, sequencesTask, udtsTask);

        var allColumns = await allColumnsTask;
        var allIndexRows = await allIndexesTask;
        var allFkRows = await allForeignKeysTask;

        // Group indexes by schema.table
        var allIndexes = allIndexRows
            .GroupBy(r => $"{r.SchemaName}.{r.TableName}")
            .ToDictionary(
                g => g.Key,
                g => g.Select(r => new IndexInfo(
                    Name: r.IndexName,
                    Type: r.IndexType,
                    IsUnique: r.IsUnique,
                    IsClustered: r.IsClustered,
                    Columns: r.Columns.Split(", ").ToList()
                )).ToList());

        // Group foreign keys by schema.table
        var allForeignKeys = allFkRows
            .GroupBy(r => $"{r.FromSchema}.{r.FromTable}")
            .ToDictionary(
                g => g.Key,
                g => g.Select(r => new ForeignKeyInfo(
                    Name: r.FkName,
                    FromSchema: r.FromSchema,
                    FromTable: r.FromTable,
                    FromColumn: r.FromColumn,
                    ToSchema: r.ToSchema,
                    ToTable: r.ToTable,
                    ToColumn: r.ToColumn,
                    DeleteRule: r.DeleteRule,
                    UpdateRule: r.UpdateRule
                )).ToList());

        // Group into tables
        var tableKeys = allColumns
            .Where(c => c.TableType == "BASE TABLE")
            .Select(c => (c.Schema, c.Table))
            .Distinct()
            .OrderBy(t => t.Schema).ThenBy(t => t.Table);

        schema.Tables = tableKeys.Select(t => new TableInfo(
            t.Schema,
            t.Table,
            allColumns
                .Where(c => c.Schema == t.Schema && c.Table == t.Table && c.TableType == "BASE TABLE")
                .Select(c => new ColumnInfo(
                    c.Name, c.DataType, c.MaxLength, c.Precision, c.Scale,
                    c.IsNullable, c.IsPrimaryKey, c.IsIdentity, c.IsComputed, c.DefaultValue, c.OrdinalPosition))
                .OrderBy(c => c.OrdinalPosition)
                .ToList(),
            allIndexes.TryGetValue($"{t.Schema}.{t.Table}", out var idxList) ? idxList : [],
            allForeignKeys.TryGetValue($"{t.Schema}.{t.Table}", out var fkList) ? fkList : []
        )).ToList();

        // Build views with their columns
        var viewData = await viewsTask;
        schema.Views = viewData.Select(v => new ViewInfo(
            v.Schema,
            v.Name,
            v.Definition,
            allColumns
                .Where(c => c.Schema == v.Schema && c.Table == v.Name && c.TableType == "VIEW")
                .Select(c => new ColumnInfo(
                    c.Name, c.DataType, c.MaxLength, c.Precision, c.Scale,
                    c.IsNullable, c.IsPrimaryKey, c.IsIdentity, c.IsComputed, c.DefaultValue, c.OrdinalPosition))
                .OrderBy(c => c.OrdinalPosition)
                .ToList()
        )).ToList();

        var sprocRows = await sprocsTask;
        schema.StoredProcedures = sprocRows.Select(r => new StoredProcedureInfo(
            r.SchemaName, r.ProcedureName, r.Definition, r.LastModified)).ToList();

        var funcRows = await functionsTask;
        schema.Functions = funcRows.Select(r => new FunctionInfo(
            r.SchemaName, r.FunctionName, r.FunctionType, r.Definition, r.LastModified)).ToList();

        var trigRows = await triggersTask;
        schema.Triggers = trigRows.Select(r => new TriggerInfo(
            r.SchemaName, r.TriggerName, r.ParentTable, r.TriggerType,
            r.TriggerEvents, r.IsEnabled, r.Definition)).ToList();

        var synRows = await synonymsTask;
        schema.Synonyms = synRows.Select(r => new SynonymInfo(
            r.SchemaName, r.SynonymName, r.BaseObjectName)).ToList();

        var seqRows = await sequencesTask;
        schema.Sequences = seqRows.Select(r => new SequenceInfo(
            r.SchemaName, r.SequenceName, r.DataType,
            r.CurrentValue, r.Increment, r.MinValue, r.MaxValue, r.IsCycling)).ToList();

        var udtRows = await udtsTask;
        schema.UserDefinedTypes = udtRows.Select(r => new UserDefinedTypeInfo(
            r.SchemaName, r.TypeName, r.BaseType,
            r.IsTableType, r.IsNullable, r.MaxLength)).ToList();

        var jobRows = await catalog.GetJobsAsync(provider, provider.DatabaseName, ct);
        schema.Jobs = jobRows.Select(r => new JobInfo(
            r.JobName, r.Description, r.IsEnabled,
            r.Steps.Select(s => new JobStepInfo(
                s.StepId, s.StepName, s.SubsystemType, s.DatabaseName, s.Command)).ToList(),
            r.LastRunDate, r.ScheduleDescription)).ToList();

        result.Schema = schema;
    }
}
