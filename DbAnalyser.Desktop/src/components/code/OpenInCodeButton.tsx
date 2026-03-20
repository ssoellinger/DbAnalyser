import { useNavigate } from 'react-router-dom';
import { useStore } from '../../hooks/useStore';
import { useCodeStore } from './useCodeStore';
import { generateTableDdl } from './tableDdlGenerator';

interface OpenInCodeProps {
  /** Full object name, e.g. "dbo.Users" */
  fullName: string;
  /** Object type: Table, View, Procedure, Function, Trigger */
  objectType: string;
  /** Short display name for the tab */
  label?: string;
  /** SQL definition (optional — will be looked up from schema if missing) */
  definition?: string;
  /** Visual variant */
  variant?: 'link' | 'button' | 'icon';
  /** Additional CSS classes */
  className?: string;
}

/**
 * Button/link that opens a database object in the Code IDE.
 * Can be dropped into any page — handles navigation and tab creation.
 */
export function OpenInCodeButton({
  fullName,
  objectType,
  label,
  definition,
  variant = 'link',
  className,
}: OpenInCodeProps) {
  const navigate = useNavigate();
  const openTab = useCodeStore((s) => s.openTab);
  const result = useStore((s) => s.result);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();

    // Resolve definition if not provided
    let def = definition ?? '';
    if (!def && result?.schema) {
      const s = result.schema;
      if (objectType === 'Table') {
        const table = s.tables.find((t) => t.fullName === fullName);
        if (table) def = generateTableDdl(table);
      } else if (objectType === 'View') {
        def = s.views.find((v) => v.fullName === fullName)?.definition ?? '';
      } else if (objectType === 'Procedure') {
        def = s.storedProcedures.find((p) => p.fullName === fullName)?.definition ?? '';
      } else if (objectType === 'Function') {
        def = s.functions.find((f) => f.fullName === fullName)?.definition ?? '';
      } else if (objectType === 'Trigger') {
        def = s.triggers.find((t) => t.fullName === fullName)?.definition ?? '';
      }
    }

    const shortLabel = label ?? fullName.split('.').pop() ?? fullName;
    openTab({ objectType, fullName, label: shortLabel, definition: def });
    navigate('/code');
  }

  if (variant === 'icon') {
    return (
      <button
        onClick={handleClick}
        className={`text-text-muted hover:text-accent transition-colors ${className ?? ''}`}
        title={`Open ${fullName} in Code`}
      >
        {'{ }'}
      </button>
    );
  }

  if (variant === 'button') {
    return (
      <button
        onClick={handleClick}
        className={`px-2 py-1 rounded text-[10px] border border-border text-text-muted hover:text-accent hover:border-accent/50 transition-colors ${className ?? ''}`}
        title={`Open in Code`}
      >
        {'{ }'} Code
      </button>
    );
  }

  // link variant
  return (
    <button
      onClick={handleClick}
      className={`text-[10px] text-accent hover:text-accent-hover transition-colors ${className ?? ''}`}
      title={`Open in Code`}
    >
      Open in Code &rarr;
    </button>
  );
}
