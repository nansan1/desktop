'use strict';
// node scripts/build.js <app> [--dir] [--linux]
// Builds one app's Windows installer into dist/<app>/ (Keel-Setup.exe, latest.yml, blockmap).
const path = require('path');
const builder = require('electron-builder');
const APPS = require('../apps.json');
const pkg = require('../package.json');

const id = process.argv[2];
const dirOnly = process.argv.includes('--dir');
const linux = process.argv.includes('--linux'); // local testing only
const a = APPS[id];
if (!a) { console.error('Usage: node scripts/build.js <' + Object.keys(APPS).join('|') + '>'); process.exit(1); }

const config = {
  appId: 'com.nan2nan.' + id,
  productName: a.name,
  executableName: a.name,
  copyright: 'Nan',
  extraMetadata: { name: 'nan-' + id, productName: a.name, desktopApp: id, description: a.name + ' for Windows' },
  directories: { output: 'dist/' + id, buildResources: 'build' },
  files: ['src/**', 'apps.json', 'package.json', 'build/icons/' + a.icon + '.png'],
  asar: true,
  publish: { provider: 'generic', url: 'https://github.com/nansan1/desktop/releases/download/' + id + '-latest/' },
  fileAssociations: (a.files || []).map(f => ({ ext: f.ext, name: f.name, description: f.name, icon: 'build/icons/' + a.icon + '.ico' })),
  protocols: [{ name: a.name + ' link', schemes: [a.protocol] }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icons/' + a.icon + '.ico',
    artifactName: a.name + '-Setup.${ext}'
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: a.name,
    uninstallDisplayName: a.name,
    installerIcon: 'build/icons/' + a.icon + '.ico',
    uninstallerIcon: 'build/icons/' + a.icon + '.ico'
  },
  linux: { target: 'dir', icon: 'build/icons/' + a.icon + '.png', executableName: id }
};

const targets = linux
  ? builder.Platform.LINUX.createTarget('dir', builder.Arch.x64)
  : builder.Platform.WINDOWS.createTarget(dirOnly ? 'dir' : 'nsis', builder.Arch.x64);

builder.build({ targets, config, publish: 'never' })
  .then(out => { console.log(a.name + ' ' + pkg.version + ' built:\n  ' + out.map(p => path.relative(process.cwd(), p)).join('\n  ')); })
  .catch(e => { console.error(e); process.exit(1); });
