import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
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

const API_PORT = 5174;

function getApiPath(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    // app.getAppPath() = DbAnalyser.Desktop root; API is a sibling project
    const appRoot = app.getAppPath();
    return path.resolve(appRoot, '..', 'DbAnalyser.Api', 'bin', 'Debug', 'net8.0', 'DbAnalyser.Api.exe');
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
