// Bridge segura + barra de titulo propria + barra de controle da sidebar.
// A janela abre sem a moldura do sistema; aqui desenhamos uma barra que
// combina com o app (sem aquela barra cinza do Windows).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brenox', {
  runBackup:    () => ipcRenderer.invoke('run-backup'),
  openBackups:  () => ipcRenderer.invoke('open-backups'),
  retry:        () => ipcRenderer.invoke('retry'),
  openSupport:  () => ipcRenderer.invoke('open-support'),
  // sincronizacao offline
  getCache:     () => ipcRenderer.invoke('get-cache'),
  getOutbox:    () => ipcRenderer.invoke('get-outbox'),
  saveOffline:  (entry) => ipcRenderer.invoke('save-offline', entry),
  removeOffline:(id) => ipcRenderer.invoke('remove-offline', id),
  syncNow:      () => ipcRenderer.invoke('sync-now')
});

// ============================================================
//  BARRA DE TITULO PROPRIA
//  A janela nao tem moldura do sistema. Esta barra fina e escura
//  fica colada no topo, com o nome do app e os botoes da janela —
//  com a cara do Designer Hub, nao do Windows.
// ============================================================
const IS_MAC = process.platform === 'darwin';
const TITLEBAR_H = 36;            // altura da barra (px)
let winMaximized = false;

// icones desenhados em SVG (herdam a cor do texto)
const ICON_MIN = '<svg viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5"/></svg>';
const ICON_MAX = '<svg viewBox="0 0 10 10"><rect x="1.4" y="1.4" width="7.2" height="7.2" rx="1.2"/></svg>';
const ICON_RES = '<svg viewBox="0 0 10 10"><rect x="1" y="3.2" width="5.6" height="5.6" rx="1.1"/><path d="M3.5 3.2 V1.1 H8.9 V6.5 H6.8"/></svg>';
const ICON_CLS = '<svg viewBox="0 0 10 10"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/></svg>';

function refreshMaxIcon() {
  const btn = document.getElementById('vtb-max');
  if (!btn) return;
  btn.innerHTML = winMaximized ? ICON_RES : ICON_MAX;
  btn.title = winMaximized ? 'Restaurar' : 'Maximizar';
}

// o processo principal avisa quando a janela e maximizada/restaurada
ipcRenderer.on('win-maximized', (e, v) => { winMaximized = !!v; refreshMaxIcon(); });

function injectTitleBar() {
  if (document.getElementById('vortex-titlebar')) return true;
  if (!document.body) return false;

  const css = document.createElement('style');
  css.id = 'vortex-titlebar-css';
  css.textContent = `
    /* a barra fica fixa no topo; o conteudo do app desce ${TITLEBAR_H}px */
    body { padding-top: ${TITLEBAR_H}px !important; }
    .sidebar { top: ${TITLEBAR_H}px !important; height: calc(100vh - ${TITLEBAR_H}px) !important; }
    .view    { min-height: calc(100vh - ${TITLEBAR_H}px) !important; }

    #vortex-titlebar {
      position: fixed; top: 0; left: 0; right: 0; height: ${TITLEBAR_H}px;
      display: flex; align-items: stretch; justify-content: space-between;
      background: #07070a; border-bottom: 1px solid #1c1c25;
      z-index: 2147483646; -webkit-app-region: drag; user-select: none;
      font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #vtb-drag {
      flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px;
      padding-left: ${IS_MAC ? '78px' : '14px'};
    }
    #vtb-logo {
      width: 14px; height: 16px; flex-shrink: 0;
      background: #FFCE73;
      -webkit-mask: url('/logo.svg') center/contain no-repeat;
      mask: url('/logo.svg') center/contain no-repeat;
    }
    #vtb-title {
      font-size: 12px; font-weight: 600; color: #8b8b9c; letter-spacing: .3px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #vtb-controls { display: flex; -webkit-app-region: no-drag; }
    #vtb-controls button {
      width: 46px; border: 0; padding: 0; background: transparent; cursor: pointer;
      color: #8b8b9c; display: flex; align-items: center; justify-content: center;
      transition: background .15s, color .15s;
    }
    #vtb-controls button:hover { background: #1c1c25; color: #ececf1; }
    #vtb-close:hover { background: #e3203b; color: #fff; }
    #vtb-controls svg {
      width: 10px; height: 10px; fill: none; stroke: currentColor;
      stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round;
    }
  `;
  (document.head || document.documentElement).appendChild(css);

  const controls = IS_MAC ? '' : (
    '<div id="vtb-controls">' +
      '<button id="vtb-min" title="Minimizar" aria-label="Minimizar">' + ICON_MIN + '</button>' +
      '<button id="vtb-max" title="Maximizar" aria-label="Maximizar">' + ICON_MAX + '</button>' +
      '<button id="vtb-close" title="Fechar" aria-label="Fechar">' + ICON_CLS + '</button>' +
    '</div>'
  );

  const bar = document.createElement('div');
  bar.id = 'vortex-titlebar';
  bar.innerHTML =
    '<div id="vtb-drag"><span id="vtb-logo"></span><span id="vtb-title">Designer Hub</span></div>' +
    controls;
  document.body.appendChild(bar);

  // duplo clique na barra = maximizar / restaurar (igual ao Windows)
  document.getElementById('vtb-drag')
    .addEventListener('dblclick', () => ipcRenderer.invoke('win-maximize'));

  if (!IS_MAC) {
    document.getElementById('vtb-min').addEventListener('click', () => ipcRenderer.invoke('win-minimize'));
    document.getElementById('vtb-max').addEventListener('click', () => ipcRenderer.invoke('win-maximize'));
    document.getElementById('vtb-close').addEventListener('click', () => ipcRenderer.invoke('win-close'));
  }

  // acerta o icone do botao maximizar de acordo com o estado atual da janela
  ipcRenderer.invoke('win-is-maximized')
    .then(v => { winMaximized = !!v; refreshMaxIcon(); })
    .catch(() => {});

  return true;
}

