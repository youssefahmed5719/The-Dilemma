const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { spawn } = require("child_process");
const extract = require("extract-zip");

const { initializeApp } = require("firebase/app");
const {
  initializeAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} = require("firebase/auth");
const { getFirestore, doc, getDoc } = require("firebase/firestore");

const { createFilePersistence } = require("./filePersistence");
const firebaseConfig = require("./firebaseConfig");

const USER_DATA = app.getPath("userData");
const INSTALL_DIR = path.join(USER_DATA, "game");
const VERSION_FILE = path.join(INSTALL_DIR, "version.json");
const AUTH_SESSION_FILE = path.join(USER_DATA, "auth-session.json");

const firebaseApp = initializeApp(firebaseConfig);
const auth = initializeAuth(firebaseApp, {
  persistence: createFilePersistence(AUTH_SESSION_FILE),
});
const db = getFirestore(firebaseApp);

// Game builds are distributed as public GitHub Release assets, not Firebase
// Storage. Returns "windows" or "mac", matching the sub-object keys on the
// gameVersion/launcher Firestore docs.
function platformKey() {
  return process.platform === "darwin" ? "mac" : "windows";
}

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

onAuthStateChanged(auth, async (user) => {
  if (!mainWindow) return;
  if (!user) {
    mainWindow.webContents.send("auth:state", null);
    return;
  }
  const profile = await loadProfile(user.uid);
  if (!profile || profile.role === "banned") {
    await signOut(auth);
    mainWindow.webContents.send("auth:state", null);
    return;
  }
  mainWindow.webContents.send("auth:state", profile);
});

async function loadProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    email: data.email,
    username: data.username || null,
    role: data.role,
    trustPoints: data.trustPoints ?? 0,
  };
}

function mapAuthError(err) {
  const code = err && err.code ? err.code : "";
  if (
    code.includes("invalid-credential") ||
    code.includes("wrong-password") ||
    code.includes("user-not-found")
  ) {
    return "Invalid email or password.";
  }
  if (code.includes("too-many-requests")) {
    return "Too many attempts. Try again later.";
  }
  if (code.includes("network-request-failed")) {
    return "Network error. Check your connection.";
  }
  return (err && err.message) || "Login failed.";
}

// ---------------- window controls ----------------

ipcMain.on("window:minimize", () => mainWindow && mainWindow.minimize());
ipcMain.on("window:close", () => mainWindow && mainWindow.close());

// ---------------- auth ----------------

ipcMain.handle("auth:login", async (_e, { email, password }) => {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const profile = await loadProfile(cred.user.uid);
    if (!profile) {
      await signOut(auth);
      return { ok: false, error: "No player profile found for this account." };
    }
    if (profile.role === "banned") {
      await signOut(auth);
      return { ok: false, error: "This account has been banned." };
    }
    return { ok: true, profile };
  } catch (err) {
    return { ok: false, error: mapAuthError(err) };
  }
});

ipcMain.handle("auth:logout", async () => {
  await signOut(auth);
  return { ok: true };
});

// ---------------- version / update / launch ----------------

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

ipcMain.handle("game:status", async () => {
  const installed = readInstalledVersion();

  const [versionSnap, serverSnap] = await Promise.all([
    getDoc(doc(db, "gameVersion", "latest")),
    getDoc(doc(db, "server", "status")),
  ]);

  const latest = versionSnap.exists() ? versionSnap.data() : null;
  const platformBuild = latest ? latest[platformKey()] || null : null;
  const serverLocked = serverSnap.exists() ? !!serverSnap.data().isLocked : false;
  const needsUpdate = !!platformBuild && (!installed || installed.version !== latest.version);

  return {
    installed,
    latest,
    platformAvailable: !!platformBuild,
    needsUpdate,
    serverLocked,
    exePath: findGameExecutable(),
  };
});

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

ipcMain.handle("game:update", async () => {
  const versionSnap = await getDoc(doc(db, "gameVersion", "latest"));
  if (!versionSnap.exists()) {
    throw new Error("No build has been published yet.");
  }
  const latest = versionSnap.data();
  const build = latest[platformKey()];
  if (!build) {
    throw new Error(`No ${platformKey()} build has been published yet.`);
  }

  const zipPath = path.join(app.getPath("temp"), `dilemma-${latest.version}.zip`);

  mainWindow.webContents.send("game:progress", { phase: "download", pct: 0 });
  await downloadWithProgress(build.downloadUrl, zipPath, (pct, receivedBytes, totalBytes) => {
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

  writeInstalledVersion({ version: latest.version, installedAt: Date.now() });
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
