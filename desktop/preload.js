/**
 * What the website can ask of the Windows app: open its Google sign-in page in the user's normal
 * browser (Google refuses to sign in inside embedded app windows; see AppGoogleButton.tsx), and
 * read the app version / check for an update (Settings page).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guardianDesktop', {
  openExternal: (url) => ipcRenderer.invoke('open-external', String(url)),
  appInfo: () => ipcRenderer.invoke('app-info'),
  checkForUpdates: () => ipcRenderer.invoke('check-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
});
