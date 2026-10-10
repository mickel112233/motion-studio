const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const isDev = !app.isPackaged;
const MAX_PROJECT_BYTES = 20 * 1024 * 1024;
let currentProjectPath = null;
let lastSavedHash = null;
let projectWatcher = null;
let watchTimer = null;
let mainWindow = null;

function validateProject(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Project must be a JSON object');
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 200) throw new Error('Project name is invalid');
  for (const key of ['width', 'height']) if (!Number.isFinite(data[key]) || data[key] < 16 || data[key] > 16384) throw new Error(key + ' is outside the supported range');
  if (!Number.isFinite(data.fps) || data.fps < 1 || data.fps > 240) throw new Error('Frame rate is invalid');
  if (!Number.isFinite(data.duration) || data.duration < 0.1 || data.duration > 86400) throw new Error('Composition duration is invalid');
  if (!Array.isArray(data.layers) || data.layers.length > 10000) throw new Error('Layer list is invalid or too large');
  const ids = new Set();
  for (const layer of data.layers) {
    if (!layer || typeof layer !== 'object' || typeof layer.id !== 'string' || !layer.id || ids.has(layer.id)) throw new Error('Layer IDs must be present and unique');
    ids.add(layer.id);
    if (!['text', 'shape', 'image', 'video', 'audio'].includes(layer.kind)) throw new Error('Unsupported layer type: ' + layer.id);
    if (typeof layer.name !== 'string' || !layer.name.trim() || layer.name.length > 200) throw new Error('Layer name is invalid: ' + layer.id);
    if (typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') throw new Error('Layer visibility or lock state is invalid: ' + layer.id);
    for (const key of ['start', 'duration', 'x', 'y', 'scale', 'rotation', 'opacity']) if (!Number.isFinite(layer[key])) throw new Error('Invalid ' + key + ' on layer ' + layer.id);
    if (layer.start < 0 || layer.start > data.duration || layer.duration <= 0 || layer.scale <= 0 || layer.opacity < 0 || layer.opacity > 100) throw new Error('Layer timing or transform is out of range: ' + layer.id);
    if (typeof layer.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(layer.color)) throw new Error('Layer color is invalid: ' + layer.id);
    if (layer.volume !== undefined && (!Number.isFinite(layer.volume) || layer.volume < 0 || layer.volume > 100)) throw new Error('Layer volume is invalid: ' + layer.id);
    if (layer.muted !== undefined && typeof layer.muted !== 'boolean') throw new Error('Layer mute state is invalid: ' + layer.id);
    if (layer.effects !== undefined) {
      const limits = { blur:40, brightness:300, contrast:300, saturate:300, grayscale:100, sepia:100, 'hue-rotate':360, 'drop-shadow':50 };
      if (!Array.isArray(layer.effects) || layer.effects.length > 64) throw new Error('Layer effects are invalid: ' + layer.id);
      for (const effect of layer.effects) {
        if (!effect || typeof effect.id !== 'string' || !effect.id || !Object.hasOwn(limits, effect.type) || typeof effect.enabled !== 'boolean' || !Number.isFinite(effect.value) || effect.value < 0 || effect.value > limits[effect.type]) throw new Error('Layer effect is invalid: ' + layer.id);
      }
    }
    if (!Array.isArray(layer.keyframes) || layer.keyframes.length > 10000) throw new Error('Layer keyframes are invalid: ' + layer.id);
    for (const frame of layer.keyframes) {
      if (!frame || !Number.isFinite(frame.time) || frame.time < 0 || frame.time > data.duration) throw new Error('Keyframe time is invalid: ' + layer.id);
      for (const key of ['x', 'y', 'scale', 'rotation', 'opacity']) if (!Number.isFinite(frame[key])) throw new Error('Invalid keyframe ' + key + ': ' + layer.id);
      if (frame.scale <= 0 || frame.opacity < 0 || frame.opacity > 100) throw new Error('Keyframe transform is out of range: ' + layer.id);
      if (frame.easing !== undefined && !['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'].includes(frame.easing)) throw new Error('Keyframe easing is invalid: ' + layer.id);
    }
  }
  return data;
}

async function readProject(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_PROJECT_BYTES) throw new Error('Project file exceeds 20 MB');
  const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
  return validateProject(data);
}

