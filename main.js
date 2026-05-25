// Designer Hub Desktop - processo principal (Electron)
const { app, BrowserWindow, Menu, ipcMain, shell, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');

let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { /* sem electron-updater */ }

// ============================================================
//  ENDERECO DO SERVIDOR  (edite SO esta linha se o endereco mudar)
const SERVER_URL = 'https://designerhub.shardweb.app';
// ============================================================

// ============================================================
//  SUPORTE  —  TROQUE pelo SEU numero de WhatsApp (so digitos,
//  com o codigo do Brasil 55 na frente).  Ex: 5511999998888
const SUPPORT_WHATSAPP = '5500000000000';
// ============================================================

const BACKUP_DIR  = path.join(app.getPath('documents'), 'Designer Hub - Backups');
const CACHE_FILE  = path.join(app.getPath('userData'), 'cache.json');     // copia local dos dados
const OUTBOX_FILE = path.join(app.getPath('userData'), 'outbox.json');    // fila de cadastros offline

let win = null;
let splash = null;
let splashClosed = false;
let splashStart = 0;
let online = false;
let autoBackupTimer = null, cacheTimer = null, reconnectTimer = null;

// ---------- util de arquivos JSON ----------
function loadJson(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; } }
function saveJson(file, data) { try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) {} }

// ---------- splash (animacao de carregamento inicial) ----------
function createSplash() {
  splashStart = Date.now();
  splash = new BrowserWindow({
    width: 460, height: 300,
    frame: false, resizable: false, movable: false, center: true,
    show: true, skipTaskbar: true, alwaysOnTop: true,
    backgroundColor: '#07070a', title: 'Designer Hub'
  });
  splash.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
}
function revealWindow() {
  if (win && !win.isDestroyed() && !win.isVisible()) { win.show(); win.focus(); }
}
function closeSplash() {
  // se o splash ja fechou (ex: janela recriada no macOS), so mostra a janela
  if (splashClosed) { revealWindow(); return; }
  splashClosed = true;
  // mantem o splash visivel o suficiente pra a animacao da logo completar
  const wait = Math.max(0, 2300 - (Date.now() - splashStart));
  setTimeout(() => {
    try { if (splash && !splash.isDestroyed()) splash.close(); } catch (e) {}
    splash = null;
    revealWindow();
  }, wait);
}

// ---------- janela ----------
function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#07070a',
    title: 'Designer Hub',
    autoHideMenuBar: true,
    show: false,   // so aparece quando o splash fecha
    // Janela SEM a moldura do sistema — o app desenha a propria barra de titulo.
    // No macOS mantemos os botoes nativos (semaforo); no Windows/Linux a barra
    // injetada (preload.js) traz os botoes minimizar / maximizar / fechar.
    ...(isMac
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 13, y: 11 } }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, devTools: false
    }
  });
  Menu.setApplicationMenu(null);

  // avisa a barra de titulo quando a janela e maximizada/restaurada
  // (pra trocar o icone do botao maximizar <-> restaurar)
  win.on('maximize',   () => { try { win.webContents.send('win-maximized', true);  } catch (e) {} });
  win.on('unmaximize', () => { try { win.webContents.send('win-maximized', false); } catch (e) {} });

  win.loadURL(SERVER_URL);

  // garante que a janela apareca mesmo que a conexao demore demais
  setTimeout(closeSplash, 20000);

  win.webContents.on('did-fail-load', (e, code, desc, url) => {
    if (code === -3) return;
    online = false;
    win.loadFile(path.join(__dirname, 'renderer', 'offline.html'));
    closeSplash();
  });

  win.webContents.on('did-finish-load', () => {
    closeSplash();
    const u = win.webContents.getURL();
    if (u.startsWith('http')) {
      online = true;
      // ao conectar: atualiza o cache e tenta enviar a fila pendente
      setTimeout(() => { refreshCache(); syncOutbox(); }, 2500);
    }
  });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const k = (input.key || '').toLowerCase();
    if (mod && k === 'r') { e.preventDefault(); reloadApp(); }
    if (mod && k === 'b') { e.preventDefault(); doBackup(false); }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(SERVER_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

function reloadApp() { if (win) win.loadURL(SERVER_URL); }
function openBackupsFolder() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  shell.openPath(BACKUP_DIR);
}

