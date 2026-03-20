/**
 * Full distribution build:
 *   1. Publishes the .NET API as a self-contained single-file executable
 *   2. Runs electron-forge make to produce installer + zip
 *
 * Usage: npm run dist
 *        npm run dist -- --platform darwin-arm64
 *        npm run dist -- --platform darwin-x64
 *        npm run dist -- --platform win-x64
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const apiOutputDir = path.join(desktopRoot, 'resources', 'api');

// Determine target platform
const platformIdx = process.argv.indexOf('--platform');
const platformArg = process.argv.find(a => a.startsWith('--platform='))?.split('=')[1]
  ?? (platformIdx !== -1 ? process.argv[platformIdx + 1] : undefined);

function detectRid() {
  const plat = os.platform();
  const arch = os.arch();
  if (plat === 'win32') return 'win-x64';
  if (plat === 'darwin') return arch === 'arm64' ? 'osx-arm64' : 'osx-x64';
  return 'linux-x64';
}

const rid = platformArg ?? detectRid();
const isWindows = rid.startsWith('win');
const exeName = isWindows ? 'DbAnalyser.Api.exe' : 'DbAnalyser.Api';

function run(cmd, cwd) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit', cwd: cwd ?? repoRoot });
}

console.log(`Building for: ${rid}`);

// Step 1: Clean previous API output
if (existsSync(apiOutputDir)) {
  console.log('Cleaning previous API build...');
  rmSync(apiOutputDir, { recursive: true });
}
mkdirSync(apiOutputDir, { recursive: true });

// Step 2: Publish .NET API as self-contained single-file
console.log('Publishing .NET API...');
run(
  `dotnet publish DbAnalyser.Api -c Release -r ${rid} --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "${apiOutputDir}"`,
  repoRoot
);

// Step 3: Verify the executable exists
const apiExe = path.join(apiOutputDir, exeName);
if (!existsSync(apiExe)) {
  console.error(`ERROR: API executable not found at ${apiExe}`);
  process.exit(1);
}
// Ensure executable permission on Unix
if (!isWindows) {
  execSync(`chmod +x "${apiExe}"`);
}
console.log(`API published: ${apiExe}`);

// Step 4: Run electron-forge make
console.log('\nBuilding Electron app...');
run('npx electron-forge make', desktopRoot);

console.log('\nDone! Check DbAnalyser.Desktop/out/make/ for the installer and zip.');
