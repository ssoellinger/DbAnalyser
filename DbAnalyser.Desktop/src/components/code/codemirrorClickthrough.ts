import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  keymap,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { ResolvedObject } from './sqlIdentifierResolver';

/**
 * Regex to match SQL identifiers in order of specificity:
 * 1. [schema].[name]  — bracketed two-part
 * 2. schema.name      — dotted two-part
 * 3. [name]           — bracketed single
 * 4. Word             — plain identifier (min 2 chars, starts with letter/underscore)
 * Plain words will match SQL keywords too, but the resolver filters them out.
 */
const IDENTIFIER_RE =
  /(?:\[[\w\s]+\]\.\[[\w\s]+\]|[A-Za-z_][\w]*\.[A-Za-z_][\w]*|\[[\w\s]+\]|[A-Za-z_][\w]+)/g;

const clickableMark = Decoration.mark({ class: 'cm-clickable-identifier' });

/**
 * Creates a CM6 extension that decorates known identifiers with clickable links.
 */
export function clickthroughExtension(
  resolveId: (text: string) => ResolvedObject | null,
  onNavigate: (obj: ResolvedObject) => void,
  onPeek?: (obj: ResolvedObject, coords: { x: number; y: number }) => void,
) {
  const decorate = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    const { from: viewportFrom, to: viewportTo } = view.viewport;

    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      let match: RegExpExecArray | null;
      IDENTIFIER_RE.lastIndex = 0;

      while ((match = IDENTIFIER_RE.exec(text)) !== null) {
        const matchFrom = from + match.index;
        const matchTo = matchFrom + match[0].length;
        if (matchFrom < viewportFrom || matchTo > viewportTo) continue;

        const resolved = resolveId(match[0]);
        if (resolved) {
          builder.add(matchFrom, matchTo, clickableMark);
        }
      }
    }

    return builder.finish();
  };

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorate(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = decorate(update.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );

  // Click handler: Ctrl+Click to navigate, Alt+Click to peek
  const clickHandler = EditorView.domEventHandlers({
    click(event: MouseEvent, view: EditorView) {
      const isNav = event.ctrlKey || event.metaKey;
      const isPeek = event.altKey && !isNav;
      if (!isNav && !isPeek) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const line = view.state.doc.lineAt(pos);
      const lineText = line.text;
      const lineOffset = pos - line.from;

      IDENTIFIER_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = IDENTIFIER_RE.exec(lineText)) !== null) {
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;
        if (lineOffset >= matchStart && lineOffset <= matchEnd) {
          const resolved = resolveId(match[0]);
          if (resolved) {
            event.preventDefault();
            if (isPeek && onPeek) {
              onPeek(resolved, { x: event.clientX, y: event.clientY });
            } else {
              onNavigate(resolved);
            }
            return true;
          }
        }
      }

      return false;
    },
  });

  // Helper: resolve identifier at cursor position
  function resolveAtCursor(view: EditorView): { resolved: ResolvedObject; coords: { x: number; y: number } } | null {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const lineText = line.text;
    const lineOffset = pos - line.from;
    const coords = view.coordsAtPos(pos);

    IDENTIFIER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IDENTIFIER_RE.exec(lineText)) !== null) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      if (lineOffset >= matchStart && lineOffset <= matchEnd) {
        const resolved = resolveId(match[0]);
        if (resolved) {
          return { resolved, coords: coords ? { x: coords.left, y: coords.bottom } : { x: 0, y: 0 } };
        }
      }
    }
    return null;
  }

  const f12Keymap = keymap.of([
    {
      key: 'F12',
      run(view: EditorView) {
        const result = resolveAtCursor(view);
        if (result) { onNavigate(result.resolved); return true; }
        return false;
      },
    },
    {
      key: 'Alt-F12',
      run(view: EditorView) {
        if (!onPeek) return false;
        const result = resolveAtCursor(view);
        if (result) { onPeek(result.resolved, result.coords); return true; }
        return false;
      },
    },
  ]);

  return [plugin, clickHandler, f12Keymap];
}
