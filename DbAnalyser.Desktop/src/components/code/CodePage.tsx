import { useCallback, useMemo, useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { AnalyzerLoader } from '../shared/AnalyzerLoader';
import { ObjectExplorer } from './ObjectExplorer';
import { CodeTabBar } from './CodeTabBar';
import { CodeEditor } from './CodeEditor';
import { useCodeStore } from './useCodeStore';
import { buildIdentifierMap, resolveIdentifier } from './sqlIdentifierResolver';
import { generateTableDdl } from './tableDdlGenerator';
import type { ResolvedObject } from './sqlIdentifierResolver';

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

function CodeContent() {
  const result = useStore((s) => s.result);
  const tabs = useCodeStore((s) => s.tabs);
  const activeTabId = useCodeStore((s) => s.activeTabId);
  const openTab = useCodeStore((s) => s.openTab);
  const saveScrollPos = useCodeStore((s) => s.saveScrollPos);
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId]
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

  const handleNavigate = useCallback(
    (obj: ResolvedObject) => {
      let definition = obj.definition;
      // For tables, generate DDL from current schema data
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

  const handleScrollChange = useCallback(
    (pos: number) => {
      if (activeTabId) saveScrollPos(activeTabId, pos);
    },
    [activeTabId, saveScrollPos]
  );

  // Resizable panel handler
  const handleMouseDown = useCallback(
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

  return (
    <div className="flex h-full overflow-hidden">
      {/* Object Explorer */}
      <div style={{ width: explorerWidth, minWidth: explorerWidth }} className="flex-shrink-0">
        <ObjectExplorer />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`w-1 cursor-col-resize hover:bg-accent/30 transition-colors flex-shrink-0 ${
          isResizing ? 'bg-accent/30' : ''
        }`}
      />

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0">
        <CodeTabBar />

        {activeTab ? (
          <div className="flex-1 min-h-0">
            <CodeEditor
              key={activeTab.id}
              code={activeTab.definition}
              scrollPos={activeTab.scrollPos}
              onScrollChange={handleScrollChange}
              resolveIdentifier={resolveId}
              onNavigate={handleNavigate}
            />
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
    </div>
  );
}
