import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../../hooks/useStore';
import { buildAiContext } from '../../utils/buildAiContext';
import { AiSettings } from './AiSettings';
import type { AiProviderConfig, AiMessage } from '../../api/types';

type ContextMode = 'single' | 'last10' | 'unlimited';

const CONTEXT_MODES: { value: ContextMode; label: string; title: string }[] = [
  { value: 'single', label: '1', title: 'Single message — no conversation history' },
  { value: 'last10', label: '10', title: 'Last 10 messages' },
  { value: 'unlimited', label: '∞', title: 'Unlimited — full conversation history' },
];

const QUICK_PROMPTS = [
  { label: 'Summarize', prompt: 'Give me a concise summary of this database \u2014 what is it used for, how is it structured, and what are its key entities?' },
  { label: 'Issues', prompt: 'What are the most critical issues with this database? Prioritize by impact and give actionable recommendations.' },
  { label: 'Relationships', prompt: 'Explain how the main tables in this database relate to each other. Highlight any unusual or problematic patterns.' },
  { label: 'Improvements', prompt: 'Suggest the top 5 improvements I should make to this database, considering structure, indexing, quality, and usage patterns.' },
];

export function AiPage() {
  const result = useStore((s) => s.result);
  const serverName = useStore((s) => s.serverName);
  const analyzerStatus = useStore((s) => s.analyzerStatus);
  const aiPendingPrompt = useStore((s) => s.aiPendingPrompt);
  const setAiPendingPrompt = useStore((s) => s.setAiPendingPrompt);
  const aiExplainEnabled = useStore((s) => s.aiExplainEnabled);
  const toggleAiExplain = useStore((s) => s.toggleAiExplain);

  const [config, setConfig] = useState<AiProviderConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [contextMode, setContextMode] = useState<ContextMode>('last10');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingTextRef = useRef('');

  // Load config on mount
  useEffect(() => {
    window.electronAPI?.aiGetConfig().then((saved) => {
      if (saved) setConfig(saved);
      setConfigLoaded(true);
    });
  }, []);

  // Auto-send pending prompt (from "Explain this" in Code/Query page)
  useEffect(() => {
    if (aiPendingPrompt && configLoaded && config && result && !streaming) {
      const prompt = aiPendingPrompt;
      setAiPendingPrompt(null);
      // Small delay to ensure component is fully mounted
      setTimeout(() => sendMessage(prompt), 100);
    }
  }, [aiPendingPrompt, configLoaded, config, result, streaming]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Listen for AI chunks
  useEffect(() => {
    if (!streaming) return;

    const cleanup = window.electronAPI!.onAiChunk((chunk) => {
      if (chunk.text) {
        streamingTextRef.current += chunk.text;
        setStreamingText(streamingTextRef.current);
      } else if (chunk.done) {
        const finalText = streamingTextRef.current;
        streamingTextRef.current = '';
        setStreamingText('');
        if (finalText) {
          setMessages((msgs) => [...msgs, { role: 'assistant', content: finalText }]);
        }
        setStreaming(false);
      } else if (chunk.error) {
        const finalText = streamingTextRef.current;
        streamingTextRef.current = '';
        setStreamingText('');
        if (finalText) {
          setMessages((msgs) => [...msgs, { role: 'assistant', content: finalText }]);
        }
        setMessages((msgs) => [...msgs, { role: 'assistant', content: `**Error:** ${chunk.error}` }]);
        setStreaming(false);
      }
    });

    return cleanup;
  }, [streaming]);

  const sendMessage = useCallback((text: string) => {
    if (!config || !result || streaming) return;

    const userMsg: AiMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);
    setStreamingText('');
    streamingTextRef.current = '';

    const systemPrompt = buildAiContext({ result, serverName, analyzerStatus });

    let messagesToSend = newMessages;
    if (contextMode === 'single') {
      messagesToSend = [userMsg];
    } else if (contextMode === 'last10') {
      messagesToSend = newMessages.slice(-10);
    }

    window.electronAPI!.aiChat(config, systemPrompt, messagesToSend);
  }, [config, result, streaming, messages, serverName, analyzerStatus, contextMode]);

  function handleStop() {
    window.electronAPI?.aiStop();
  }

  function handleClear() {
    setMessages([]);
    setStreamingText('');
    streamingTextRef.current = '';
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) sendMessage(input.trim());
    }
  }

  // Not yet loaded
  if (!configLoaded) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        Loading...
      </div>
    );
  }

  // No provider configured
  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-center space-y-2">
          <div className="text-3xl">&#x2726;</div>
          <h2 className="text-lg font-semibold text-text-primary">AI Insights</h2>
          <p className="text-sm text-text-secondary max-w-sm">
            Ask questions about your database structure, quality issues, relationships, and more.
            Configure an AI provider to get started.
          </p>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="px-5 py-2.5 rounded bg-accent text-bg-primary font-medium text-sm hover:bg-accent-hover transition-colors"
        >
          Configure AI Provider
        </button>
        <AiSettings
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onSaved={(c) => setConfig(c)}
        />
      </div>
    );
  }

  // No analysis data
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <div className="text-3xl">&#x2726;</div>
        <p className="text-sm text-text-secondary">Run some analyzers or open a .dba file first to use AI Insights.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-accent">&#x2726;</span>
          <h1 className="text-sm font-semibold text-text-primary">AI Insights</h1>
          <span className="text-xs text-text-muted">({config.model})</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Context mode toggle */}
          <div className="flex items-center border border-border rounded overflow-hidden">
            {CONTEXT_MODES.map((mode) => (
              <button
                key={mode.value}
                onClick={() => setContextMode(mode.value)}
                title={mode.title}
                className={`px-2 py-1 text-[11px] font-medium transition-colors ${
                  contextMode === mode.value
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="px-3 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="px-3 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors"
            title="AI Settings"
          >
            &#x2699;
          </button>
          <label className="flex items-center gap-1.5 text-xs text-text-secondary ml-2 cursor-pointer" title="Show 'AI Explain' buttons in Code and Query pages">
            <input
              type="checkbox"
              checked={aiExplainEnabled}
              onChange={toggleAiExplain}
              className="accent-accent"
            />
            AI Explain
          </label>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <p className="text-sm text-text-secondary">Ask a question or pick a quick prompt:</p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp.label}
                  onClick={() => sendMessage(qp.prompt)}
                  className="px-3 py-2 text-xs rounded border border-border text-text-secondary hover:text-accent hover:border-accent transition-colors"
                >
                  {qp.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-accent/15 text-text-primary'
                  : 'bg-bg-secondary text-text-primary border border-border'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {streaming && streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap bg-bg-secondary text-text-primary border border-border">
              {streamingText}
              <span className="inline-block w-1.5 h-4 bg-accent/60 animate-pulse ml-0.5 align-text-bottom" />
            </div>
          </div>
        )}

        {streaming && !streamingText && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2.5 text-sm bg-bg-secondary border border-border text-text-muted">
              Thinking...
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Quick prompts bar (only when conversation has messages) */}
      {messages.length > 0 && !streaming && (
        <div className="flex gap-2 px-6 pb-2 flex-shrink-0">
          {QUICK_PROMPTS.map((qp) => (
            <button
              key={qp.label}
              onClick={() => sendMessage(qp.prompt)}
              className="px-2.5 py-1 text-[11px] rounded border border-border text-text-muted hover:text-accent hover:border-accent transition-colors"
            >
              {qp.label}
            </button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div className="px-6 pb-4 pt-2 border-t border-border flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your database..."
            rows={1}
            className="flex-1 bg-bg-primary border border-border rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none resize-none"
            disabled={streaming}
          />
          {streaming ? (
            <button
              onClick={handleStop}
              className="px-4 py-2.5 rounded-lg bg-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/30 transition-colors flex-shrink-0"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={() => input.trim() && sendMessage(input.trim())}
              disabled={!input.trim()}
              className="px-4 py-2.5 rounded-lg bg-accent text-bg-primary text-sm font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              Send
            </button>
          )}
        </div>
      </div>

      <AiSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(c) => setConfig(c)}
      />
    </div>
  );
}
