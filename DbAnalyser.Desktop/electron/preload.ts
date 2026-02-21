import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  apiPort: 5174,
  log: {
    info: (...args: unknown[]) => ipcRenderer.send('log-message', 'info', ...args),
    warn: (...args: unknown[]) => ipcRenderer.send('log-message', 'warn', ...args),
    error: (...args: unknown[]) => ipcRenderer.send('log-message', 'error', ...args),
  },
});
