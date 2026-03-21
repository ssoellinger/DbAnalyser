import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useStore } from '../../hooks/useStore';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { AnalyzerLoader } from '../shared/AnalyzerLoader';
import { ObjectExplorer } from './ObjectExplorer';
import { CodeTabBar } from './CodeTabBar';
import { CodeEditor } from './CodeEditor';
import { ParameterBar } from './ParameterBar';
import { DependencyMiniView } from './DependencyMiniView';
import { ExecutionChainPanel } from './ExecutionChainPanel';
import { DmlSummary } from './DmlSummary';
import { OutlinePanel } from './OutlinePanel';
import { PeekDefinition } from './PeekDefinition';
import { StatusBar } from './StatusBar';
import { DiffView } from './DiffView';
const MiniErd = lazy(() => import('./MiniErd').then((m) => ({ default: m.MiniErd })));
import { copyAsFormatted } from './copyFormatted';
import { useCodeStore } from './useCodeStore';
import { buildIdentifierMap, resolveIdentifier } from './sqlIdentifierResolver';
import { generateTableDdl, generateJobDdl, generateSequenceDdl, generateUdtDdl } from './tableDdlGenerator';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import type { ColumnInfo } from '../../api/types';
import type { ResolvedObject } from './sqlIdentifierResolver';
import type { TooltipInfo } from './codemirrorTooltip';

export function CodePage() {
  const { status, error, progress, refresh, cancel } = useAnalyzer('schema');

  return (
    <AnalyzerLoader
      status={status}
      error={error}
      progress={progress}
      onRefresh={refresh}
      onCancel={cancel}
      analyzerName="Schema"
    >
      <CodeContent />
    </AnalyzerLoader>
  );
}

/* ── Reference result type ────────────────────────────────────────────── */

interface ReferenceResult {
  objectType: string;
  fullName: string;
  label: string;
  definition: string;
  matchLines: { lineNum: number; text: string }[];
}

/* ── Breadcrumb ───────────────────────────────────────────────────────── */

function Breadcrumb({ objectType, fullName, databaseName }: { objectType: string; fullName: string; databaseName?: string | null }) {
  const parts: { label: string; muted?: boolean }[] = [];
  if (databaseName) parts.push({ label: databaseName, muted: true });
  const nameParts = fullName.split('.');
  if (nameParts.length > 1) parts.push({ label: nameParts[0], muted: true });
  parts.push({ label: objectType + 's', muted: true });
  parts.push({ label: nameParts[nameParts.length - 1] });

  return (
    <div className="flex items-center gap-1 text-[11px]">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-text-muted">/</span>}
          <span className={p.muted ? 'text-text-muted' : 'text-text-primary'}>{p.label}</span>
        </span>
      ))}
    </div>
  );
}

/* ── Main Content ─────────────────────────────────────────────────────── */

