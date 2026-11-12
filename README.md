# Nan's Windows apps

One small desktop shell, built six times: Helm, Keel, Lodestar, Spinnaker, Holdfast and Fathom.

- Each Windows app opens its app's live address, so every update to the app (pushed to its own repo) shows up the next time the Windows app opens. No download.
- Each app's service worker keeps it working offline after it has opened once online.
- The shell itself updates on its own: it checks this repo's releases when it opens and every 6 hours, downloads in the background and asks to restart. File, Check for desktop updates does it by hand.
- Data lives in the app's own storage inside the Windows app (`%APPDATA%\<App name>`), separate from any browser. Sync through Harbor works as on every other device.

## Download (install once; never again)

| App | Installer |
|---|---|
| Helm | https://github.com/nansan1/desktop/releases/download/helm-latest/Helm-Setup.exe |
| Keel | https://github.com/nansan1/desktop/releases/download/keel-latest/Keel-Setup.exe |
| Lodestar | https://github.com/nansan1/desktop/releases/download/lodestar-latest/Lodestar-Setup.exe |
| Spinnaker | https://github.com/nansan1/desktop/releases/download/spinnaker-latest/Spinnaker-Setup.exe |
| Holdfast | https://github.com/nansan1/desktop/releases/download/holdfast-latest/Holdfast-Setup.exe |
| Fathom | https://github.com/nansan1/desktop/releases/download/fathom-latest/Fathom-Setup.exe |

The installers are not signed, so Windows may say "Windows protected your PC": choose More info, then Run anyway. Each installs for you only (no administrator) with Start menu and desktop shortcuts.

## What the shell adds
- The old Windows bridges, unchanged for the apps: `holdfastDesktop`, `gwDesktop` (Keel), `deskDesktop` (Lodestar, with `saveBackup`), `spkDesktop` (Spinnaker, with `printPdf`). `window.nanDesktop` = `{ app, shellVersion, platform }` on every app.
- Double-click opening: `.holdfast`, `.groundwork` (Keel backups), `.ddesk` (Lodestar backups), `.spinnaker`. Spinnaker also opens `.pptx` passed to it (Open with), without taking over PowerPoint files.
- Links between apps: a link to another app's address (Helm's buttons) opens in that app's Windows app if it is installed (through `nan-<app>://open?u=<address>`), otherwise in the browser. Other web links open in the browser. Google and Microsoft sign-in pages open inside the app (Helm's Connect).
- Right-click menu with spelling suggestions, cut, copy, paste; zoom (Ctrl + and Ctrl -); F11 full screen; Ctrl+R reload. The menu bar is hidden: press Alt.
- Window size and position are remembered. A friendly page with Try again if the app can't load (first open with no internet).

## Releasing a new shell version (only when this repo's code changes)
App updates never need this. Only for changes to `src/`, `apps.json` or the build:
1. Raise `version` in `package.json` and add a line to `CHANGELOG.md`.
2. Commit and push to main. (Pushing tags is blocked from Claude's sessions, so the build runs on pushes to main that touch the shell's files.)
3. GitHub Actions builds all six installers on Windows and replaces the files in each `<app>-latest` release. Installed apps update themselves.

## Adding an app
Add it to `apps.json` (name, address, protocol `nan-<id>`, bridge name or null, file types), add `build/icons/<id>.png` (256x256) and `.ico`, add the id to the matrix in `.github/workflows/build.yml`, and release a new version.

## Testing on Linux
`npm install`, then `DESKTOP_APP=keel DESKTOP_URL=http://localhost:8000/ npx electron .` (any local copy of the app). `node scripts/build.js keel --linux` packages it.
