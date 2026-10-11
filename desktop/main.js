/**
 * Guardian Drive for Windows: the parent web app (the same site as the browser version) in its own
 * window, with a Start menu / desktop shortcut. The page itself is always the live site; the app
 * shell updates itself from the GitHub releases (electron-updater: latest.yml + the installer).
 */
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');
const { autoUpdater } = require('electron-updater');

const APP_URL = process.env.GUARDIAN_DRIVE_URL || 'https://guardian-drive-ph.web.app';
const APP_ORIGIN = new URL(APP_URL).origin;
// Google's sign-in popup is allowed in-app; every other outside link opens in the normal browser.
const GOOGLE_SIGN_IN = /^https:\/\/accounts\.google\.com\//;
// Google sign-in for the app happens on this page of the site, opened in the user's browser.
const APP_LOGIN = `${APP_ORIGIN}/app-login?`;

// One window only: opening the shortcut again focuses the running app.
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 380,
    minHeight: 600,
    title: 'Guardian Drive',
    backgroundColor: '#05060f',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (GOOGLE_SIGN_IN.test(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 500, height: 640, autoHideMenuBar: true } };
    }
    if (!url.startsWith(APP_ORIGIN)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN) && !GOOGLE_SIGN_IN.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.loadURL(APP_URL);
}

// The site may only open its own app sign-in page in the browser; anything else is refused.
ipcMain.handle('open-external', (_event, url) => {
  if (typeof url !== 'string' || !url.startsWith(APP_LOGIN)) throw new Error('not allowed');
  return shell.openExternal(url);
});

// ---------------------------------------------------------------- updates
// Downloads quietly in the background, then asks to restart; also installs when the app is closed.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;
let updateState = { status: 'idle', version: null };

autoUpdater.on('update-available', (info) => {
  updateState = { status: 'downloading', version: info.version };
});
autoUpdater.on('update-not-available', () => {
  updateState = { status: 'up-to-date', version: null };
});
autoUpdater.on('error', (err) => {
  updateState = { status: 'error', version: null, message: String((err && err.message) || err).slice(0, 200) };
});
autoUpdater.on('update-downloaded', async (info) => {
  updateState = { status: 'ready', version: info.version };
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update ready',
    message: `Guardian Drive ${info.version} is ready to install.`,
    detail: 'Restart the app to finish updating. If you choose Later, it installs the next time you close the app.',
  });
  if (response === 0) autoUpdater.quitAndInstall();
});

async function checkForUpdates() {
  if (!app.isPackaged) return { status: 'dev', version: null };
  if (updateState.status === 'downloading' || updateState.status === 'ready') return updateState;
  try {
    updateState = { status: 'checking', version: null };
    await autoUpdater.checkForUpdates();
  } catch (err) {
    updateState = { status: 'error', version: null, message: String((err && err.message) || err).slice(0, 200) };
  }
  return updateState;
}

// For the site's Settings page ("Windows app version … · Check for updates").
ipcMain.handle('app-info', () => ({ version: app.getVersion(), update: updateState }));
ipcMain.handle('check-updates', () => checkForUpdates());
ipcMain.handle('install-update', () => {
  if (updateState.status === 'ready') autoUpdater.quitAndInstall();
  return updateState;
});

app.whenReady().then(() => {
  // Present as regular Chrome so Google sign-in and the site treat it like the browser version.
  const ua = session.defaultSession.getUserAgent().replace(/\s(guardian-drive-desktop|Electron)\/\S+/g, '');
  session.defaultSession.setUserAgent(ua);
  // The site may use the camera (driver photos), notifications and location, only for our own site.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const fromApp = (details.requestingUrl || wc.getURL()).startsWith(APP_ORIGIN);
    callback(fromApp && ['media', 'notifications', 'geolocation', 'clipboard-sanitized-write'].includes(permission));
  });
  createWindow();
  setTimeout(() => void checkForUpdates(), 10_000);
  setInterval(() => void checkForUpdates(), UPDATE_EVERY_MS);
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => app.quit());
