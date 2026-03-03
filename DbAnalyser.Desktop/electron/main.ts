import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import log from 'electron-log/main';

// Configure electron-log
log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.file.resolvePathFn = () =>
  path.join(app.getPath('userData'), 'logs', 'main.log');

let apiProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let aiAbortController: AbortController | null = null;

const API_PORT = 5174;

function getApiPath(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    // app.getAppPath() = DbAnalyser.Desktop root; API is a sibling project
    const appRoot = app.getAppPath();
    return path.resolve(appRoot, '..', 'DbAnalyser.Api', 'bin', 'Debug', 'net10.0', 'DbAnalyser.Api.exe');
  }
  return path.join(process.resourcesPath, 'api', 'DbAnalyser.Api.exe');
}

function waitForPort(port: number, timeout = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    function tryConnect() {
      const socket = new net.Socket();
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start > timeout) {
          reject(new Error(`API did not start within ${timeout}ms`));
        } else {
          setTimeout(tryConnect, 200);
        }
      });
      socket.connect(port, '127.0.0.1');
    }

    tryConnect();
  });
}

async function startApi(): Promise<void> {
  const apiPath = getApiPath();
  log.info(`Starting API: ${apiPath}`);

  if (!fs.existsSync(apiPath)) {
    log.error(`API executable not found at: ${apiPath}`);
    log.error('Run "dotnet build DbAnalyser.Api" first.');
    return;
  }

  const logDir = path.join(app.getPath('userData'), 'logs');
  apiProcess = spawn(apiPath, [`--port=${API_PORT}`], {
    stdio: 'pipe',
    env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development', DBANALYSER_LOG_DIR: logDir },
  });

  apiProcess.stdout?.on('data', (data: Buffer) => {
    log.info(`[API] ${data.toString().trim()}`);
  });

  apiProcess.stderr?.on('data', (data: Buffer) => {
    log.error(`[API Error] ${data.toString().trim()}`);
  });

  apiProcess.on('exit', (code) => {
    log.info(`API process exited with code ${code}`);
    apiProcess = null;
  });

  await waitForPort(API_PORT);
  log.info('API is ready');
}

