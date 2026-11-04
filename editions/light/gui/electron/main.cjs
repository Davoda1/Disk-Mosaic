const { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { registerTrustedHandler, protectWindow, denyPermissions, validateEngineCommand, validateLocalPath, validateClipboardText } = require('./ipc-policy.cjs');
const { resolveEnginePath } = require('./engine-path.cjs');
const RENDERER_FILE = path.join(__dirname, '..', 'renderer', 'index.html');
const RENDERER_URL = pathToFileURL(RENDERER_FILE).href;
const ENGINE_COMMANDS = new Set([
  'list_roots', 'scan', 'cancel', 'pause', 'resume', 'get_root',
  'children', 'get_node', 'ancestors', 'largest', 'search', 'statistics',
  'treemap', 'get_errors', 'get_metadata', 'selection_replace', 'selection_add', 'selection_toggle',
  'selection_clear', 'selection_summary', 'selection_page', 'refresh_selected', 'refresh_paths', 'watch_start',
  'watch_stop', 'watch_pause', 'watch_resume', 'watch_status', 'history_status', 'history_store_current',
  'history_list', 'history_load', 'history_delete', 'compare_history', 'duplicate_scan', 'cancel_analysis',
  'save_snapshot', 'load_snapshot', 'compare_snapshot', 'trash', 'batch_trash', 'hash_selection',
]);

app.setName('DiskMosaic Light');
const USER_DATA_DIR = path.join(app.getPath('appData'), 'DiskMosaic Light');
fs.mkdirSync(USER_DATA_DIR, { recursive: true });
app.setPath('userData', USER_DATA_DIR);


let mainWindow = null;
let engine = null;
let stdoutBuffer = '';
let shutdownRequested = false;
let uiLanguage = 'en';
const UI_LANGUAGES = new Set(['en','de','hu','fr','it','es']);
const DIALOG_TEXT = {
  en: { saveScan:'Save DiskMosaic scan', openScan:'Open DiskMosaic scan', scan:'DiskMosaic scan', all:'All files', exportReport:'Export DiskMosaic report', json:'JSON report' },
  de: { saveScan:'DiskMosaic-Scan speichern', openScan:'DiskMosaic-Scan öffnen', scan:'DiskMosaic-Scan', all:'Alle Dateien', exportReport:'DiskMosaic-Bericht exportieren', json:'JSON-Bericht' },
  hu: { saveScan:'DiskMosaic-vizsgálat mentése', openScan:'DiskMosaic-vizsgálat megnyitása', scan:'DiskMosaic-vizsgálat', all:'Minden fájl', exportReport:'DiskMosaic-jelentés exportálása', json:'JSON-jelentés' },
  fr: { saveScan:'Enregistrer l’analyse DiskMosaic', openScan:'Ouvrir une analyse DiskMosaic', scan:'Analyse DiskMosaic', all:'Tous les fichiers', exportReport:'Exporter le rapport DiskMosaic', json:'Rapport JSON' },
  it: { saveScan:'Salva scansione DiskMosaic', openScan:'Apri scansione DiskMosaic', scan:'Scansione DiskMosaic', all:'Tutti i file', exportReport:'Esporta rapporto DiskMosaic', json:'Rapporto JSON' },
  es: { saveScan:'Guardar análisis DiskMosaic', openScan:'Abrir análisis DiskMosaic', scan:'Análisis DiskMosaic', all:'Todos los archivos', exportReport:'Exportar informe DiskMosaic', json:'Informe JSON' },
};
function dialogText() { return DIALOG_TEXT[uiLanguage] || DIALOG_TEXT.en; }

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const data = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (Number.isFinite(data.width) && Number.isFinite(data.height)) return data;
  } catch (_) {}
  return { width: 1360, height: 880 };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  const data = { ...bounds, maximized: mainWindow.isMaximized() };
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(data), 'utf8');
  } catch (error) {
    console.error('Failed to save window state:', error);
  }
}

function startupPath() {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const candidate = args.find(arg => arg && !arg.startsWith('-'));
  return candidate ? path.resolve(candidate) : null;
}

function broadcast(event) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('engine:event', event);
  }
}

