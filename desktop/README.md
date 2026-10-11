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

## Publish (and how updates reach installed apps)

1. Raise `"version"` in `desktop/package.json` (and `version:` in `mobile_app/pubspec.yaml`).
2. Build: the output folder then holds `GuardianDrive-Setup.exe`, `GuardianDrive-Setup.exe.blockmap`
   and `latest.yml`.
3. Create a GitHub release in github.com/galangec24/guardian-drive-download whose tag is **v** + that
   version (e.g. `v1.0.6`) and attach all three files plus `GuardianDrive.apk`.

Installed Windows apps check `latest.yml` 10 s after starting and every 6 hours, download the new
installer in the background and ask "Restart now?" (or install when closed). Settings → Updates
also has a **Check for updates** button. Android apps compare their version with the release tag
on start and offer **Update**; the website updates itself.

The tag must match the version exactly (`v1.0.6` for 1.0.6) or the updater can't find the files.

The installer is not code-signed, so Windows SmartScreen shows "Windows protected your PC":
More info → Run anyway. A code-signing certificate removes that warning.