function createWindow(): void {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(app.getAppPath(), 'resources', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'DbAnalyser',
    icon: iconPath,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // In dev, load from Vite dev server; in prod, load the built files
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handler for renderer log messages
ipcMain.on('log-message', (_event, level: string, ...args: unknown[]) => {
  const message = `[Renderer] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
  switch (level) {
    case 'error': log.error(message); break;
    case 'warn': log.warn(message); break;
    default: log.info(message); break;
  }
});

// IPC handlers for encrypting/decrypting credentials via OS credential store
ipcMain.handle('safe-storage-encrypt', (_event, plaintext: string) => {
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.encryptString(plaintext).toString('base64');
});

ipcMain.handle('safe-storage-decrypt', (_event, cipherBase64: string) => {
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.decryptString(Buffer.from(cipherBase64, 'base64'));
});

// IPC handler: Save .dba file
ipcMain.handle('dialog-save-file', async (_event, jsonContent: string, defaultName: string) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Analysis',
    defaultPath: defaultName,
    filters: [{ name: 'DbAnalyser Files', extensions: ['dba'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, jsonContent, 'utf-8');
  return filePath;
});

// IPC handler: Open .dba file
ipcMain.handle('dialog-open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open Analysis',
    filters: [{ name: 'DbAnalyser Files', extensions: ['dba'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  const content = fs.readFileSync(filePaths[0], 'utf-8');
  return { filePath: filePaths[0], content };
});

// ── AI Config persistence ──────────────────────────────────────────────────

const AI_CONFIG_FILE = 'ai-config.json';
const AI_KEY_STORAGE_KEY = 'ai-api-key';

function getAiConfigPath(): string {
  return path.join(app.getPath('userData'), AI_CONFIG_FILE);
}

ipcMain.handle('ai-get-config', () => {
  try {
    const configPath = getAiConfigPath();
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // Decrypt API key if stored
    if (raw._encryptedKey && safeStorage.isEncryptionAvailable()) {
      try {
        raw.apiKey = safeStorage.decryptString(Buffer.from(raw._encryptedKey, 'base64'));
      } catch {
        raw.apiKey = '';
      }
    }
    delete raw._encryptedKey;
    return raw;
  } catch (e) {
    log.error('Failed to read AI config:', e);
    return null;
  }
});

ipcMain.handle('ai-save-config', (_event, config: { type: string; baseUrl: string; model: string; apiKey: string }) => {
  try {
    const toWrite: Record<string, unknown> = {
      type: config.type,
      baseUrl: config.baseUrl,
      model: config.model,
    };
    // Encrypt API key separately
    if (config.apiKey && safeStorage.isEncryptionAvailable()) {
      toWrite._encryptedKey = safeStorage.encryptString(config.apiKey).toString('base64');
    }
    fs.writeFileSync(getAiConfigPath(), JSON.stringify(toWrite, null, 2), 'utf-8');
  } catch (e) {
    log.error('Failed to save AI config:', e);
  }
});

// ── AI Chat streaming ──────────────────────────────────────────────────────

function sendAiChunk(chunk: { text?: string; done?: boolean; error?: string }) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ai-chunk', chunk);
  }
}

async function streamAnthropicChat(
  baseUrl: string, model: string, apiKey: string,
  systemPrompt: string, messages: { role: string; content: string }[],
  signal: AbortSignal
) {
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      stream: true,
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      try {
        const event = JSON.parse(jsonStr);
        if (event.type === 'content_block_delta' && event.delta?.text) {
          sendAiChunk({ text: event.delta.text });
        }
      } catch { /* skip malformed JSON */ }
    }
  }
}

async function streamOpenAiChat(
  baseUrl: string, model: string, apiKey: string,
  systemPrompt: string, messages: { role: string; content: string }[],
  signal: AbortSignal
) {
  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // Normalize base URL — strip trailing /v1 if present, we add it ourselves
  const base = baseUrl.replace(/\/v1\/?$/, '');
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages: allMessages, stream: true }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI-compatible API error ${res.status}: ${body}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === '[DONE]') continue;
      if (!jsonStr) continue;
      try {
        const event = JSON.parse(jsonStr);
        const content = event.choices?.[0]?.delta?.content;
        if (content) sendAiChunk({ text: content });
      } catch { /* skip malformed JSON */ }
    }
  }
}

ipcMain.handle('ai-chat', async (
  _event,
  config: { type: string; baseUrl: string; model: string; apiKey: string },
  systemPrompt: string,
  messages: { role: string; content: string }[]
) => {
  // Abort any previous request
  if (aiAbortController) {
    aiAbortController.abort();
  }
  aiAbortController = new AbortController();
  const { signal } = aiAbortController;

  try {
    if (config.type === 'anthropic') {
      await streamAnthropicChat(config.baseUrl, config.model, config.apiKey, systemPrompt, messages, signal);
    } else {
      await streamOpenAiChat(config.baseUrl, config.model, config.apiKey, systemPrompt, messages, signal);
    }
    sendAiChunk({ done: true });
  } catch (e: unknown) {
    if ((e as Error).name === 'AbortError') {
      sendAiChunk({ done: true });
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('AI chat error:', msg);
      sendAiChunk({ error: msg });
    }
  } finally {
    aiAbortController = null;
  }
});

ipcMain.handle('ai-stop', () => {
  if (aiAbortController) {
    aiAbortController.abort();
    aiAbortController = null;
  }
});

app.whenReady().then(async () => {
  log.info(`DbAnalyser v${app.getVersion()} starting`);

  // Start API in background — don't block window creation
  startApi().catch((e) => log.error('Failed to start API:', e));

  createWindow();
});

app.on('window-all-closed', () => {
  log.info('All windows closed, shutting down');
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
  app.quit();
});

app.on('before-quit', () => {
  log.info('App shutting down');
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
});

// Electron Forge Vite plugin type declarations
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
