import { auth, db } from './firebase.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const loginScreen = document.getElementById('login-screen');
const launcherScreen = document.getElementById('launcher-screen');

const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');

const displayName = document.getElementById('display-name');
const displayEmail = document.getElementById('display-email');
const displayRole = document.getElementById('display-role');
const displayTrust = document.getElementById('display-trust');
const logoutBtn = document.getElementById('logout-btn');

const versionLine = document.getElementById('version-line');
const actionBtn = document.getElementById('action-btn');
const statusError = document.getElementById('status-error');
const progressWrap = document.getElementById('progress-wrap');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');

document.getElementById('min-btn').addEventListener('click', () => window.launcherAPI.minimize());
document.getElementById('close-btn').addEventListener('click', () => window.launcherAPI.close());

let currentStatus = null; // last result of refreshStatus()
let busy = false;

// Electron's renderer is a real Chromium process, so this is the actual
// host OS - same technique the website's download.html uses.
function detectPlatform() {
  const uaPlatform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent;
  return uaPlatform.toLowerCase().includes('mac') ? 'mac' : 'windows';
}

function mapAuthError(err) {
  const code = (err && err.code) || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'Invalid email or password.';
  }
  if (code.includes('too-many-requests')) return 'Too many attempts. Try again later.';
  if (code.includes('network-request-failed')) return 'Network error. Check your connection.';
  return (err && err.message) || 'Login failed.';
}

async function loadProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    email: data.email,
    username: data.username || null,
    role: data.role,
    trustPoints: data.trustPoints ?? 0,
  };
}

function showLogin() {
  loginScreen.classList.remove('hidden');
  launcherScreen.classList.add('hidden');
}

function showLauncher(profile) {
  loginScreen.classList.add('hidden');
  launcherScreen.classList.remove('hidden');

  displayName.textContent = profile.username ? profile.username.toUpperCase() : 'OPERATIVE';
  displayEmail.textContent = profile.email;
  displayRole.textContent = profile.role.toUpperCase();
  displayRole.classList.toggle('admin', profile.role === 'admin');
  displayTrust.textContent = profile.trustPoints;

  refreshStatus();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showLogin();
    return;
  }
  const profile = await loadProfile(user.uid);
  if (!profile || profile.role === 'banned') {
    await signOut(auth);
    showLogin();
    return;
  }
  showLauncher(profile);
});

loginBtn.addEventListener('click', doLogin);
passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  loginError.textContent = '';
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    loginError.textContent = 'Enter your email and access code.';
    return;
  }
  loginBtn.disabled = true;
  loginBtn.textContent = 'CONNECTING...';
  try {
    await signInWithEmailAndPassword(auth, email, password);
    passwordInput.value = ''; // onAuthStateChanged drives the screen switch
  } catch (err) {
    loginError.textContent = mapAuthError(err);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'ENTER';
  }
}

logoutBtn.addEventListener('click', async () => {
  await signOut(auth);
});

async function refreshStatus() {
  statusError.textContent = '';
  actionBtn.disabled = true;
  actionBtn.textContent = 'CHECKING...';
  try {
    const platform = detectPlatform();
    const [installed, versionSnap, serverSnap] = await Promise.all([
      window.launcherAPI.getInstalledVersion(),
      getDoc(doc(db, 'gameVersion', 'latest')),
      getDoc(doc(db, 'server', 'status')),
    ]);

    const latest = versionSnap.exists() ? versionSnap.data() : null;
    const platformBuild = latest ? (latest[platform] || null) : null;
    const serverLocked = serverSnap.exists() ? !!serverSnap.data().isLocked : false;
    const needsUpdate = !!platformBuild && (!installed || installed.version !== latest.version);

    currentStatus = { installed, latest, platformBuild, platformAvailable: !!platformBuild, needsUpdate, serverLocked };
    renderStatus();
  } catch (err) {
    statusError.textContent = err.message || 'Could not reach the server.';
    actionBtn.textContent = 'RETRY';
    actionBtn.disabled = false;
    actionBtn.onclick = refreshStatus;
  }
}

function renderStatus() {
  const s = currentStatus;
  if (!s) return;

  if (s.latest) {
    versionLine.textContent = s.installed
      ? `INSTALLED v${s.installed.version} — LATEST v${s.latest.version}`
      : `LATEST BUILD v${s.latest.version}`;
  } else {
    versionLine.textContent = 'NO BUILD PUBLISHED YET';
  }

  actionBtn.classList.remove('locked');
  actionBtn.onclick = null;

  if (s.serverLocked && !s.needsUpdate && s.installed) {
    actionBtn.textContent = 'SERVER LOCKDOWN';
    actionBtn.classList.add('locked');
    actionBtn.disabled = true;
    return;
  }

  if (!s.latest) {
    actionBtn.textContent = 'NO BUILD AVAILABLE';
    actionBtn.disabled = true;
    return;
  }

  if (!s.platformAvailable && !s.installed) {
    actionBtn.textContent = 'NOT AVAILABLE FOR YOUR OS';
    actionBtn.disabled = true;
    return;
  }

  if (s.needsUpdate) {
    actionBtn.textContent = s.installed ? 'UPDATE' : 'INSTALL';
    actionBtn.disabled = false;
    actionBtn.onclick = doUpdate;
    return;
  }

  actionBtn.textContent = 'DEPLOY';
  actionBtn.disabled = false;
  actionBtn.onclick = doLaunch;
}

window.launcherAPI.onDownloadProgress(({ phase, pct }) => {
  progressWrap.classList.remove('hidden');
  if (phase === 'download') {
    progressFill.style.width = pct + '%';
    progressText.textContent = `DOWNLOADING ${pct}%`;
  } else if (phase === 'extract') {
    progressFill.style.width = '100%';
    progressText.textContent = 'INSTALLING...';
  } else if (phase === 'done') {
    progressText.textContent = 'INSTALL COMPLETE';
    setTimeout(() => progressWrap.classList.add('hidden'), 1200);
  }
});

async function doUpdate() {
  if (busy || !currentStatus || !currentStatus.platformBuild) return;
  busy = true;
  statusError.textContent = '';
  actionBtn.disabled = true;
  actionBtn.textContent = 'UPDATING...';
  progressWrap.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = 'DOWNLOADING 0%';
  try {
    const { latest, platformBuild } = currentStatus;
    await window.launcherAPI.downloadAndInstall(platformBuild.downloadUrl, latest.version);
    await refreshStatus();
  } catch (err) {
    statusError.textContent = err.message || 'Update failed.';
    actionBtn.textContent = 'RETRY';
    actionBtn.disabled = false;
    actionBtn.onclick = doUpdate;
  } finally {
    busy = false;
  }
}

async function doLaunch() {
  if (busy) return;
  busy = true;
  statusError.textContent = '';
  actionBtn.disabled = true;
  actionBtn.textContent = 'LAUNCHING...';
  try {
    await window.launcherAPI.launchGame();
    actionBtn.textContent = 'DEPLOY';
  } catch (err) {
    statusError.textContent = err.message || 'Could not launch the game.';
  } finally {
    actionBtn.disabled = false;
    busy = false;
  }
}
