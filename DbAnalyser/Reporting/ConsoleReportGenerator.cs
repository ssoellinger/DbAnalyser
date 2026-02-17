using DbAnalyser.Analyzers;
using DbAnalyser.Models.Quality;
using Spectre.Console;

namespace DbAnalyser.Reporting;

public class ConsoleReportGenerator : IReportGenerator
{
    public OutputFormat Format => OutputFormat.Console;

    public Task GenerateAsync(AnalysisResult result, string? outputPath, CancellationToken ct = default)
    {
        AnsiConsole.Write(new Rule($"[bold blue]Database Analysis: {Markup.Escape(result.DatabaseName)}[/]").LeftJustified());
        AnsiConsole.MarkupLine($"[grey]Analyzed at: {result.AnalyzedAt:yyyy-MM-dd HH:mm:ss} UTC[/]");
        AnsiConsole.WriteLine();

        if (result.Relationships?.Dependencies.Count > 0)
            RenderDependencies(result);

        if (result.Schema is not null)
            RenderSchema(result);

        if (result.Profiles is not null)
            RenderProfiles(result);

        if (result.Relationships is not null)
            RenderRelationships(result);

        if (result.QualityIssues is not null)
            RenderQuality(result);

        return Task.CompletedTask;
    }

    private void RenderDependencies(AnalysisResult result)
    {
        var deps = result.Relationships!.Dependencies;
        var connected = deps.Where(d => d.DirectConnections > 0).ToList();
        var orphaned = deps.Where(d => d.DirectConnections == 0).ToList();

        AnsiConsole.Write(new Rule("[bold green]Dependency Overview[/]").LeftJustified());

        var summaryTable = new Table().Border(TableBorder.Rounded);
        summaryTable.AddColumn("Metric");
        summaryTable.AddColumn("Count");
        summaryTable.AddRow("Total Objects", deps.Count.ToString());
        summaryTable.AddRow("Tables", deps.Count(d => d.ObjectType == "Table").ToString());
        summaryTable.AddRow("Views", deps.Count(d => d.ObjectType == "View").ToString());
        summaryTable.AddRow("Procedures", deps.Count(d => d.ObjectType == "Procedure").ToString());
        summaryTable.AddRow("Functions", deps.Count(d => d.ObjectType == "Function").ToString());
        summaryTable.AddRow("Triggers", deps.Count(d => d.ObjectType == "Trigger").ToString());
        summaryTable.AddRow("Synonyms", deps.Count(d => d.ObjectType == "Synonym").ToString());
        summaryTable.AddRow("Connected", connected.Count.ToString());
        summaryTable.AddRow("Standalone", orphaned.Count.ToString());
        summaryTable.AddRow("Foreign Keys", result.Relationships!.ExplicitRelationships.Count.ToString());
        AnsiConsole.Write(summaryTable);
        AnsiConsole.WriteLine();

        // Importance ranking
        if (connected.Count > 0)
        {
            AnsiConsole.MarkupLine("[bold]Object Importance Ranking[/]");
            AnsiConsole.MarkupLine("[grey]Objects ranked by centrality. Referenced By = other objects depend on this one.[/]");

            var rankTable = new Table().Border(TableBorder.Rounded);
            rankTable.AddColumn("#");
            rankTable.AddColumn("Object");
            rankTable.AddColumn("Type");
            rankTable.AddColumn(new TableColumn("Referenced By").RightAligned());
            rankTable.AddColumn(new TableColumn("Depends On").RightAligned());
            rankTable.AddColumn(new TableColumn("Impact").RightAligned());
            rankTable.AddColumn(new TableColumn("Score").RightAligned());

            var rank = 1;
            foreach (var dep in connected.OrderByDescending(d => d.ImportanceScore))
            {
                var impactColor = dep.TransitiveImpact.Count > 10 ? "red" : dep.TransitiveImpact.Count > 5 ? "yellow" : "green";
                var typeColor = dep.ObjectType switch { "View" => "green", "Procedure" => "yellow", "Function" => "blue", "Trigger" => "olive", "Synonym" => "grey", "Job" => "teal", "External" => "red", _ => "white" };
                rankTable.AddRow(
                    rank++.ToString(),
                    $"[bold]{Markup.Escape(dep.FullName)}[/]",
                    $"[{typeColor}]{dep.ObjectType}[/]",
                    dep.ReferencedBy.Count.ToString(),
                    dep.DependsOn.Count.ToString(),
                    $"[{impactColor}]{dep.TransitiveImpact.Count}[/]",
                    dep.ImportanceScore.ToString());
            }

            AnsiConsole.Write(rankTable);
            AnsiConsole.WriteLine();

            // Core tables impact tree
            var coreTables = connected
                .Where(d => d.ReferencedBy.Count > 0)
                .OrderByDescending(d => d.TransitiveImpact.Count)
                .Take(10)
                .ToList();

            if (coreTables.Count > 0)
            {
                AnsiConsole.MarkupLine("[bold]Top Core Tables — Impact Tree[/]");
                var tree = new Tree("[bold]Core Tables[/]");

                foreach (var dep in coreTables)
                {
                    var node = tree.AddNode($"[bold yellow]{Markup.Escape(dep.FullName)}[/] [grey](score: {dep.ImportanceScore})[/]");
                    var directNode = node.AddNode($"[cyan]Referenced by ({dep.ReferencedBy.Count}):[/]");
                    foreach (var t in dep.ReferencedBy.Order())
                        directNode.AddNode(Markup.Escape(t));

                    if (dep.DependsOn.Count > 0)
                    {
                        var depsNode = node.AddNode($"[green]Depends on ({dep.DependsOn.Count}):[/]");
                        foreach (var t in dep.DependsOn.Order())
                            depsNode.AddNode(Markup.Escape(t));
                    }
                }

                AnsiConsole.Write(tree);
                AnsiConsole.WriteLine();
            }
        }

        if (orphaned.Count > 0)
        {
            AnsiConsole.MarkupLine($"[grey]Standalone tables ({orphaned.Count}): {string.Join(", ", orphaned.Select(d => d.FullName).Order())}[/]");
            AnsiConsole.WriteLine();
        }
    }

