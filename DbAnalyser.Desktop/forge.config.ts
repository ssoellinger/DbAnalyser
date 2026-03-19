import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: [
      './resources/api',
      ...(process.platform === 'win32' ? ['./resources/icon.ico'] : ['./resources/icon.png']),
    ],
    name: 'DbAnalyser',
    executableName: 'DbAnalyser',
    icon: './resources/icon',
  },
  makers: [
    new MakerSquirrel({
      name: 'DbAnalyser',
    }),
    new MakerZIP({}, ['win32', 'darwin']),
    new MakerDMG({
      name: 'DbAnalyser',
      icon: './resources/icon.png',
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'electron/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'electron/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