function startEngine() {
  const enginePath = resolveEnginePath({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appDir: path.resolve(__dirname, '..'),
  });

  if (!fs.existsSync(enginePath)) {
    broadcast({ event: 'engine_launch_error', message: `Rust engine not found: ${enginePath}` });
    return;
  }

  engine = spawn(enginePath, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, RUST_BACKTRACE: '0', DISKMOSAIC_DATA_DIR: app.getPath('userData') },
  });

  engine.stdout.setEncoding('utf8');
  engine.stdout.on('data', chunk => {
    stdoutBuffer += chunk;
    let newline;
    while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        broadcast(JSON.parse(line));
      } catch (error) {
        broadcast({ event: 'protocol_error', message: `Malformed engine output: ${error.message}` });
      }
    }
  });
  engine.stderr.setEncoding('utf8');
  engine.stderr.on('data', data => console.error(`[engine] ${data.trimEnd()}`));
  engine.on('error', error => broadcast({ event: 'engine_launch_error', message: error.message }));
  engine.on('close', (code, signal) => {
    const expected = shutdownRequested;
    engine = null;
    if (!expected) {
      broadcast({ event: 'engine_exit', code, signal, message: 'The Rust engine exited unexpectedly.' });
    }
  });
}

function sendEngine(command) {
  validateEngineCommand(command, ENGINE_COMMANDS);
  if (!engine || engine.killed || !engine.stdin.writable) {
    throw new Error('Rust engine is not available');
  }
  const requestId = command.request_id || crypto.randomUUID();
  engine.stdin.write(`${JSON.stringify({ ...command, request_id: requestId })}\n`);
  return requestId;
}

function createWindow() {
  const saved = loadWindowState();
  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#11151a',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.removeMenu();
  protectWindow(mainWindow.webContents);
  mainWindow.loadFile(RENDERER_FILE);
  mainWindow.webContents.once('did-finish-load', () => { if (!engine) startEngine(); });
  mainWindow.once('ready-to-show', () => {
    if (saved.maximized) mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('close', saveWindowState);
}

app.whenReady().then(() => {
  denyPermissions(session.defaultSession);
  const handle = (channel, callback) => registerTrustedHandler(ipcMain, channel,
    () => mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null, RENDERER_URL, callback);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url || '';
    const blocked = url.startsWith('http://') || url.startsWith('https://') || url.startsWith('ws://') || url.startsWith('wss://');
    callback({ cancel: blocked });
  });

  handle('ui:setLanguage', (_event, language) => { uiLanguage = UI_LANGUAGES.has(language) ? language : 'en'; return uiLanguage; });
  handle('dialog:chooseFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('app:startupPath', () => startupPath());
  handle('dialog:saveSnapshotPath', async (_event, suggestedName) => {
    const safeName = typeof suggestedName === 'string' && suggestedName.trim()
      ? path.basename(suggestedName.trim()) : 'DiskMosaic-scan.dmscan';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: dialogText().saveScan, defaultPath: safeName,
      filters: [{ name: dialogText().scan, extensions: ['dmscan'] }, { name: dialogText().all, extensions: ['*'] }],
    });
    return result.canceled || !result.filePath ? null : result.filePath;
  });
  handle('dialog:openSnapshotPath', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: dialogText().openScan, properties: ['openFile'],
      filters: [{ name: dialogText().scan, extensions: ['dmscan'] }, { name: dialogText().all, extensions: ['*'] }],
    });
    return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
  });
  handle('dialog:saveTextFile', async (_event, payload) => {
    const suggestedName = typeof payload?.suggestedName === 'string' && payload.suggestedName.trim()
      ? path.basename(payload.suggestedName.trim())
      : 'DiskMosaic-report.json';
    const content = typeof payload?.content === 'string' ? payload.content : '';
    if (Buffer.byteLength(content, 'utf8') > 64 * 1024 * 1024) {
      throw new Error('Refusing to export a report larger than 64 MiB');
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: dialogText().exportReport,
      defaultPath: suggestedName,
      filters: [{ name: dialogText().json, extensions: ['json'] }, { name: dialogText().all, extensions: ['*'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.promises.writeFile(result.filePath, content, { encoding: 'utf8', flag: 'w' });
    return result.filePath;
  });
  handle('engine:send', (_event, command) => sendEngine(command));
  handle('os:openPath', async (_event, target) => shell.openPath(validateLocalPath(target)));
  handle('os:revealPath', (_event, target) => { shell.showItemInFolder(validateLocalPath(target)); return true; });
  handle('os:copyText', async (_event, text) => { await clipboard.writeText(validateClipboardText(text)); return true; });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  shutdownRequested = true;
  saveWindowState();
  try {
    if (engine?.stdin?.writable) {
      engine.stdin.write(`${JSON.stringify({ cmd: 'shutdown', request_id: 'shutdown' })}\n`);
      engine.stdin.end();
    }
  } catch (_) {}
});