function CodeContent() {
  const result = useStore((s) => s.result);
  const databaseName = useStore((s) => s.databaseName);
  const serverName = useStore((s) => s.serverName);
  const tabs = useCodeStore((s) => s.tabs);
  const activeTabId = useCodeStore((s) => s.activeTabId);
  const splitTabId = useCodeStore((s) => s.splitTabId);
  const openTab = useCodeStore((s) => s.openTab);
  const saveScrollPos = useCodeStore((s) => s.saveScrollPos);
  const clearGoToLine = useCodeStore((s) => s.clearGoToLine);
  const toggleSplit = useCodeStore((s) => s.toggleSplit);
  const closeSplit = useCodeStore((s) => s.closeSplit);
  const visualSettings = useCodeStore((s) => s.visualSettings);
  const setVisualSetting = useCodeStore((s) => s.setVisualSetting);
  const loadVisualSettingsForConnection = useCodeStore((s) => s.loadVisualSettingsForConnection);
  const loadSessionForConnection = useCodeStore((s) => s.loadSessionForConnection);
  const initializedRef = useRef('');

  // Load settings + restore session once per connection
  useEffect(() => {
    const connKey = [serverName ?? '', databaseName ?? ''].filter(Boolean).join(':') || '_global';
    if (initializedRef.current === connKey) return;
    if (!result?.schema) return;
    initializedRef.current = connKey;

    loadVisualSettingsForConnection(serverName, databaseName);

    const schema = result.schema;
    loadSessionForConnection(serverName, databaseName, (objectType, fullName) => {
      if (objectType === 'Table') {
        const t = schema.tables.find((t) => t.fullName === fullName);
        return t ? generateTableDdl(t) : '';
      }
      if (objectType === 'View') return schema.views.find((v) => v.fullName === fullName)?.definition ?? '';
      if (objectType === 'Procedure') return schema.storedProcedures.find((p) => p.fullName === fullName)?.definition ?? '';
      if (objectType === 'Function') return schema.functions.find((f) => f.fullName === fullName)?.definition ?? '';
      if (objectType === 'Trigger') return schema.triggers.find((t) => t.fullName === fullName)?.definition ?? '';
      if (objectType === 'Synonym') {
        const s = schema.synonyms.find((s) => s.fullName === fullName);
        return s ? `-- Synonym: ${s.fullName}\n-- Points to: ${s.baseObjectName}\n\nCREATE SYNONYM [${s.schemaName}].[${s.synonymName}]\n    FOR ${s.baseObjectName};` : '';
      }
      if (objectType === 'Job') {
        const j = schema.jobs.find((j) => j.jobName === fullName);
        return j ? generateJobDdl(j) : '';
      }
      if (objectType === 'Sequence') {
        const seq = schema.sequences.find((s) => s.fullName === fullName);
        return seq ? generateSequenceDdl(seq) : '';
      }
      if (objectType === 'Type') {
        const udt = schema.userDefinedTypes.find((u) => u.fullName === fullName);
        return udt ? generateUdtDdl(udt) : '';
      }
      return '';
    });
  }); // runs every render but exits early via initializedRef
  const [showSettings, setShowSettings] = useState(false);
  const showOutline = visualSettings.outline;
  const [showDiff, setShowDiff] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<false | 'copied' | 'failed'>(false);
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const [refsOpen, setRefsOpen] = useState(false);
  const [refsTarget, setRefsTarget] = useState<string | null>(null);
  const [refsHeight, setRefsHeight] = useState(200);
  const [peekObj, setPeekObj] = useState<{ obj: ResolvedObject; coords: { x: number; y: number } } | null>(null);
  const [outlineGoToLine, setOutlineGoToLine] = useState<number | undefined>(undefined);
  const [colUsageOpen, setColUsageOpen] = useState(false);
  const [colUsageColumn, setColUsageColumn] = useState<string | null>(null);
  const [showMiniErd, setShowMiniErd] = useState(false);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId]
  );

  const splitTab = useMemo(
    () => (splitTabId ? tabs.find((t) => t.id === splitTabId) ?? null : null),
    [tabs, splitTabId]
  );

  // Build identifier map for click-through
  const identifierMap = useMemo(
    () => buildIdentifierMap(result?.schema ?? null),
    [result?.schema]
  );

  const resolveId = useCallback(
    (text: string) => resolveIdentifier(text, identifierMap),
    [identifierMap]
  );

  // Build tooltip resolver — returns column info for tables/views, peek for procs/funcs
  const resolveTooltip = useCallback(
    (text: string): TooltipInfo | null => {
      const resolved = resolveIdentifier(text, identifierMap);
      if (!resolved || !result?.schema) return null;

      const schema = result.schema;

      if (resolved.objectType === 'Table') {
        const table = schema.tables.find((t) => t.fullName === resolved.fullName);
        if (table) return { objectType: 'Table', fullName: resolved.fullName, columns: table.columns };
      }
      if (resolved.objectType === 'View') {
        const view = schema.views.find((v) => v.fullName === resolved.fullName);
        if (view) return { objectType: 'View', fullName: resolved.fullName, columns: view.columns, definition: view.definition };
      }
      if (resolved.objectType === 'Procedure') {
        const proc = schema.storedProcedures.find((p) => p.fullName === resolved.fullName);
        if (proc) return { objectType: 'Procedure', fullName: resolved.fullName, definition: proc.definition };
      }
      if (resolved.objectType === 'Function') {
        const func = schema.functions.find((f) => f.fullName === resolved.fullName);
        if (func) return { objectType: 'Function', fullName: resolved.fullName, functionType: func.functionType, definition: func.definition };
      }
      if (resolved.objectType === 'Trigger') {
        const trig = schema.triggers.find((t) => t.fullName === resolved.fullName);
        if (trig) return { objectType: 'Trigger', fullName: resolved.fullName, definition: trig.definition };
      }

      return null;
    },
    [identifierMap, result?.schema]
  );

  const handleNavigate = useCallback(
    (obj: ResolvedObject) => {
      let definition = obj.definition;
      if (obj.objectType === 'Table' && result?.schema) {
        const table = result.schema.tables.find((t) => t.fullName === obj.fullName);
        if (table) definition = generateTableDdl(table);
      }
      openTab({
        objectType: obj.objectType,
        fullName: obj.fullName,
        label: obj.label,
        definition,
      });
    },
    [openTab, result?.schema]
  );

  const handlePeek = useCallback(
    (obj: ResolvedObject, coords: { x: number; y: number }) => {
      // Resolve full definition for tables
      let resolved = obj;
      if (obj.objectType === 'Table' && result?.schema) {
        const table = result.schema.tables.find((t) => t.fullName === obj.fullName);
        if (table) resolved = { ...obj, definition: generateTableDdl(table) };
      }
      setPeekObj({ obj: resolved, coords });
    },
    [result?.schema]
  );

  const handleOutlineGoToLine = useCallback((line: number) => {
    setOutlineGoToLine(line);
    // Clear after a tick so it can be set again to the same line
    setTimeout(() => setOutlineGoToLine(undefined), 100);
  }, []);

  const handleScrollChange = useCallback(
    (pos: number) => {
      if (activeTabId) saveScrollPos(activeTabId, pos);
    },
    [activeTabId, saveScrollPos]
  );

  const handleSplitScrollChange = useCallback(
    (pos: number) => {
      if (splitTabId) saveScrollPos(splitTabId, pos);
    },
    [splitTabId, saveScrollPos]
  );

  const handleGoToLineDone = useCallback(() => {
    if (activeTabId) clearGoToLine(activeTabId);
  }, [activeTabId, clearGoToLine]);

  // Find all references for the active tab's object
  const handleFindRefs = useCallback(() => {
    if (!activeTab) return;
    setRefsTarget(activeTab.fullName);
    setRefsOpen(true);
  }, [activeTab]);

  const references = useMemo<ReferenceResult[]>(() => {
    if (!refsTarget || !result?.schema) return [];
    const schema = result.schema;
    const deps = result.relationships?.dependencies;

    // Use API dependency data to get accurate referencing objects
    const referencingNames = new Set<string>();
    if (deps) {
      const entry = deps.find((d) => d.fullName === refsTarget);
      if (entry) {
        for (const name of entry.referencedBy) referencingNames.add(name);
      }
    }

    // Build lookup for object definitions
    const objMap = new Map<string, { objectType: string; fullName: string; label: string; definition: string }>();
    for (const v of schema.views)
      objMap.set(v.fullName, { objectType: 'View', fullName: v.fullName, label: v.viewName, definition: v.definition ?? '' });
    for (const p of schema.storedProcedures)
      objMap.set(p.fullName, { objectType: 'Procedure', fullName: p.fullName, label: p.procedureName, definition: p.definition ?? '' });
    for (const f of schema.functions)
      objMap.set(f.fullName, { objectType: 'Function', fullName: f.fullName, label: f.functionName, definition: f.definition ?? '' });
    for (const t of schema.triggers)
      objMap.set(t.fullName, { objectType: 'Trigger', fullName: t.fullName, label: t.triggerName, definition: t.definition ?? '' });

    // Find matching lines in each referencing object's definition
    const shortName = refsTarget.split('.').pop() ?? refsTarget;
    const escapedTarget = refsTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedShort = shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lineRe = new RegExp(`\\b(?:${escapedTarget}|${escapedShort})\\b`, 'i');

    const results: ReferenceResult[] = [];
    for (const refName of referencingNames) {
      const obj = objMap.get(refName);
      if (!obj || !obj.definition) continue;

      const lines = obj.definition.split('\n');
      const matchLines: { lineNum: number; text: string }[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (lineRe.test(lines[i])) {
          matchLines.push({ lineNum: i + 1, text: lines[i] });
          if (matchLines.length >= 3) break;
        }
      }

      results.push({ ...obj, matchLines });
    }

    results.sort((a, b) => a.fullName.localeCompare(b.fullName));
    return results;
  }, [refsTarget, result?.schema, result?.relationships?.dependencies]);

  // Column list for current table/view (for Column Usage feature)
  const activeColumns = useMemo<ColumnInfo[]>(() => {
    if (!activeTab || !result?.schema) return [];
    const schema = result.schema;
    if (activeTab.objectType === 'Table') {
      const table = schema.tables.find((t) => t.fullName === activeTab.fullName);
      return table?.columns ?? [];
    }
    if (activeTab.objectType === 'View') {
      const view = schema.views.find((v) => v.fullName === activeTab.fullName);
      return view?.columns ?? [];
    }
    return [];
  }, [activeTab, result?.schema]);

  // Column usage search results
  const columnUsageResults = useMemo<ReferenceResult[]>(() => {
    if (!colUsageColumn || !result?.schema) return [];
    const schema = result.schema;
    const escaped = colUsageColumn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const colRe = new RegExp(`\\b${escaped}\\b`, 'i');

    const objDefs: { objectType: string; fullName: string; label: string; definition: string }[] = [];
    for (const v of schema.views)
      objDefs.push({ objectType: 'View', fullName: v.fullName, label: v.viewName, definition: v.definition ?? '' });
    for (const p of schema.storedProcedures)
      objDefs.push({ objectType: 'Procedure', fullName: p.fullName, label: p.procedureName, definition: p.definition ?? '' });
    for (const f of schema.functions)
      objDefs.push({ objectType: 'Function', fullName: f.fullName, label: f.functionName, definition: f.definition ?? '' });
    for (const t of schema.triggers)
      objDefs.push({ objectType: 'Trigger', fullName: t.fullName, label: t.triggerName, definition: t.definition ?? '' });

    const results: ReferenceResult[] = [];
    for (const obj of objDefs) {
      if (!obj.definition) continue;
      const lines = obj.definition.split('\n');
      const matchLines: { lineNum: number; text: string }[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (colRe.test(lines[i])) {
          matchLines.push({ lineNum: i + 1, text: lines[i] });
          if (matchLines.length >= 3) break;
        }
      }
      if (matchLines.length > 0) {
        results.push({ ...obj, matchLines });
      }
    }
    results.sort((a, b) => a.fullName.localeCompare(b.fullName));
    return results;
  }, [colUsageColumn, result?.schema]);

  const handleColumnUsage = useCallback(() => {
    if (activeColumns.length > 0) {
      setColUsageColumn(activeColumns[0].name);
      setColUsageOpen(true);
    }
  }, [activeColumns]);

  // Resizable panel handlers
  const handleExplorerResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = explorerWidth;

      const onMouseMove = (ev: MouseEvent) => {
        const newWidth = Math.max(160, Math.min(400, startWidth + ev.clientX - startX));
        setExplorerWidth(newWidth);
      };
      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [explorerWidth]
  );

  const handleRefsResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = refsHeight;

      const onMouseMove = (ev: MouseEvent) => {
        const newHeight = Math.max(100, Math.min(500, startHeight - (ev.clientY - startY)));
        setRefsHeight(newHeight);
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [refsHeight]
  );

  function openReference(ref: ReferenceResult) {
    openTab({
      objectType: ref.objectType,
      fullName: ref.fullName,
      label: ref.label,
      definition: ref.definition,
    });
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Object Explorer */}
      <div style={{ width: explorerWidth, minWidth: explorerWidth }} className="flex-shrink-0">
        <ObjectExplorer />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleExplorerResize}
        className={`w-1 cursor-col-resize hover:bg-accent/30 transition-colors flex-shrink-0 ${
          isResizing ? 'bg-accent/30' : ''
        }`}
      />

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0">
        <CodeTabBar />

        {/* Toolbar with breadcrumb(s) */}
        {activeTab && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-secondary">
            <Breadcrumb objectType={activeTab.objectType} fullName={activeTab.fullName} databaseName={databaseName} />
            {splitTab && (
              <>
                <span className="text-text-muted text-[11px]">|</span>
                <Breadcrumb objectType={splitTab.objectType} fullName={splitTab.fullName} databaseName={databaseName} />
                <button
                  onClick={closeSplit}
                  className="text-text-muted hover:text-text-primary text-xs transition-colors"
                  title="Close split"
                >
                  &times;
                </button>
              </>
            )}
            <div className="ml-auto flex items-center gap-3 text-[11px]">
              {tabs.length >= 2 && (
                <button
                  onClick={() => toggleSplit(activeTab.id)}
                  className={`text-text-secondary hover:text-accent transition-colors ${splitTab ? 'text-accent' : ''}`}
                  title={splitTab ? 'Close split view' : 'Split editor right'}
                >
                  {splitTab ? '◧ Unsplit' : '◫ Split'}
                </button>
              )}
              <button
                onClick={async () => {
                  const ok = await copyAsFormatted(activeTab.definition);
                  setCopyFeedback(ok ? 'copied' : 'failed');
                  setTimeout(() => setCopyFeedback(false), 1500);
                }}
                className={`transition-colors ${copyFeedback === 'failed' ? 'text-severity-error' : 'text-text-secondary hover:text-accent'}`}
                title="Copy with syntax highlighting"
              >
                {copyFeedback === 'copied' ? 'Copied!' : copyFeedback === 'failed' ? 'Failed!' : 'Copy'}
              </button>
              {tabs.length >= 2 && (
                <button
                  onClick={() => setShowDiff(!showDiff)}
                  className={`text-text-secondary hover:text-accent transition-colors ${showDiff ? 'text-accent' : ''}`}
                  title="Compare two open tabs"
                >
                  Diff
                </button>
              )}
              <button
                onClick={handleFindRefs}
                className="text-text-secondary hover:text-accent transition-colors"
                title="Find all references to this object"
              >
                Find References
              </button>
              {activeColumns.length > 0 && (
                <button
                  onClick={handleColumnUsage}
                  className={`text-text-secondary hover:text-accent transition-colors ${colUsageOpen ? 'text-accent' : ''}`}
                  title="Find where a column is used across all objects"
                >
                  Column Usage
                </button>
              )}
              {activeTab && (activeTab.objectType === 'Table') && (
                <button
                  onClick={() => setShowMiniErd(true)}
                  className={`text-text-secondary hover:text-accent transition-colors ${showMiniErd ? 'text-accent' : ''}`}
                  title="Show FK relationship graph for this table"
                >
                  FK Graph
                </button>
              )}
              {activeTab && activeTab.objectType === 'Synonym' && result?.schema && (() => {
                const syn = result.schema.synonyms.find((s) => s.fullName === activeTab.fullName);
                if (!syn) return null;
                const targetObj = identifierMap.get(syn.baseObjectName.toLowerCase());
                if (!targetObj) return null;
                return (
                  <button
                    onClick={() => handleNavigate(targetObj)}
                    className="text-text-secondary hover:text-accent transition-colors"
                    title={`Navigate to ${syn.baseObjectName}`}
                  >
                    Go to Target
                  </button>
                );
              })()}
              <div className="relative">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className={`text-text-secondary hover:text-accent transition-colors ${showSettings ? 'text-accent' : ''}`}
                  title="Visual settings"
                >
                  ⚙
                </button>
                {showSettings && (
                  <div className="absolute right-0 top-full mt-1 bg-bg-card border border-border rounded-lg shadow-2xl z-50 w-52 py-1">
                    <div className="px-3 py-1 text-[9px] text-text-muted uppercase tracking-wider">Visual Settings</div>
                    {([
                      { key: 'outline' as const, label: 'Outline Panel', desc: 'Symbol overview sidebar' },
                      { key: 'parameters' as const, label: 'Parameters', desc: 'Show parameter bar for procs' },
                      { key: 'dmlSummary' as const, label: 'DML Summary', desc: 'Show table operations for procs' },
                      { key: 'dependencies' as const, label: 'Dependencies', desc: 'Show dependency mini-view' },
                      { key: 'callChain' as const, label: 'Call Chain', desc: 'Show caller/callee tree for procs' },
                      { key: 'indentGuides' as const, label: 'Indent Guides', desc: 'Vertical indent lines' },
                      { key: 'bracketColors' as const, label: 'Bracket Colors', desc: 'Colored nested parentheses' },
                      { key: 'highlightOccurrences' as const, label: 'Highlight Occurrences', desc: 'Highlight matching words' },
                    ]).map(({ key, label, desc }) => (
                      <button
                        key={key}
                        onClick={() => setVisualSetting(key, !visualSettings[key])}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors"
                      >
                        <span className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${
                          visualSettings[key] ? 'bg-accent border-accent text-bg-primary text-[9px] font-bold' : 'border-border'
                        }`}>
                          {visualSettings[key] ? '✓' : ''}
                        </span>
                        <span className="text-left">
                          <span className="text-text-primary block">{label}</span>
                          <span className="text-[10px] text-text-muted">{desc}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Parameter bar, DML summary, trigger metadata & dependency mini-view */}
            {visualSettings.parameters && (
              <ParameterBar definition={activeTab.definition} objectType={activeTab.objectType} />
            )}
            {visualSettings.dmlSummary && (activeTab.objectType === 'Procedure' || activeTab.objectType === 'Function') && (
              <DmlSummary definition={activeTab.definition} objectType={activeTab.objectType} fullName={activeTab.fullName} />
            )}
            {activeTab.objectType === 'Trigger' && result?.schema && (() => {
              const trig = result.schema.triggers.find((t) => t.fullName === activeTab.fullName);
              if (!trig) return null;
              return (
                <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-bg-primary overflow-x-auto scrollbar-none">
                  <span className="text-[10px] text-text-muted flex-shrink-0">Trigger:</span>
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-card border border-border/50 text-[10px]">
                    <span className="text-text-muted">Type</span>
                    <span className="text-accent font-medium">{trig.triggerType}</span>
                  </span>
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-card border border-border/50 text-[10px]">
                    <span className="text-text-muted">Events</span>
                    <span className="text-node-function font-medium">{trig.triggerEvents}</span>
                  </span>
                  <button
                    onClick={() => {
                      const table = result.schema!.tables.find((t) => t.fullName === trig.parentFullName);
                      if (table) {
                        openTab({ objectType: 'Table', fullName: table.fullName, label: table.tableName, definition: generateTableDdl(table) });
                      }
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-card border border-border/50 text-[10px] hover:border-accent/30 transition-colors"
                  >
                    <span className="text-text-muted">On</span>
                    <span className="text-text-primary font-medium">{trig.parentTable}</span>
                  </button>
                  {!trig.isEnabled && (
                    <span className="px-1.5 py-0.5 rounded bg-severity-error/10 text-severity-error text-[10px] font-medium">
                      DISABLED
                    </span>
                  )}
                </div>
              );
            })()}
            {activeTab.objectType === 'Job' && result?.schema && (() => {
              const job = result.schema.jobs.find((j) => j.jobName === activeTab.fullName);
              if (!job) return null;
              return (
                <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-bg-primary overflow-x-auto scrollbar-none">
                  <span className="text-[10px] text-text-muted flex-shrink-0">Job:</span>
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-card border border-border/50 text-[10px]">
                    <span className="text-text-muted">Steps</span>
                    <span className="text-accent font-medium">{job.steps.length}</span>
                  </span>
                  {job.scheduleDescription && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-card border border-border/50 text-[10px]">
                      <span className="text-text-muted">Schedule</span>
                      <span className="text-node-function font-medium">{job.scheduleDescription}</span>
                    </span>
                  )}
                  {job.lastRunDate && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-card border border-border/50 text-[10px]">
                      <span className="text-text-muted">Last Run</span>
                      <span className="text-text-secondary">{new Date(job.lastRunDate).toLocaleDateString()}</span>
                    </span>
                  )}
                  {!job.isEnabled && (
                    <span className="px-1.5 py-0.5 rounded bg-severity-error/10 text-severity-error text-[10px] font-medium">
                      DISABLED
                    </span>
                  )}
                </div>
              );
            })()}
            {visualSettings.dependencies && (
              <DependencyMiniView fullName={activeTab.fullName} objectType={activeTab.objectType} />
            )}
            {visualSettings.callChain && (activeTab.objectType === 'Procedure' || activeTab.objectType === 'Function') && (
              <ExecutionChainPanel fullName={activeTab.fullName} objectType={activeTab.objectType} />
            )}

            {/* Diff view or Editor(s) + Outline */}
            {showDiff && splitTab ? (
              <div className="flex-1 min-h-0">
                <DiffView left={activeTab} right={splitTab} onClose={() => setShowDiff(false)} />
              </div>
            ) : showDiff && tabs.length >= 2 ? (
              <div className="flex-1 min-h-0">
                <DiffView
                  left={activeTab}
                  right={tabs.find((t) => t.id !== activeTab.id)!}
                  onClose={() => setShowDiff(false)}
                />
              </div>
            ) : (
            <div className="flex-1 min-h-0 flex">
              <div className={splitTab ? 'flex-1 min-w-0 border-r border-border' : 'flex-1 min-w-0'}>
                <CodeEditor
                  key={activeTab.id}
                  code={activeTab.definition}
                  scrollPos={activeTab.scrollPos}
                  goToLine={activeTab.goToLine ?? outlineGoToLine}
                  onGoToLineDone={handleGoToLineDone}
                  onScrollChange={handleScrollChange}
                  resolveIdentifier={resolveId}
                  onNavigate={handleNavigate}
                  onPeek={handlePeek}
                  resolveTooltip={resolveTooltip}
                  visualSettings={visualSettings}
                />
              </div>
              {splitTab && (
                <div className="flex-1 min-w-0">
                  <CodeEditor
                    key={`split-${splitTab.id}`}
                    code={splitTab.definition}
                    scrollPos={splitTab.scrollPos}
                    onScrollChange={handleSplitScrollChange}
                    resolveIdentifier={resolveId}
                    onNavigate={handleNavigate}
                    onPeek={handlePeek}
                    resolveTooltip={resolveTooltip}
                    visualSettings={visualSettings}
                  />
                </div>
              )}
              {showOutline && (
                <OutlinePanel
                  definition={activeTab.definition}
                  objectType={activeTab.objectType}
                  onGoToLine={handleOutlineGoToLine}
                />
              )}
            </div>
            )}

            {/* Status bar */}
            <StatusBar definition={activeTab.definition} objectType={activeTab.objectType} />

            {/* Column Usage panel */}
            {colUsageOpen && activeColumns.length > 0 && (
              <>
                <div
                  onMouseDown={handleRefsResize}
                  className="h-1 cursor-row-resize hover:bg-accent/30 transition-colors flex-shrink-0"
                />
                <div
                  style={{ height: refsHeight }}
                  className="flex-shrink-0 border-t border-border bg-bg-secondary overflow-hidden flex flex-col"
                >
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-card">
                    <span className="text-[11px] font-medium text-text-primary">Column Usage</span>
                    <select
                      value={colUsageColumn ?? ''}
                      onChange={(e) => setColUsageColumn(e.target.value)}
                      className="text-[11px] bg-bg-primary border border-border rounded px-1.5 py-0.5 text-text-primary"
                    >
                      {activeColumns.map((col) => (
                        <option key={col.name} value={col.name}>{col.name}</option>
                      ))}
                    </select>
                    <span className="text-[10px] text-text-muted">
                      {columnUsageResults.length} object{columnUsageResults.length !== 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={() => setColUsageOpen(false)}
                      className="ml-auto text-text-muted hover:text-text-primary text-sm transition-colors"
                    >
                      &times;
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {columnUsageResults.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-text-muted text-center">
                        No objects reference this column
                      </p>
                    ) : (
                      columnUsageResults.map((ref) => {
                        const color = OBJECT_TYPE_COLORS[ref.objectType] ?? '#666';
                        return (
                          <div key={ref.fullName} className="border-b border-border/30">
                            <button
                              onClick={() => openReference(ref)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors"
                            >
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                              <span className="font-medium text-text-primary">{ref.fullName}</span>
                              <span className="text-[10px] text-text-muted">{ref.objectType}</span>
                            </button>
                            {ref.matchLines.map((ml, i) => (
                              <button
                                key={i}
                                onClick={() => openReference(ref)}
                                className="w-full flex items-start gap-2 pl-7 pr-3 py-0.5 text-[11px] hover:bg-bg-hover/50 transition-colors"
                              >
                                <span className="text-text-muted w-6 text-right flex-shrink-0 font-mono">{ml.lineNum}</span>
                                <span className="font-mono text-text-secondary truncate">{ml.text.trim()}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}

            {/* References panel */}
            {refsOpen && (
              <>
                <div
                  onMouseDown={handleRefsResize}
                  className="h-1 cursor-row-resize hover:bg-accent/30 transition-colors flex-shrink-0"
                />
                <div
                  style={{ height: refsHeight }}
                  className="flex-shrink-0 border-t border-border bg-bg-secondary overflow-hidden flex flex-col"
                >
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-card">
                    <span className="text-[11px] font-medium text-text-primary">
                      References to {refsTarget}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {references.length} object{references.length !== 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={() => setRefsOpen(false)}
                      className="ml-auto text-text-muted hover:text-text-primary text-sm transition-colors"
                    >
                      &times;
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    {references.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-text-muted text-center">
                        No references found
                      </p>
                    ) : (
                      references.map((ref) => {
                        const color = OBJECT_TYPE_COLORS[ref.objectType] ?? '#666';
                        return (
                          <div key={ref.fullName} className="border-b border-border/30">
                            <button
                              onClick={() => openReference(ref)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors"
                            >
                              <span
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <span className="font-medium text-text-primary">{ref.fullName}</span>
                              <span className="text-[10px] text-text-muted">{ref.objectType}</span>
                            </button>
                            {ref.matchLines.map((ml, i) => (
                              <button
                                key={i}
                                onClick={() => openReference(ref)}
                                className="w-full flex items-start gap-2 pl-7 pr-3 py-0.5 text-[11px] hover:bg-bg-hover/50 transition-colors"
                              >
                                <span className="text-text-muted w-6 text-right flex-shrink-0 font-mono">
                                  {ml.lineNum}
                                </span>
                                <span className="font-mono text-text-secondary truncate">
                                  {ml.text.trim()}
                                </span>
                              </button>
                            ))}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
            <div className="text-center space-y-2">
              <div className="text-2xl">{'{ }'}</div>
              <p>Select an object from the explorer to view its SQL definition</p>
              <p className="text-[11px] text-text-muted">
                Ctrl+Click on identifiers in code to navigate to their definitions
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Peek definition overlay */}
      {peekObj && (
        <PeekDefinition
          object={peekObj.obj}
          coords={peekObj.coords}
          onClose={() => setPeekObj(null)}
          onOpenFull={(obj) => handleNavigate(obj)}
        />
      )}

      {/* Mini-ERD modal */}
      {showMiniErd && activeTab && (
        <Suspense fallback={null}>
          <MiniErd
            fullName={activeTab.fullName}
            onClose={() => setShowMiniErd(false)}
            onNavigate={handleNavigate}
          />
        </Suspense>
      )}
    </div>
  );
}