    private void RenderSchema(AnalysisResult result)
    {
        var schema = result.Schema!;

        AnsiConsole.Write(new Rule("[bold green]Schema Overview[/]").LeftJustified());

        // Summary
        var summaryTable = new Table().Border(TableBorder.Rounded);
        summaryTable.AddColumn("Metric");
        summaryTable.AddColumn("Count");
        summaryTable.AddRow("Tables", schema.Tables.Count.ToString());
        summaryTable.AddRow("Views", schema.Views.Count.ToString());
        summaryTable.AddRow("Stored Procedures", schema.StoredProcedures.Count.ToString());
        summaryTable.AddRow("Functions", schema.Functions.Count.ToString());
        summaryTable.AddRow("Triggers", schema.Triggers.Count.ToString());
        summaryTable.AddRow("Synonyms", schema.Synonyms.Count.ToString());
        summaryTable.AddRow("Sequences", schema.Sequences.Count.ToString());
        summaryTable.AddRow("User-Defined Types", schema.UserDefinedTypes.Count.ToString());
        summaryTable.AddRow("SQL Agent Jobs", schema.Jobs.Count.ToString());
        summaryTable.AddRow("Total Columns", schema.Tables.Sum(t => t.Columns.Count).ToString());
        summaryTable.AddRow("Total Indexes", schema.Tables.Sum(t => t.Indexes.Count).ToString());
        summaryTable.AddRow("Total Foreign Keys", schema.Tables.Sum(t => t.ForeignKeys.Count).ToString());
        AnsiConsole.Write(summaryTable);
        AnsiConsole.WriteLine();

        // Tables detail
        foreach (var table in schema.Tables)
        {
            AnsiConsole.MarkupLine($"[bold yellow]{Markup.Escape(table.FullName)}[/]");

            var colTable = new Table().Border(TableBorder.Simple);
            colTable.AddColumn("Column");
            colTable.AddColumn("Type");
            colTable.AddColumn("Nullable");
            colTable.AddColumn("PK");
            colTable.AddColumn("Identity");
            colTable.AddColumn("Default");

            foreach (var col in table.Columns)
            {
                var typeStr = col.MaxLength.HasValue
                    ? $"{col.DataType}({(col.MaxLength == -1 ? "MAX" : col.MaxLength.ToString())})"
                    : col.Precision.HasValue
                        ? $"{col.DataType}({col.Precision},{col.Scale})"
                        : col.DataType;

                colTable.AddRow(
                    Markup.Escape(col.Name),
                    typeStr,
                    col.IsNullable ? "[yellow]YES[/]" : "NO",
                    col.IsPrimaryKey ? "[green]PK[/]" : "",
                    col.IsIdentity ? "Yes" : "",
                    Markup.Escape(col.DefaultValue ?? ""));
            }

            AnsiConsole.Write(colTable);

            if (table.Indexes.Count > 0)
            {
                var idxTable = new Table().Border(TableBorder.Simple);
                idxTable.AddColumn("Index");
                idxTable.AddColumn("Type");
                idxTable.AddColumn("Unique");
                idxTable.AddColumn("Columns");

                foreach (var idx in table.Indexes)
                {
                    idxTable.AddRow(
                        Markup.Escape(idx.Name),
                        idx.Type,
                        idx.IsUnique ? "[green]Yes[/]" : "No",
                        Markup.Escape(string.Join(", ", idx.Columns)));
                }

                AnsiConsole.Write(idxTable);
            }

            AnsiConsole.WriteLine();
        }

        // Views
        if (schema.Views.Count > 0)
        {
            AnsiConsole.Write(new Rule("[bold green]Views[/]").LeftJustified());
            foreach (var view in schema.Views)
            {
                AnsiConsole.MarkupLine($"  [cyan]{Markup.Escape(view.FullName)}[/] ({view.Columns.Count} columns)");
            }
            AnsiConsole.WriteLine();
        }

        // Stored Procedures
        if (schema.StoredProcedures.Count > 0)
        {
            AnsiConsole.Write(new Rule("[bold green]Stored Procedures[/]").LeftJustified());
            foreach (var sp in schema.StoredProcedures)
            {
                var modified = sp.LastModified?.ToString("yyyy-MM-dd") ?? "N/A";
                AnsiConsole.MarkupLine($"  [cyan]{Markup.Escape(sp.FullName)}[/] (modified: {modified})");
            }
            AnsiConsole.WriteLine();
        }

        // Functions
        if (schema.Functions.Count > 0)
        {
            AnsiConsole.Write(new Rule("[bold green]Functions[/]").LeftJustified());
            foreach (var fn in schema.Functions)
            {
                var modified = fn.LastModified?.ToString("yyyy-MM-dd") ?? "N/A";
                AnsiConsole.MarkupLine($"  [cyan]{Markup.Escape(fn.FullName)}[/] ({fn.FunctionType}, modified: {modified})");
            }
            AnsiConsole.WriteLine();
        }

        // Triggers
        if (schema.Triggers.Count > 0)
        {
            AnsiConsole.Write(new Rule("[bold green]Triggers[/]").LeftJustified());
            foreach (var tr in schema.Triggers)
            {
                var status = tr.IsEnabled ? "[green]Enabled[/]" : "[red]Disabled[/]";
                AnsiConsole.MarkupLine($"  [cyan]{Markup.Escape(tr.FullName)}[/] on {Markup.Escape(tr.ParentFullName)} ({tr.TriggerType} {Markup.Escape(tr.TriggerEvents)}, {status})");
            }
            AnsiConsole.WriteLine();
        }

        // Synonyms
        if (schema.Synonyms.Count > 0)
        {
            AnsiConsole.Write(new Rule("[bold green]Synonyms[/]").LeftJustified());
            foreach (var syn in schema.Synonyms)
            {
                AnsiConsole.MarkupLine($"  [cyan]{Markup.Escape(syn.FullName)}[/] -> {Markup.Escape(syn.BaseObjectName)}");
            }
            AnsiConsole.WriteLine();
        }

        // Sequences
        if (schema.Sequences.Count > 0)
        {
            AnsiConsole.Write(new Rule("[bold green]Sequences[/]").LeftJustified());
            foreach (var seq in schema.Sequences)
            {
                AnsiConsole.MarkupLine($"  [cyan]{Markup.Escape(seq.FullName)}[/] ({seq.DataType}, current: {seq.CurrentValue}, increment: {seq.Increment}{(seq.IsCycling ? ", cycling" : "")})");
            }
            AnsiConsole.WriteLine();
        }

        // User-Defined Types
        if (schema.UserDefinedTypes.Count > 0)
        {
            AnsiConsole.Write(new Rule("[bold green]User-Defined Types[/]").LeftJustified());
            foreach (var udt in schema.UserDefinedTypes)
            {
                var kind = udt.IsTableType ? "Table Type" : $"based on {udt.BaseType}";
                AnsiConsole.MarkupLine($"  [cyan]{Markup.Escape(udt.FullName)}[/] ({kind}{(udt.IsNullable ? ", nullable" : "")})");
            }
            AnsiConsole.WriteLine();
        }

        // SQL Agent Jobs
        if (schema.Jobs.Count > 0)
        {
            AnsiConsole.Write(new Rule("[bold green]SQL Agent Jobs[/]").LeftJustified());
            foreach (var job in schema.Jobs)
            {
                var status = job.IsEnabled ? "[green]Enabled[/]" : "[red]Disabled[/]";
                AnsiConsole.MarkupLine($"  [cyan]{Markup.Escape(job.JobName)}[/] ({status}, {job.Steps.Count} steps)");
            }
            AnsiConsole.WriteLine();
        }
    }

