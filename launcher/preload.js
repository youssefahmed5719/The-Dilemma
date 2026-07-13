const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcherAPI", {
  minimize: () => ipcRenderer.send("window:minimize"),
  close: () => ipcRenderer.send("window:close"),

  getInstalledVersion: () => ipcRenderer.invoke("config:getInstalledVersion"),
  downloadAndInstall: (downloadUrl, version) =>
    ipcRenderer.invoke("game:downloadAndInstall", { downloadUrl, version }),
  launchGame: () => ipcRenderer.invoke("game:launch"),
  onDownloadProgress: (cb) => ipcRenderer.on("game:progress", (_e, data) => cb(data)),

  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
});
