import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/** Editor theme matching the app's dark color scheme */
export const dbAnalyserEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: '#12121a',
    color: '#e0e0e0',
    fontSize: '13px',
    fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
  },
  '.cm-content': {
    caretColor: '#4fc3f7',
    padding: '8px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#4fc3f7',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#4fc3f730',
  },
  '.cm-activeLine': {
    backgroundColor: '#252540',
  },
  '.cm-gutters': {
    backgroundColor: '#0a0a0f',
    color: '#666',
    border: 'none',
    borderRight: '1px solid #2a2a40',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#252540',
    color: '#888',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 16px',
    minWidth: '40px',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 4px',
    color: '#666',
    cursor: 'pointer',
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    color: '#4fc3f7',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: '#252540',
    border: '1px solid #2a2a40',
    color: '#888',
    borderRadius: '3px',
    padding: '0 6px',
    margin: '0 4px',
    cursor: 'pointer',
  },
  '.cm-selectionMatch': {
    backgroundColor: '#4fc3f720',
  },
  '.cm-searchMatch': {
    backgroundColor: '#f0a50040',
    outline: '1px solid #f0a50060',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: '#4fc3f740',
  },
  '.cm-panels': {
    backgroundColor: '#1a1a2e',
    color: '#e0e0e0',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid #2a2a40',
  },
  '.cm-panel.cm-search': {
    padding: '4px 8px',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    backgroundColor: '#0a0a0f',
    color: '#e0e0e0',
    border: '1px solid #2a2a40',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '12px',
  },
  '.cm-panel.cm-search button:hover': {
    backgroundColor: '#252540',
  },
  '.cm-panel.cm-search label': {
    color: '#888',
    fontSize: '12px',
  },
  '.cm-tooltip': {
    backgroundColor: '#1a1a2e',
    border: '1px solid #2a2a40',
    color: '#e0e0e0',
  },
  // Click-through styles
  '.cm-clickable-identifier': {
    cursor: 'pointer',
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: '#4fc3f760',
    textUnderlineOffset: '3px',
  },
  '.cm-clickable-identifier:hover': {
    textDecorationStyle: 'solid',
    textDecorationColor: '#4fc3f7',
    color: '#4fc3f7 !important',
  },
}, { dark: true });

/** Syntax highlighting matching the app theme */
const highlightColors = HighlightStyle.define([
  { tag: tags.keyword, color: '#bb86fc' },
  { tag: tags.operatorKeyword, color: '#bb86fc' },
  { tag: tags.typeName, color: '#4ecca3' },
  { tag: tags.string, color: '#f0a500' },
  { tag: tags.number, color: '#e94560' },
  { tag: tags.bool, color: '#e94560' },
  { tag: tags.null, color: '#e94560' },
  { tag: tags.comment, color: '#666', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#666', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#666', fontStyle: 'italic' },
  { tag: tags.operator, color: '#888' },
  { tag: tags.punctuation, color: '#888' },
  { tag: tags.bracket, color: '#888' },
  { tag: tags.variableName, color: '#e0e0e0' },
  { tag: tags.propertyName, color: '#4fc3f7' },
  { tag: tags.function(tags.variableName), color: '#4fc3f7' },
  { tag: tags.definition(tags.variableName), color: '#4ecca3' },
  { tag: tags.special(tags.variableName), color: '#ff7043' },
]);

export const dbAnalyserHighlighting = syntaxHighlighting(highlightColors);