    private void RenderProfiles(AnalysisResult result)
    {
        AnsiConsole.Write(new Rule("[bold green]Data Profiling[/]").LeftJustified());

        foreach (var profile in result.Profiles!)
        {
            AnsiConsole.MarkupLine($"[bold yellow]{Markup.Escape(profile.FullName)}[/] - [grey]{profile.RowCount:N0} rows[/]");

            if (profile.RowCount == 0)
            {
                AnsiConsole.MarkupLine("  [grey]Empty table[/]");
                AnsiConsole.WriteLine();
                continue;
            }

            var table = new Table().Border(TableBorder.Simple);
            table.AddColumn("Column");
            table.AddColumn("Type");
            table.AddColumn(new TableColumn("Nulls %").RightAligned());
            table.AddColumn(new TableColumn("Distinct").RightAligned());
            table.AddColumn("Min");
            table.AddColumn("Max");

            foreach (var col in profile.ColumnProfiles)
            {
                var nullPct = col.NullPercentage > 0
                    ? $"[yellow]{col.NullPercentage:F1}%[/]"
                    : "[green]0%[/]";

                table.AddRow(
                    Markup.Escape(col.ColumnName),
                    col.DataType,
                    nullPct,
                    col.DistinctCount.ToString("N0"),
                    Markup.Escape(Truncate(col.MinValue, 30)),
                    Markup.Escape(Truncate(col.MaxValue, 30)));
            }

            AnsiConsole.Write(table);
            AnsiConsole.WriteLine();
        }
    }

