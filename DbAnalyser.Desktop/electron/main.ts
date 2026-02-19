import { app, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';

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
  console.log(`Starting API: ${apiPath}`);

  if (!fs.existsSync(apiPath)) {
    console.error(`API executable not found at: ${apiPath}`);
    console.error('Run "dotnet build DbAnalyser.Api" first.');
    return;
  }

  apiProcess = spawn(apiPath, [`--port=${API_PORT}`], {
    stdio: 'pipe',
    env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development' },
  });

  apiProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[API] ${data.toString().trim()}`);
  });

  apiProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[API Error] ${data.toString().trim()}`);
  });

  apiProcess.on('exit', (code) => {
    console.log(`API process exited with code ${code}`);
    apiProcess = null;
  });

  await waitForPort(API_PORT);
  console.log('API is ready');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'DbAnalyser',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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

app.whenReady().then(async () => {
  // Start API in background — don't block window creation
  startApi().catch((e) => console.error('Failed to start API:', e));

  createWindow();
});

app.on('window-all-closed', () => {
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
  app.quit();
});

app.on('before-quit', () => {
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
});

// Electron Forge Vite plugin type declarations
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