async function writeProject(filePath, data) {
  validateProject(data);
  const json = JSON.stringify(data, null, 2) + '\n';
  if (Buffer.byteLength(json, 'utf8') > MAX_PROJECT_BYTES) throw new Error('Project file exceeds 20 MB');
  const temp = filePath + '.tmp-' + process.pid + '-' + Date.now();
  try {
    await fs.writeFile(temp, json, { flag: 'wx', encoding: 'utf8' });
    await fs.rename(temp, filePath);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

function hashContent(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function watchProjectFile(filePath) {
  if (projectWatcher) projectWatcher.close();
  projectWatcher = null;
  if (watchTimer) clearTimeout(watchTimer);
  if (!filePath || !mainWindow) return;
  try {
    projectWatcher = fsSync.watch(path.dirname(filePath), (_event, filename) => {
      if (filename && filename.toString() !== path.basename(filePath)) return;
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = setTimeout(async () => {
        try {
          const raw = await fs.readFile(filePath);
          const hash = hashContent(raw);
          if (hash === lastSavedHash) return;
          const data = validateProject(JSON.parse(raw.toString('utf8')));
          lastSavedHash = hash;
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('project:external-change', { filePath, data });
        } catch (error) {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('project:external-change', { filePath, error: error.message || 'External project change could not be validated' });
        }
      }, 250);
    });
    projectWatcher.on('error', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('project:external-change', { filePath, error: 'Could not monitor project file changes' });
    });
  } catch {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('project:external-change', { filePath, error: 'Could not monitor project file changes' });
  }
}

function recoveryFilePath() {
  return path.join(app.getPath('userData'), 'recovery.motion.json');
}

async function clearRecovery() {
  await fs.rm(recoveryFilePath(), { force: true }).catch(() => {});
}

async function checkExternalVersion(filePath) {
  const raw = await fs.readFile(filePath);
  const hash = hashContent(raw);
  if (!lastSavedHash || hash === lastSavedHash) return null;
  const data = validateProject(JSON.parse(raw.toString('utf8')));
  lastSavedHash = hash;
  return data;
}

async function chooseSavePath() {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Motion Studio project',
    defaultPath: 'untitled.motion.json',
    filters: [{ name: 'Motion Studio Project', extensions: ['motion.json', 'json'] }]
  });
  return canceled || !filePath ? null : filePath;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 980, minWidth: 1100, minHeight: 720,
    backgroundColor: '#101116',
    title: 'Motion Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; if (projectWatcher) projectWatcher.close(); projectWatcher = null; });
  if (isDev) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
app.whenReady().then(() => {
  ipcMain.handle('project:save', async (_event, data) => {
    const previousPath = currentProjectPath;
    let filePath = currentProjectPath;
    if (!filePath) filePath = await chooseSavePath();
    if (!filePath) return { canceled: true };
    if (previousPath && filePath === previousPath) {
      try {
        const externalData = await checkExternalVersion(filePath);
        if (externalData) return { canceled: false, conflict: true, filePath, data: externalData };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return { canceled: false, conflict: true, filePath };
      }
    }
    await writeProject(filePath, data);
    currentProjectPath = filePath;
    lastSavedHash = hashContent(JSON.stringify(data, null, 2) + '\n');
    watchProjectFile(filePath);
    await clearRecovery();
    return { canceled: false, conflict: false, filePath };
  });
  ipcMain.handle('project:save-as', async (_event, data) => {
    const filePath = await chooseSavePath();
    if (!filePath) return { canceled: true };
    await writeProject(filePath, data);
    currentProjectPath = filePath;
    lastSavedHash = hashContent(JSON.stringify(data, null, 2) + '\n');
    watchProjectFile(filePath);
    await clearRecovery();
    return { canceled: false, conflict: false, filePath };
  });
  ipcMain.handle('project:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Motion Studio Project', extensions: ['json', 'motion.json'] }]
    });
    if (canceled || !filePaths[0]) return { canceled: true };
    const data = await readProject(filePaths[0]);
    const raw = await fs.readFile(filePaths[0]);
    currentProjectPath = filePaths[0];
    lastSavedHash = hashContent(raw);
    watchProjectFile(filePaths[0]);
    await clearRecovery();
    return { canceled: false, filePath: filePaths[0], data };
  });
  ipcMain.handle('project:autosave', async (_event, data) => {
    validateProject(data);
    if (currentProjectPath) {
      try {
        const externalData = await checkExternalVersion(currentProjectPath);
        if (externalData) return { saved: false, conflict: true, filePath: currentProjectPath, data: externalData };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return { saved: false, conflict: true, filePath: currentProjectPath };
      }
      await writeProject(currentProjectPath, data);
      lastSavedHash = hashContent(JSON.stringify(data, null, 2) + '\n');
      return { saved: true, recovery: false, filePath: currentProjectPath };
    }
    const filePath = recoveryFilePath();
    await writeProject(filePath, data);
    return { saved: true, recovery: true, filePath };
  });
  ipcMain.handle('project:get-recovery', async () => {
    const filePath = recoveryFilePath();
    try {
      const stat = await fs.stat(filePath);
      const data = await readProject(filePath);
      return { available: true, filePath, modifiedAt: stat.mtime.toISOString(), data };
    } catch (error) {
      if (error.code === 'ENOENT') return { available: false };
      throw error;
    }
  });
  ipcMain.handle('project:discard-recovery', async () => {
    await clearRecovery();
    return { discarded: true };
  });
  ipcMain.handle('media:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media', extensions: ['png','jpg','jpeg','webp','gif','svg','mp4','mov','webm','mp3','wav','ogg','m4a'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (canceled) return [];
    return filePaths.map(filePath => ({ name: path.basename(filePath), path: filePath, url: pathToFileURL(filePath).href }));
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
