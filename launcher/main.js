const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { spawn } = require("child_process");
const extract = require("extract-zip");

// This process does Node/OS work only - no Firebase here. Firebase Auth's
// SDK assumes a browser-like environment and breaks in Electron's main
// process ("INTERNAL ASSERTION FAILED: Expected a class definition"); it
// belongs in the renderer, which is a real Chromium context. See src/firebase.js.

const USER_DATA = app.getPath("userData");
const INSTALL_DIR = path.join(USER_DATA, "game");
const VERSION_FILE = path.join(INSTALL_DIR, "version.json");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 860,
    minHeight: 560,
    frame: false,
    backgroundColor: "#030108",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------------- window controls ----------------

ipcMain.on("window:minimize", () => mainWindow && mainWindow.minimize());
ipcMain.on("window:close", () => mainWindow && mainWindow.close());

// ---------------- local install state ----------------

function readInstalledVersion() {
  try {
    return JSON.parse(fs.readFileSync(VERSION_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeInstalledVersion(info) {
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.writeFileSync(VERSION_FILE, JSON.stringify(info), "utf8");
}

ipcMain.handle("config:getInstalledVersion", () => readInstalledVersion());

// Zips built from a Unity build folder often add one wrapping directory, so
// search a couple of levels deep rather than only the top of INSTALL_DIR.
function findEntries(dir, predicate, depth = 2) {
  if (!fs.existsSync(dir)) return [];
  let results = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (predicate(item)) {
      results.push(full);
      continue; // don't descend into a matched .app bundle
    }
    if (item.isDirectory() && depth > 0) {
      results = results.concat(findEntries(full, predicate, depth - 1));
    }
  }
  return results;
}

function findGameExecutable() {
  if (process.platform === "darwin") {
    const apps = findEntries(INSTALL_DIR, (item) => item.isDirectory() && item.name.toLowerCase().endsWith(".app"));
    return apps[0] || null;
  }
  const exes = findEntries(INSTALL_DIR, (item) => item.isFile() && item.name.toLowerCase().endsWith(".exe"));
  return exes[0] || null;
}

// ---------------- download / install / launch ----------------

function downloadWithProgress(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlink(destPath, () => {});
          resolve(downloadWithProgress(res.headers.location, destPath, onProgress));
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          reject(new Error(`Download failed with status ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let received = 0;
        res.on("data", (chunk) => {
          received += chunk.length;
          if (total) onProgress(Math.round((received / total) * 100), received, total);
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

ipcMain.handle("game:downloadAndInstall", async (_e, { downloadUrl, version }) => {
  if (!downloadUrl) throw new Error("No download URL provided.");
  if (!version) throw new Error("No version provided.");

  const zipPath = path.join(app.getPath("temp"), `dilemma-${version}.zip`);

  mainWindow.webContents.send("game:progress", { phase: "download", pct: 0 });
  await downloadWithProgress(downloadUrl, zipPath, (pct, receivedBytes, totalBytes) => {
    mainWindow.webContents.send("game:progress", {
      phase: "download",
      pct,
      receivedBytes,
      totalBytes,
    });
  });

  mainWindow.webContents.send("game:progress", { phase: "extract", pct: 0 });
  fs.rmSync(INSTALL_DIR, { recursive: true, force: true });
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  await extract(zipPath, { dir: INSTALL_DIR });
  fs.unlink(zipPath, () => {});

  writeInstalledVersion({ version, installedAt: Date.now() });
  mainWindow.webContents.send("game:progress", { phase: "done", pct: 100 });

  return { ok: true, exePath: findGameExecutable() };
});

ipcMain.handle("game:launch", async () => {
  const exePath = findGameExecutable();
  if (!exePath) throw new Error("Game is not installed.");

  const child = process.platform === "darwin"
    ? spawn("open", [exePath], { detached: true, stdio: "ignore" })
    : spawn(exePath, [], { cwd: path.dirname(exePath), detached: true, stdio: "ignore" });
  child.unref();
  return { ok: true };
});

ipcMain.handle("shell:openExternal", async (_e, url) => {
  await shell.openExternal(url);
});
