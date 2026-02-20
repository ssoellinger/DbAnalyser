import { useEffect, useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { ConnectionForm, DEFAULT_FIELDS, parseConnectionString, buildConnectionString } from './ConnectionForm';
import { ConnectionHistory } from './ConnectionHistory';
import type { ConnectionFields } from './ConnectionForm';

export function ConnectionPage() {
  const loadHistory = useStore((s) => s.loadHistory);
  const [fields, setFields] = useState<ConnectionFields>(DEFAULT_FIELDS);
  const [rawMode, setRawMode] = useState(false);
  const [rawConnectionString, setRawConnectionString] = useState('');

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleSelectHistory = (connectionString: string) => {
    setFields(parseConnectionString(connectionString));
    setRawConnectionString(connectionString);
    setRawMode(false);
  };

  const handleToggleMode = () => {
    if (rawMode) {
      // switching to form mode — parse what's in the raw textarea
      setFields(parseConnectionString(rawConnectionString));
    } else {
      // switching to raw mode — serialize current fields
      setRawConnectionString(buildConnectionString(fields));
    }
    setRawMode(!rawMode);
  };

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-8">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-text-primary mb-2">DbAnalyser</h1>
          <p className="text-text-secondary text-sm">Database structure and quality analyzer</p>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleToggleMode}
            className="text-xs text-text-muted hover:text-accent transition-colors"
          >
            {rawMode ? 'Form mode' : 'Connection string'}
          </button>
        </div>

        <ConnectionForm
          fields={fields}
          setFields={setFields}
          rawMode={rawMode}
          rawConnectionString={rawConnectionString}
          setRawConnectionString={setRawConnectionString}
        />

        <ConnectionHistory onSelect={handleSelectHistory} />
      </div>
    </div>
  );
}
