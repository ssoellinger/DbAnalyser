import { useRef, useEffect, useMemo } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { sql, MSSQL } from '@codemirror/lang-sql';
import { foldGutter, bracketMatching } from '@codemirror/language';
import { search, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { dbAnalyserEditorTheme, dbAnalyserHighlighting } from './codemirrorTheme';
import { clickthroughExtension } from './codemirrorClickthrough';
import type { ResolvedObject } from './sqlIdentifierResolver';

interface CodeEditorProps {
  code: string;
  scrollPos?: number;
  onScrollChange?: (pos: number) => void;
  resolveIdentifier?: (text: string) => ResolvedObject | null;
  onNavigate?: (obj: ResolvedObject) => void;
}

export function CodeEditor({ code, scrollPos, onScrollChange, resolveIdentifier, onNavigate }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const codeRef = useRef(code);

  // Build extensions once per resolve/navigate change
  const extensions = useMemo(() => {
    const exts = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      foldGutter(),
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
    ];

    if (resolveIdentifier && onNavigate) {
      exts.push(...clickthroughExtension(resolveIdentifier, onNavigate));
    }

    return exts;
  }, [resolveIdentifier, onNavigate]);

  // Create/recreate editor when extensions change
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: codeRef.current,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Restore scroll position
    if (scrollPos) {
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
  }, [extensions]); // eslint-disable-line react-hooks/exhaustive-deps

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
