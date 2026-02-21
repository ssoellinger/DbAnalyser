import { Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './hooks/useStore';
import { AppShell } from './components/layout/AppShell';
import { ConnectionPage } from './components/connect/ConnectionPage';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { DependenciesPage } from './components/dependencies/DependenciesPage';
import { ErdPage } from './components/erd/ErdPage';
import { LineagePage } from './components/lineage/LineagePage';
import { SchemaPage } from './components/schema/SchemaPage';
import { ProfilingPage } from './components/profiling/ProfilingPage';
import { RelationshipsPage } from './components/relationships/RelationshipsPage';
import { QualityPage } from './components/quality/QualityPage';
import { IndexingPage } from './components/indexing/IndexingPage';
import { UsagePage } from './components/usage/UsagePage';

export default function App() {
  const sessionId = useStore((s) => s.sessionId);

  if (!sessionId) {
    return <ConnectionPage />;
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dependencies" element={<DependenciesPage />} />
        <Route path="/erd" element={<ErdPage />} />
        <Route path="/lineage" element={<LineagePage />} />
        <Route path="/schema" element={<SchemaPage />} />
        <Route path="/profiling" element={<ProfilingPage />} />
        <Route path="/relationships" element={<RelationshipsPage />} />
        <Route path="/quality" element={<QualityPage />} />
        <Route path="/indexing" element={<IndexingPage />} />
        <Route path="/usage" element={<UsagePage />} />
      </Routes>
    </AppShell>
  );
}