// Barra de controle (backup / pasta / recarregar). Fica DENTRO do rodape da
// barra lateral, ACIMA do perfil do usuario - bem longe do botao "Sair".
function injectControlBar() {
  if (!/^https?:/.test(location.protocol)) return false;       // so no app online
  if (document.getElementById('vortex-electron-bar')) return true;
  const foot = document.querySelector('.sidebar-foot');
  if (!foot) return false;                                     // sidebar ainda nao montou

  const css = document.createElement('style');
  css.textContent = `
    #vortex-electron-bar {
      display: flex; gap: 6px; padding: 2px 0 11px; margin-bottom: 9px;
      border-bottom: 1px solid var(--border, #25252f);
    }
    #vortex-electron-bar button {
      flex: 1; height: 33px; border: 1px solid var(--border, #25252f);
      border-radius: 9px; cursor: pointer; background: var(--bg-2, #15151c);
      color: var(--text, #ececf1); font-size: 14px; line-height: 1;
      transition: background .15s, border-color .15s, transform .12s;
    }
    #vortex-electron-bar button:hover {
      background: var(--accent, #7c5cff); border-color: var(--accent, #7c5cff);
      transform: translateY(-1px);
    }
    @media (max-width: 900px) { #vortex-electron-bar { flex-direction: column; } }
  `;
  document.head.appendChild(css);

  const bar = document.createElement('div');
  bar.id = 'vortex-electron-bar';
  bar.innerHTML =
    '<button data-act="backup" title="Fazer backup agora (Ctrl/Cmd+B)">&#128190;</button>' +
    '<button data-act="folder" title="Abrir pasta de backups">&#128193;</button>' +
    '<button data-act="reload" title="Recarregar (Ctrl/Cmd+R)">&#8635;</button>';
  bar.addEventListener('click', (e) => {
    const act = e.target && e.target.dataset && e.target.dataset.act;
    if (act === 'backup') ipcRenderer.invoke('run-backup');
    if (act === 'folder') ipcRenderer.invoke('open-backups');
    if (act === 'reload') ipcRenderer.invoke('retry');
  });
  foot.insertBefore(bar, foot.firstChild);   // primeiro filho = acima do perfil
  return true;
}

window.addEventListener('DOMContentLoaded', () => {
  injectTitleBar();
  if (injectControlBar()) return;
  // a sidebar pode demorar a aparecer (login) - tenta de novo por alguns segundos
  let tries = 0;
  const timer = setInterval(() => {
    if (injectControlBar() || ++tries > 60) clearInterval(timer);
  }, 250);
});