// ---------- teste de conexao ----------
function testConnectivity() {
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (!done) { done = true; resolve(ok); } };
    try {
      const request = net.request({ method: 'HEAD', url: SERVER_URL });
      request.on('response', () => finish(true));
      request.on('error', () => finish(false));
      setTimeout(() => finish(false), 6000);
      request.end();
    } catch (e) { finish(false); }
  });
}

// quando esta na tela offline, tenta reconectar de tempos em tempos
async function tryReconnect() {
  if (!win || win.isDestroyed()) return;
  const url = win.webContents.getURL();
  if (url.startsWith('http')) return; // ja esta online
  if (await testConnectivity()) win.loadURL(SERVER_URL);
}

// ---------- cache local (copia dos dados quando online) ----------
async function refreshCache() {
  if (!win || win.isDestroyed()) return;
  if (!win.webContents.getURL().startsWith('http')) return;
  try {
    const data = await win.webContents.executeJavaScript(`
      (async () => {
        try {
          const me = await fetch('/api/me', { credentials:'same-origin' }).then(r=>r.json());
          if (!me.logged || me.niche !== 'cad') return null;
          const clients = await fetch('/api/cad/clients', { credentials:'same-origin' }).then(r=>r.json());
          const full = [];
          for (const c of clients) {
            const d = await fetch('/api/cad/clients/'+c.id, { credentials:'same-origin' }).then(r=>r.json());
            full.push({ id: c.id, name: c.name, patients: (d.patients||[]).map(p=>({ id:p.id, name:p.name })) });
          }
          return { user: me.username, clients: full };
        } catch (e) { return null; }
      })()
    `, true);
    if (data) {
      saveJson(CACHE_FILE, { updated_at: new Date().toISOString(), ...data });
      console.log('[cache] atualizado:', data.clients.length, 'cliente(s)');
    }
  } catch (e) { /* ignora */ }
}

// ---------- fila offline (outbox) ----------
function getOutbox() { return loadJson(OUTBOX_FILE, []); }
function setOutbox(arr) { saveJson(OUTBOX_FILE, arr); }

// envia a fila pendente para o servidor (precisa estar online e logado)
async function syncOutbox() {
  if (!win || win.isDestroyed()) return { sent: 0, pending: 0 };
  if (!win.webContents.getURL().startsWith('http')) return { sent: 0, pending: getOutbox().length };
  let outbox = getOutbox();
  if (!outbox.length) return { sent: 0, pending: 0 };
  const remaining = [];
  let sent = 0;
  for (const entry of outbox) {
    try {
      const ok = await win.webContents.executeJavaScript(`
        (async () => {
          const e = ${JSON.stringify(entry)};
          try {
            const me = await fetch('/api/me', { credentials:'same-origin' }).then(r=>r.json());
            if (!me.logged) return false;
            let cid = e.client_id;
            if (!cid) {
              const r = await fetch('/api/cad/clients', {
                method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
                body: JSON.stringify({ name: e.client_name, phone: e.client_phone || null })
              });
              if (!r.ok) return false;
              cid = (await r.json()).id;
            }
            const res = await fetch('/api/cad/patients/full', {
              method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
              body: JSON.stringify({ cad_client_id: cid, name: e.patient_name, notes: e.notes || '', prosthetics: e.prosthetics || [] })
            });
            return res.ok;
          } catch (err) { return false; }
        })()
      `, true);
      if (ok) sent++;
      else remaining.push(entry);
    } catch (e) { remaining.push(entry); }
  }
  setOutbox(remaining);
  if (sent > 0) console.log(`[sync] ${sent} cadastro(s) offline enviados; ${remaining.length} na fila`);
  return { sent, pending: remaining.length };
}

