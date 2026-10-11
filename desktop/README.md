# Guardian Drive for Windows

A small Electron shell that opens the parent web app (https://guardian-drive-ph.web.app) in its
own window, with Start menu and desktop shortcuts. It always shows the live site, so it never
needs updating for website changes; rebuild only to change the window itself (main.js, icon).

- Camera (driver photos), notifications and location are allowed for the Guardian Drive site only.
- Links to other sites open in the normal browser. Google's sign-in popup opens in the app.
- One window: starting it again focuses the running app.

## Build the installer (Windows)

```bash
cd guardian-drive/desktop
npm install
npm run dist -- --config.directories.output="%TEMP%\gd-desktop"
```

Output: `GuardianDrive-Setup.exe` (~110 MB, includes Chromium). Build outside OneDrive-synced
folders: OneDrive locks files while uploading and the build fails with `EPERM ... rename`.
Needs ~1.5 GB of free disk space while building.

If you start it from a VS Code terminal and it exits at once, clear `ELECTRON_RUN_AS_NODE`
(VS Code sets it for child processes). Double-clicking the app is unaffected.

## Publish

Upload `GuardianDrive-Setup.exe` to the same GitHub release as the APK
(github.com/galangec24/guardian-drive-download → Releases). The website's download page links to
`releases/latest/download/GuardianDrive-Setup.exe` (VITE_WINDOWS_URL in web/.env.production).

The installer is not code-signed, so Windows SmartScreen shows "Windows protected your PC":
More info → Run anyway. A code-signing certificate removes that warning.
