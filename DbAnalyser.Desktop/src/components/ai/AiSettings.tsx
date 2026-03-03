import { useState, useEffect } from 'react';
import type { AiProviderConfig } from '../../api/types';

interface AiSettingsProps {
  open: boolean;
  onClose: () => void;
  onSaved: (config: AiProviderConfig) => void;
}

const PRESETS: { label: string; config: Partial<AiProviderConfig> }[] = [
  { label: 'Anthropic Claude', config: { type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514' } },
  { label: 'Ollama (local)', config: { type: 'openai', baseUrl: 'http://localhost:11434', model: 'llama3' } },
  { label: 'LM Studio (local)', config: { type: 'openai', baseUrl: 'http://localhost:1234', model: '' } },
  { label: 'Custom', config: { type: 'openai', baseUrl: '', model: '' } },
];

const INPUT_CLASS = 'w-full bg-bg-primary border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none';
const LABEL_CLASS = 'block text-xs text-text-secondary mb-1';

export function AiSettings({ open, onClose, onSaved }: AiSettingsProps) {
  const [config, setConfig] = useState<AiProviderConfig>({
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    apiKey: '',
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTestResult(null);
      window.electronAPI?.aiGetConfig().then((saved) => {
        if (saved) setConfig(saved);
      });
    }
  }, [open]);

  if (!open) return null;

  function applyPreset(preset: Partial<AiProviderConfig>) {
    setConfig((prev) => ({ ...prev, ...preset }));
    setTestResult(null);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);

    try {
      // Set up a one-shot listener for the test response
      const result = await new Promise<{ ok: boolean; message: string }>((resolve) => {
        let gotText = false;
        const cleanup = window.electronAPI!.onAiChunk((chunk) => {
          if (chunk.error) {
            cleanup();
            resolve({ ok: false, message: chunk.error });
          } else if (chunk.text) {
            gotText = true;
          } else if (chunk.done) {
            cleanup();
            resolve(gotText
              ? { ok: true, message: 'Connection successful!' }
              : { ok: false, message: 'No response received' });
          }
        });

        window.electronAPI!.aiChat(
          config,
          'Reply with exactly: OK',
          [{ role: 'user', content: 'Test connection' }]
        ).catch((err: Error) => {
          cleanup();
          resolve({ ok: false, message: err.message });
        });

        // Timeout after 15s
        setTimeout(() => {
          cleanup();
          window.electronAPI?.aiStop();
          resolve({ ok: false, message: 'Connection timed out (15s)' });
        }, 15_000);
      });

      setTestResult(result);
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await window.electronAPI?.aiSaveConfig(config);
      onSaved(config);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-bg-card border border-border rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">AI Provider Settings</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Presets */}
          <div>
            <label className={LABEL_CLASS}>Preset</label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p.config)}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    config.type === p.config.type && config.baseUrl === p.config.baseUrl
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-text-secondary hover:text-text-primary hover:border-text-muted'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Provider type */}
          <div>
            <label className={LABEL_CLASS}>Provider Type</label>
            <select
              value={config.type}
              onChange={(e) => setConfig({ ...config, type: e.target.value as 'anthropic' | 'openai' })}
              className={INPUT_CLASS}
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI-compatible</option>
            </select>
          </div>

          {/* Base URL */}
          <div>
            <label className={LABEL_CLASS}>Base URL</label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              placeholder="https://api.anthropic.com"
              className={INPUT_CLASS}
            />
          </div>

          {/* Model */}
          <div>
            <label className={LABEL_CLASS}>Model</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder={config.type === 'anthropic' ? 'claude-sonnet-4-20250514' : 'llama3'}
              className={INPUT_CLASS}
            />
          </div>

          {/* API Key */}
          <div>
            <label className={LABEL_CLASS}>API Key {config.type === 'openai' && '(optional for local models)'}</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder="sk-..."
              className={INPUT_CLASS}
            />
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`text-xs px-3 py-2 rounded ${testResult.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {testResult.message}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleTest}
              disabled={testing || !config.baseUrl || !config.model}
              className="px-4 py-2 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:border-text-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !config.baseUrl || !config.model}
              className="px-4 py-2 text-xs rounded bg-accent text-bg-primary font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors ml-auto"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