// ---------- backup local ----------
async function doBackup(silent) {
  if (!win || win.isDestroyed()) return { ok: false };
  if (!win.webContents.getURL().startsWith('http')) {
    if (!silent) dialog.showMessageBox(win, { type: 'info', message: 'Conecte-se ao sistema antes de gerar o backup.' });
    return { ok: false };
  }
  try {
    const data = await win.webContents.executeJavaScript(`
      (async () => {
        try {
          const me = await fetch('/api/me', { credentials:'same-origin' }).then(r=>r.json());
          if (!me.logged) return { error:'voce precisa estar logado' };
          const eps = me.niche === 'cad' ? [['/api/cad/export/all','cad-relatorio.xlsx']] : [['/api/export/all','relatorio.xlsx']];
          const files = [];
          for (const [u, fname] of eps) {
            const res = await fetch(u, { credentials:'same-origin' });
            if (!res.ok) continue;
            const buf = new Uint8Array(await res.arrayBuffer());
            let bin=''; for (let i=0;i<buf.length;i++) bin+=String.fromCharCode(buf[i]);
            files.push({ name: fname, b64: btoa(bin) });
          }
          return { files };
        } catch (e) { return { error: e.message }; }
      })()
    `, true);
    if (!data || data.error || !data.files.length) {
      if (!silent) dialog.showMessageBox(win, { type: 'warning', message: 'Nao foi possivel gerar o backup: ' + ((data && data.error) || 'sem dados') });
      return { ok: false };
    }
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    data.files.forEach(f => fs.writeFileSync(path.join(BACKUP_DIR, `${stamp}_${f.name}`), Buffer.from(f.b64, 'base64')));
    if (!silent) {
      dialog.showMessageBox(win, { type: 'info', message: 'Backup salvo', detail: BACKUP_DIR,
        buttons: ['OK', 'Abrir pasta'], defaultId: 0 }).then(r => { if (r.response === 1) openBackupsFolder(); });
    }
    return { ok: true };
  } catch (e) {
    if (!silent) dialog.showMessageBox(win, { type: 'error', message: 'Falha no backup: ' + e.message });
    return { ok: false };
  }
}

// ---------- atualizacao automatica ----------
function setupAutoUpdate() {
  if (!autoUpdater) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', () => {
    if (!win || win.isDestroyed()) return;
    dialog.showMessageBox(win, {
      type: 'info', message: 'Nova versao disponivel',
      detail: 'Uma atualizacao do Designer Hub foi baixada. Reiniciar agora para aplicar?',
      buttons: ['Reiniciar agora', 'Depois'], defaultId: 0
    }).then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on('error', err => console.error('[update]', err && err.message));
  try { autoUpdater.checkForUpdates(); } catch (e) { console.error('[update]', e.message); }
}

// ---------- IPC (telas locais) ----------
ipcMain.handle('run-backup', () => doBackup(false));
ipcMain.handle('open-backups', () => { openBackupsFolder(); return { ok: true }; });
ipcMain.handle('retry', () => { reloadApp(); return { ok: true }; });
ipcMain.handle('open-support', () => {
  const msg = 'Ola Brenox! Preciso de ajuda com o Designer Hub.';
  shell.openExternal(`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(msg)}`);
  return { ok: true };
});
// ---------- IPC: controles da janela (barra de titulo propria) ----------
ipcMain.handle('win-minimize',     () => { if (win && !win.isDestroyed()) win.minimize(); });
ipcMain.handle('win-maximize',     () => {
  if (win && !win.isDestroyed()) { win.isMaximized() ? win.unmaximize() : win.maximize(); }
});
ipcMain.handle('win-close',        () => { if (win && !win.isDestroyed()) win.close(); });
ipcMain.handle('win-is-maximized', () => !!(win && !win.isDestroyed() && win.isMaximized()));

ipcMain.handle('get-cache', () => loadJson(CACHE_FILE, { clients: [] }));
ipcMain.handle('get-outbox', () => getOutbox());
ipcMain.handle('save-offline', (e, entry) => {
  const outbox = getOutbox();
  outbox.push(Object.assign({ id: Date.now(), created_at: new Date().toISOString() }, entry));
  setOutbox(outbox);
  return { ok: true, pending: outbox.length };
});
ipcMain.handle('remove-offline', (e, id) => {
  setOutbox(getOutbox().filter(x => x.id !== id));
  return { ok: true, pending: getOutbox().length };
});
ipcMain.handle('sync-now', async () => {
  if (!(await testConnectivity())) return { online: false };
  if (!win.webContents.getURL().startsWith('http')) win.loadURL(SERVER_URL);
  const r = await syncOutbox();
  return Object.assign({ online: true }, r);
});

// ---------- ciclo de vida ----------
app.whenReady().then(() => {
  createSplash();
  createWindow();
  setupAutoUpdate();
  autoBackupTimer = setInterval(() => doBackup(true), 30 * 60 * 1000);
  cacheTimer      = setInterval(refreshCache, 5 * 60 * 1000);
  reconnectTimer  = setInterval(() => { tryReconnect(); syncOutbox(); }, 30 * 1000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
