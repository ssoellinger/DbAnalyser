import { useRef, useEffect, useMemo } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { sql, MSSQL } from '@codemirror/lang-sql';
import { foldGutter, bracketMatching } from '@codemirror/language';
import { search, highlightSelectionMatches } from '@codemirror/search';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { dbAnalyserEditorTheme, dbAnalyserHighlighting } from './codemirrorTheme';
import { clickthroughExtension } from './codemirrorClickthrough';
import { sqlFoldService } from './sqlFolding';
import { hoverTooltipExtension, type TooltipInfo } from './codemirrorTooltip';
import { indentGuidesExtension, bracketColorsExtension, highlightOccurrencesExtension, tempTableHighlightExtension } from './editorVisualExtensions';
import type { ResolvedObject } from './sqlIdentifierResolver';
import type { EditorVisualSettings } from './useCodeStore';

interface CodeEditorProps {
  code: string;
  scrollPos?: number;
  goToLine?: number;
  onScrollChange?: (pos: number) => void;
  onGoToLineDone?: () => void;
  resolveIdentifier?: (text: string) => ResolvedObject | null;
  onNavigate?: (obj: ResolvedObject) => void;
  onPeek?: (obj: ResolvedObject, coords: { x: number; y: number }) => void;
  resolveTooltip?: (text: string) => TooltipInfo | null;
  visualSettings?: EditorVisualSettings;
}

// Compartments for dynamically toggled extensions
const indentGuidesCompartment = new Compartment();
const bracketColorsCompartment = new Compartment();
const highlightOccurrencesCompartment = new Compartment();

export function CodeEditor({
  code,
  scrollPos,
  goToLine,
  onScrollChange,
  onGoToLineDone,
  resolveIdentifier,
  onNavigate,
  onPeek,
  resolveTooltip,
  visualSettings,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const codeRef = useRef(code);

  // Build core extensions (stable — only changes when resolve/navigate callbacks change)
  const coreExtensions = useMemo(() => {
    const exts = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      foldGutter({ openText: '▾', closedText: '▸' }),
      sqlFoldService,
      bracketMatching(),
      history(),
      search(),
      highlightSelectionMatches(),
      sql({ dialect: MSSQL }),
      dbAnalyserEditorTheme,
      dbAnalyserHighlighting,
      EditorState.readOnly.of(true),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      ...tempTableHighlightExtension,
    ];

    if (resolveIdentifier && onNavigate) {
      exts.push(...clickthroughExtension(resolveIdentifier, onNavigate, onPeek));
    }

    if (resolveTooltip) {
      exts.push(hoverTooltipExtension(resolveTooltip));
    }

    // Visual settings via compartments (initial values)
    exts.push(indentGuidesCompartment.of(visualSettings?.indentGuides ? indentGuidesExtension : []));
    exts.push(bracketColorsCompartment.of(visualSettings?.bracketColors ? bracketColorsExtension : []));
    exts.push(highlightOccurrencesCompartment.of(visualSettings?.highlightOccurrences ? highlightOccurrencesExtension : []));

    return exts;
  }, [resolveIdentifier, onNavigate, onPeek, resolveTooltip]); // eslint-disable-line react-hooks/exhaustive-deps

  // Create/recreate editor when core extensions change
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: codeRef.current,
      extensions: coreExtensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Restore scroll position (only if no goToLine)
    if (!goToLine && scrollPos) {
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = scrollPos;
      });
    }

    // Track scroll changes
    const scrollHandler = () => {
      onScrollChange?.(view.scrollDOM.scrollTop);
    };
    view.scrollDOM.addEventListener('scroll', scrollHandler, { passive: true });

    return () => {
      view.scrollDOM.removeEventListener('scroll', scrollHandler);
      view.destroy();
      viewRef.current = null;
    };
  }, [coreExtensions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dynamically toggle visual extensions without recreating editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        indentGuidesCompartment.reconfigure(visualSettings?.indentGuides ? indentGuidesExtension : []),
        bracketColorsCompartment.reconfigure(visualSettings?.bracketColors ? bracketColorsExtension : []),
        highlightOccurrencesCompartment.reconfigure(visualSettings?.highlightOccurrences ? highlightOccurrencesExtension : []),
      ],
    });
  }, [visualSettings?.indentGuides, visualSettings?.bracketColors, visualSettings?.highlightOccurrences]);

  // Handle goToLine
  useEffect(() => {
    if (!goToLine || !viewRef.current) return;
    const view = viewRef.current;
    const doc = view.state.doc;
    if (goToLine > doc.lines) return;

    const line = doc.line(goToLine);
    requestAnimationFrame(() => {
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      });
    });

    onGoToLineDone?.();
  }, [goToLine, onGoToLineDone]);

  // Update doc when code changes
  useEffect(() => {
    codeRef.current = code;
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== code) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: code },
      });
    }
  }, [code]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
    />
  );
}
