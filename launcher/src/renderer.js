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

document.getElementById('min-btn').addEventListener('click', () => window.api.minimize());
document.getElementById('close-btn').addEventListener('click', () => window.api.close());

let currentStatus = null; // last result of gameStatus()
let busy = false;

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

window.api.onAuthState((profile) => {
  if (profile) {
    showLauncher(profile);
  } else {
    showLogin();
  }
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
  const result = await window.api.login(email, password);
  loginBtn.disabled = false;
  loginBtn.textContent = 'ENTER';
  if (!result.ok) {
    loginError.textContent = result.error;
    return;
  }
  passwordInput.value = '';
  showLauncher(result.profile);
}

logoutBtn.addEventListener('click', async () => {
  await window.api.logout();
  showLogin();
});

async function refreshStatus() {
  statusError.textContent = '';
  actionBtn.disabled = true;
  actionBtn.textContent = 'CHECKING...';
  try {
    currentStatus = await window.api.gameStatus();
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

  if (s.serverLocked && !s.needsUpdate && s.exePath) {
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

  if (!s.platformAvailable && !s.exePath) {
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

window.api.onProgress(({ phase, pct }) => {
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
  if (busy) return;
  busy = true;
  statusError.textContent = '';
  actionBtn.disabled = true;
  actionBtn.textContent = 'UPDATING...';
  progressWrap.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = 'DOWNLOADING 0%';
  try {
    await window.api.updateGame();
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
    await window.api.launchGame();
    actionBtn.textContent = 'DEPLOY';
  } catch (err) {
    statusError.textContent = err.message || 'Could not launch the game.';
  } finally {
    actionBtn.disabled = false;
    busy = false;
  }
}
