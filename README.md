# DbAnalyser

A database analysis and visualization tool that provides deep insights into structure, quality, performance, and relationships across SQL Server and PostgreSQL databases.

Available as a **desktop app** (Electron) with interactive visualizations or as a **CLI** for headless report generation.

## Features

### 6 Built-in Analyzers

| Analyzer | What it does |
|----------|-------------|
| **Schema** | Extracts tables, views, stored procedures, functions, triggers, synonyms, sequences, user-defined types, and SQL Agent jobs with full column/index/FK details |
| **Data Profiling** | Row counts, null/distinct counts, and min/max values per column |
| **Relationships** | Detects explicit foreign keys and **implicit relationships** via naming conventions with confidence scoring (e.g. `OrderId` -> `Order.Id` at 90% confidence) |
| **Quality** | Finds missing primary keys, unindexed FKs, naming violations, `NVARCHAR(MAX)` usage, orphaned tables, and generates FK suggestion SQL |
| **Usage** | Scores objects as Active/Low/Unused/Unknown using DMV stats, Query Store, row counts, and dependency analysis |
| **Indexing** | Inventory of all indexes with usage stats, unused index detection, missing index recommendations, and duplicate index detection |

### Desktop App

- Interactive **Entity-Relationship Diagram** (drag, zoom, color-coded by schema)
- **Force-directed dependency graph** with database clustering, hulls, and cross-database edges
- **Dashboard** with stat cards and largest-table chart
- Tabbed schema browser with inline SQL definitions
- Data profiling with sortable column statistics
- Quality issues sorted by severity with actionable recommendations
- Index inventory with seek/scan/lookup/update counters
- **Server mode** - connect without specifying a database to analyze all user databases at once
- **Save & open sessions** - export analysis to `.dba` files and reopen later without a database connection
- Real-time progress via SignalR
- Encrypted credential storage via OS keychain
- Connection history

### CLI

- Console output with formatted tables (Spectre.Console)
- HTML report generation
- JSON export for automation/CI pipelines

## Database Support

- **SQL Server** 2019+ (Windows Auth & SQL Auth)
- **PostgreSQL** 12+

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Core | .NET 10, Microsoft.Data.SqlClient, Npgsql |
| API | ASP.NET Core Web API, SignalR, Serilog |
| Desktop | Electron 40, React 19, TypeScript 5, Vite 7, Tailwind CSS 4 |
| State | Zustand 5 |
| Visualizations | React Flow 12 (ERD), Dagre 2 (force graph), TanStack React Table 8 |
| CLI | System.CommandLine, Spectre.Console |

## Project Structure

```
DbAnalyser.sln
├── DbAnalyser.Core/          # Analyzers, providers, models (shared library)
├── DbAnalyser.Api/           # REST API + SignalR hub
├── DbAnalyser.Desktop/       # Electron + React app
├── DbAnalyser/               # CLI tool
├── DbAnalyser.Tests/         # Unit tests
└── DbAnalyser.IntegrationTests/  # Integration tests (Docker)
```

## Getting Started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js 22+](https://nodejs.org/) (for the desktop app)

### Desktop App (Development)

```bash
# Build the .NET backend
dotnet build DbAnalyser.Api

# Install frontend dependencies
cd DbAnalyser.Desktop
npm install

# Start the app (launches Electron + auto-starts the API on port 5174)
npm run dev
```

> The Electron app automatically starts the API process - no need to run it separately.

### CLI

```bash
# Run with a connection string
dotnet run --project DbAnalyser -- \
  --connection-string "Server=localhost;Database=MyDb;Trusted_Connection=true" \
  --format Console

# Generate an HTML report
dotnet run --project DbAnalyser -- \
  -cs "Server=localhost;Database=MyDb;Trusted_Connection=true" \
  -f Html \
  -o report.html

# Generate JSON output
dotnet run --project DbAnalyser -- \
  -cs "Server=localhost;Database=MyDb;Trusted_Connection=true" \
  -f Json \
  -o report.json

# Select specific analyzers
dotnet run --project DbAnalyser -- \
  -cs "..." \
  -a schema profiling relationships quality
```

**CLI Options:**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--connection-string` | `-cs` | Database connection string | from appsettings.json |
| `--format` | `-f` | `Console`, `Html`, or `Json` | `Console` |
| `--output` | `-o` | Output file path | stdout |
| `--analyzers` | `-a` | Analyzers to run | `schema profiling relationships quality` |

### API (Standalone)

```bash
dotnet run --project DbAnalyser.Api -- --port=5000
```

## Building for Distribution

```bash
cd DbAnalyser.Desktop

# Full distribution build:
# 1. Publishes the .NET API as a self-contained single-file exe
# 2. Runs Electron Forge to produce installer + portable zip
npm run dist
```

Output in `DbAnalyser.Desktop/out/make/`:
- `DbAnalyser-{version} Setup.exe` - Windows installer (Squirrel)
- `DbAnalyser-win32-x64-{version}.zip` - Portable zip

## Save & Open Sessions

Analysis results can be saved to `.dba` files (JSON) and reopened later without a database connection. The file stores only analysis results - no credentials or connection strings.

- **Save**: Click the Save button in the header after running analyzers
- **Open**: Click "Open Saved Analysis" on the connection page

## Server Mode

Connect to a SQL Server instance without specifying a database to analyze all user databases at once. The dashboard shows database badges, and profiling/usage pages include a database picker for filtering.

## License

All rights reserved.
