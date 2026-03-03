/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface Window {
  electronAPI?: {
    apiPort: number;
    log: {
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
    };
    encrypt: (plaintext: string) => Promise<string | null>;
    decrypt: (cipherBase64: string) => Promise<string | null>;
    saveFile: (jsonContent: string, defaultName: string) => Promise<string | null>;
    openFile: () => Promise<{ filePath: string; content: string } | null>;
    aiChat: (config: import('./api/types').AiProviderConfig, systemPrompt: string, messages: import('./api/types').AiMessage[]) => Promise<void>;
    aiStop: () => Promise<void>;
    onAiChunk: (callback: (chunk: { text?: string; done?: boolean; error?: string }) => void) => () => void;
    aiGetConfig: () => Promise<import('./api/types').AiProviderConfig | null>;
    aiSaveConfig: (config: import('./api/types').AiProviderConfig) => Promise<void>;
  };
}
