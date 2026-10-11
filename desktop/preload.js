/**
 * The only thing the website can ask of the Windows app: open its Google sign-in page in the
 * user's normal browser (Google refuses to sign in inside embedded app windows). The site then
 * waits for the session to be handed back (see web/src/components/auth/AppGoogleButton.tsx).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guardianDesktop', {
  openExternal: (url) => ipcRenderer.invoke('open-external', String(url)),
});