    private void RenderRelationships(AnalysisResult result)
    {
        var map = result.Relationships!;
        AnsiConsole.Write(new Rule("[bold green]Relationships[/]").LeftJustified());

        if (map.ExplicitRelationships.Count > 0)
        {
            AnsiConsole.MarkupLine("[bold]Explicit Foreign Keys:[/]");
            var tree = new Tree("Foreign Keys");

            foreach (var fk in map.ExplicitRelationships)
            {
                var node = tree.AddNode(Markup.Escape(fk.Name));
                node.AddNode($"[cyan]{Markup.Escape(fk.FromSchema)}.{Markup.Escape(fk.FromTable)}.{Markup.Escape(fk.FromColumn)}[/] -> [green]{Markup.Escape(fk.ToSchema)}.{Markup.Escape(fk.ToTable)}.{Markup.Escape(fk.ToColumn)}[/]");
                node.AddNode($"[grey]Delete: {fk.DeleteRule}, Update: {fk.UpdateRule}[/]");
            }

            AnsiConsole.Write(tree);
            AnsiConsole.WriteLine();
        }

        if (map.ImplicitRelationships.Count > 0)
        {
            AnsiConsole.MarkupLine("[bold]Implicit (Detected) Relationships:[/]");
            var table = new Table().Border(TableBorder.Rounded);
            table.AddColumn("From");
            table.AddColumn("To");
            table.AddColumn("Confidence");
            table.AddColumn("Reason");

            foreach (var rel in map.ImplicitRelationships)
            {
                table.AddRow(
                    $"{Markup.Escape(rel.FromSchema)}.{Markup.Escape(rel.FromTable)}.{Markup.Escape(rel.FromColumn)}",
                    $"{Markup.Escape(rel.ToSchema)}.{Markup.Escape(rel.ToTable)}.{Markup.Escape(rel.ToColumn)}",
                    $"{rel.Confidence:P0}",
                    Markup.Escape(rel.Reason));
            }

            AnsiConsole.Write(table);
            AnsiConsole.WriteLine();
        }

        if (map.ExplicitRelationships.Count == 0 && map.ImplicitRelationships.Count == 0)
        {
            AnsiConsole.MarkupLine("[grey]No relationships found.[/]");
            AnsiConsole.WriteLine();
        }
    }

    private void RenderQuality(AnalysisResult result)
    {
        var issues = result.QualityIssues!;
        AnsiConsole.Write(new Rule("[bold green]Quality Issues[/]").LeftJustified());

        if (issues.Count == 0)
        {
            AnsiConsole.MarkupLine("[green]No quality issues found.[/]");
            return;
        }

        var grouped = issues.GroupBy(i => i.Severity).OrderByDescending(g => g.Key);
        foreach (var group in grouped)
        {
            var color = group.Key switch
            {
                IssueSeverity.Error => "red",
                IssueSeverity.Warning => "yellow",
                _ => "blue"
            };

            AnsiConsole.MarkupLine($"\n[bold {color}]{group.Key} ({group.Count()})[/]");

            var table = new Table().Border(TableBorder.Simple);
            table.AddColumn("Object");
            table.AddColumn("Category");
            table.AddColumn("Issue");
            table.AddColumn("Recommendation");

            foreach (var issue in group)
            {
                table.AddRow(
                    Markup.Escape(issue.ObjectName),
                    issue.Category,
                    Markup.Escape(issue.Description),
                    Markup.Escape(issue.Recommendation ?? ""));
            }

            AnsiConsole.Write(table);
        }

        AnsiConsole.WriteLine();
    }

    private static string Truncate(string? value, int maxLength)
    {
        if (string.IsNullOrEmpty(value)) return "";
        return value.Length <= maxLength ? value : value[..maxLength] + "...";
    }
}
