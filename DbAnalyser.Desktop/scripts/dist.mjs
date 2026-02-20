/**
 * Full distribution build:
 *   1. Publishes the .NET API as a self-contained single-file exe
 *   2. Runs electron-forge make to produce installer + zip
 *
 * Usage: npm run dist
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const apiOutputDir = path.join(desktopRoot, 'resources', 'api');

function run(cmd, cwd) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit', cwd: cwd ?? repoRoot });
}

// Step 1: Clean previous API output
if (existsSync(apiOutputDir)) {
  console.log('Cleaning previous API build...');
  rmSync(apiOutputDir, { recursive: true });
}
mkdirSync(apiOutputDir, { recursive: true });

// Step 2: Publish .NET API as self-contained single-file
console.log('Publishing .NET API...');
run(
  `dotnet publish DbAnalyser.Api -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "${apiOutputDir}"`,
  repoRoot
);

// Step 3: Verify the exe exists
const apiExe = path.join(apiOutputDir, 'DbAnalyser.Api.exe');
if (!existsSync(apiExe)) {
  console.error(`ERROR: API exe not found at ${apiExe}`);
  process.exit(1);
}
console.log(`API published: ${apiExe}`);

// Step 4: Run electron-forge make
console.log('\nBuilding Electron app...');
run('npx electron-forge make', desktopRoot);

console.log('\nDone! Check DbAnalyser.Desktop/out/make/ for the installer and zip.');
