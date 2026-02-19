import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  apiPort: 5174,
});
