const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  minimize: () => ipcRenderer.send("window:minimize"),
  close: () => ipcRenderer.send("window:close"),

  login: (email, password) => ipcRenderer.invoke("auth:login", { email, password }),
  logout: () => ipcRenderer.invoke("auth:logout"),
  onAuthState: (cb) => ipcRenderer.on("auth:state", (_e, profile) => cb(profile)),

  gameStatus: () => ipcRenderer.invoke("game:status"),
  updateGame: () => ipcRenderer.invoke("game:update"),
  launchGame: () => ipcRenderer.invoke("game:launch"),
  onProgress: (cb) => ipcRenderer.on("game:progress", (_e, data) => cb(data)),

  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
});
