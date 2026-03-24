import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from './useStore';
import { useCodeStore } from '../components/code/useCodeStore';
import { buildObjectLookup } from '../components/code/schemaLookup';

/**
 * Shared hook for navigating to schema objects.
 * Consolidates the repeated handleNodeClick / handleNodeDoubleClick patterns.
 *
 * - `openDetail(fullName)` — opens the Table Detail Panel for a table/view
 * - `openInCode(fullName)` — opens the object in the Code IDE tab
 */
export function useObjectNavigation() {
  const schema = useStore((s) => s.result?.schema ?? null);
  const openDetailPanel = useStore((s) => s.openDetailPanel);
  const openTab = useCodeStore((s) => s.openTab);
  const navigate = useNavigate();

  /** Open the detail panel for a table or view by fullName */
  const openDetail = useCallback((fullName: string) => {
    if (!schema) return;
    if (schema.tables.some((t) => t.fullName === fullName)) openDetailPanel(fullName, 'Table');
    else if (schema.views.some((v) => v.fullName === fullName)) openDetailPanel(fullName, 'View');
  }, [schema, openDetailPanel]);

  /** Open any schema object in the Code IDE */
  const openInCode = useCallback((fullName: string) => {
    if (!schema) return;
    const lookup = buildObjectLookup(schema);
    const obj = lookup.get(fullName) ?? lookup.get(fullName.toLowerCase());
    if (obj) {
      openTab(obj);
      navigate('/code');
    }
  }, [schema, openTab, navigate]);

  return { openDetail, openInCode };
}
