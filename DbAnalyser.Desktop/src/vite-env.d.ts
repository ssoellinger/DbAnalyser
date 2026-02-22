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
  };
}
