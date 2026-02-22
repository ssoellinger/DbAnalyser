import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  apiPort: 5174,
  log: {
    info: (...args: unknown[]) => ipcRenderer.send('log-message', 'info', ...args),
    warn: (...args: unknown[]) => ipcRenderer.send('log-message', 'warn', ...args),
    error: (...args: unknown[]) => ipcRenderer.send('log-message', 'error', ...args),
  },
  encrypt: (plaintext: string): Promise<string | null> =>
    ipcRenderer.invoke('safe-storage-encrypt', plaintext),
  decrypt: (cipherBase64: string): Promise<string | null> =>
    ipcRenderer.invoke('safe-storage-decrypt', cipherBase64),
  saveFile: (jsonContent: string, defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog-save-file', jsonContent, defaultName),
  openFile: (): Promise<{ filePath: string; content: string } | null> =>
    ipcRenderer.invoke('dialog-open-file'),
});
