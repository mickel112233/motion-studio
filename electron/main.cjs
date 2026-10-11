const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { inspectFfmpeg, probeAudioStream } = require('./ffmpeg-runtime.cjs');
const { createFfmpegFrameExporter, validateExportSpec, validateCompletedFrameCount } = require('./ffmpeg-export.cjs');

const isDev = !app.isPackaged;
const MAX_PROJECT_BYTES = 20 * 1024 * 1024;
let currentProjectPath = null;
let lastSavedHash = null;
let lastNotifiedExternalHash = null;
let projectWatcher = null;
let watchTimer = null;
let mainWindow = null;
let ffmpegExportSession = null;

function validateProject(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Project must be a JSON object');
  if (data.schemaVersion !== undefined && data.schemaVersion !== 1) throw new Error('Unsupported project schema version: ' + data.schemaVersion);
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

function migrateProject(data) {
  validateProject(data);
  // Files created before schema versioning are the original v1 format. Stamp the
  // version in memory; preserve unknown/future versions as a hard error above.
  if (data.schemaVersion === undefined) return { ...data, schemaVersion: 1 };
  return data;
}

async function readProject(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_PROJECT_BYTES) throw new Error('Project file exceeds 20 MB');
  const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
  return migrateProject(data);
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


const PROVIDER_KINDS = new Set(['openai-compatible', 'anthropic', 'gemini']);
function providerStorePath() { return path.join(app.getPath('userData'), 'api-providers.json'); }
function normalizeProviderUrl(value, kind) {
  const defaults = { 'openai-compatible': 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com/v1beta' };
  const raw = (typeof value === 'string' && value.trim()) || defaults[kind];
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('Enter a valid API base URL'); }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('API URL must use HTTPS (HTTP is only suitable for local endpoints)');
  if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) throw new Error('HTTP is allowed only for localhost API endpoints');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('API base URL cannot contain credentials, query parameters or fragments');
  return parsed.toString().replace(/\/+$/, '');
}
async function readProviderStore() {
  try { const value = JSON.parse(await fs.readFile(providerStorePath(), 'utf8')); return Array.isArray(value.providers) ? value.providers : []; }
  catch (error) { if (error.code === 'ENOENT') return []; throw new Error('Could not read API provider settings'); }
}
async function writeProviderStore(providers) {
  const target = providerStorePath(), temp = target + '.tmp';
  await fs.writeFile(temp, JSON.stringify({ version: 1, providers }, null, 2), { mode: 0o600 });
  await fs.rename(temp, target);
}
function publicProvider(provider) {
  return { id: provider.id, name: provider.name, kind: provider.kind, baseUrl: provider.baseUrl, model: provider.model, hasApiKey: Boolean(provider.encryptedKey), updatedAt: provider.updatedAt };
}
function decryptProviderKey(provider) {
  if (!provider.encryptedKey) throw new Error('This provider has no API key. Edit it and enter a key first.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this system; API keys cannot be decrypted safely.');
  try { return safeStorage.decryptString(Buffer.from(provider.encryptedKey, 'base64')); }
  catch { throw new Error('Could not decrypt the saved API key. Re-enter it in provider settings.'); }
}
async function requestProvider(provider, prompt, testOnly = false) {
  const key = decryptProviderKey(provider);
  const base = provider.baseUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    let response, body;
    if (provider.kind === 'openai-compatible') {
      const endpoint = base + '/chat/completions';
      response = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: provider.model, messages: testOnly ? [{ role: 'user', content: 'Reply with OK.' }] : [{ role: 'system', content: 'You are Motion Studio’s editing assistant. Give concrete video-editing and motion-design advice. Never claim to have changed the project.' }, { role: 'user', content: prompt }], max_tokens: testOnly ? 8 : 1200, temperature: 0.4 }), signal: controller.signal });
      body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || body.message || ('Provider returned HTTP ' + response.status));
      if (testOnly) return { ok: true, message: 'Connected. The selected model completed a test request.' };
      const output = body.choices?.[0]?.message?.content;
      if (typeof output !== 'string' || !output.trim()) throw new Error('Provider response did not contain assistant text');
      return { ok: true, text: output };
    }
    if (provider.kind === 'anthropic') {
      response = await fetch(base + '/v1/messages', { method: 'POST', redirect: 'error', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: provider.model, max_tokens: testOnly ? 8 : 1200, system: testOnly ? 'Reply with OK.' : 'You are Motion Studio’s editing assistant. Give concrete video-editing and motion-design advice. Never claim to have changed the project.', messages: [{ role: 'user', content: testOnly ? 'Reply with OK.' : prompt }] }), signal: controller.signal });
      body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || body.message || ('Provider returned HTTP ' + response.status));
      if (testOnly) return { ok: true, message: 'Connected. The selected Claude model completed a test request.' };
      const output = Array.isArray(body.content) ? body.content.filter(x => x.type === 'text').map(x => x.text).join('\n') : '';
      if (!output.trim()) throw new Error('Provider response did not contain assistant text');
      return { ok: true, text: output };
    }
    const endpoint = base + '/models/' + encodeURIComponent(provider.model) + ':generateContent';
    response = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ parts: [{ text: testOnly ? 'Reply with OK.' : 'You are Motion Studio’s editing assistant. Give concrete video-editing and motion-design advice; do not claim to change files.\n\n' + prompt }] }] }), signal: controller.signal });
    body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || ('Provider returned HTTP ' + response.status));
    if (testOnly) return { ok: true, message: 'Connected. The selected Gemini model completed a test request.' };
    const output = body.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('\n') || '';
    if (!output.trim()) throw new Error('Provider response did not contain assistant text');
    return { ok: true, text: output };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Provider request timed out after 20 seconds');
    throw error;
  } finally { clearTimeout(timeout); }
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
          if (hash === lastSavedHash || hash === lastNotifiedExternalHash) return;
          const data = migrateProject(JSON.parse(raw.toString('utf8')));
          // Do not advance lastSavedHash until the renderer explicitly accepts this version.
          // Otherwise a user who declines the reload could unknowingly overwrite agent edits.
          lastNotifiedExternalHash = hash;
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
  const data = migrateProject(JSON.parse(raw.toString('utf8')));
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

  ipcMain.handle('export:capabilities', async () => ({ ffmpeg: inspectFfmpeg({ resourcesPath: process.resourcesPath, appPath: app.getAppPath() }) }));

  ipcMain.handle('export:ffmpeg-begin', async (_event, input) => {
    if (ffmpegExportSession) throw new Error('Another FFmpeg export is already running');
    const runtime = inspectFfmpeg({ resourcesPath: process.resourcesPath, appPath: app.getAppPath() });
    if (!runtime.available) throw new Error(runtime.message || 'FFmpeg is unavailable');
    const spec = validateExportSpec({ width: input?.width, height: input?.height, fps: input?.fps });
    const duration = Number(input?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new Error('Export duration must be greater than 0 and at most 120 seconds');
    const suppliedAudio = Array.isArray(input?.audioClips) ? input.audioClips : [];
    const suppliedVideoAudio = Array.isArray(input?.videoAudioClips) ? input.videoAudioClips : [];
    if (suppliedAudio.length + suppliedVideoAudio.length > 32) throw new Error('MP4 export supports up to 32 audio clips');
    const audioClips = [];
    const resolveLocalMedia = async clip => {
      if (!clip || typeof clip.url !== 'string' || !clip.url.startsWith('file:')) return null;
      let clipPath;
      try { clipPath = fileURLToPath(clip.url); } catch { return null; }
      const stat = await fs.stat(clipPath).catch(() => null);
      return stat?.isFile() ? clipPath : null;
    };
    for (const clip of suppliedAudio) {
      const clipPath = await resolveLocalMedia(clip);
      if (!clipPath) continue;
      audioClips.push({ path: clipPath, start: clip.start, duration: clip.duration, volume: clip.volume, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut });
    }
    let embeddedAudioCount = 0;
    for (const clip of suppliedVideoAudio) {
      const clipPath = await resolveLocalMedia(clip);
      if (!clipPath || !await probeAudioStream({ ffmpegPath: runtime.executable, filePath: clipPath })) continue;
      audioClips.push({ path: clipPath, start: clip.start, duration: clip.duration, volume: clip.volume, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut });
      embeddedAudioCount += 1;
    }
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export MP4 video',
      defaultPath: 'motion-studio-export.mp4',
      buttonLabel: 'Export MP4',
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    });
    if (canceled || !filePath) return { canceled: true };
    if (path.extname(filePath).toLowerCase() !== '.mp4') throw new Error('Choose an .mp4 output filename');
    const exporter = createFfmpegFrameExporter({
      executable: runtime.executable,
      outputPath: filePath,
      width: spec.width,
      height: spec.height,
      fps: spec.fps,
      duration,
      audioClips
    });
    const id = crypto.randomUUID();
    ffmpegExportSession = { id, exporter, outputPath: filePath, frameCount: 0, duration, audioClipCount: audioClips.length, embeddedAudioCount };
    return { canceled: false, id, outputPath: filePath, audioClipCount: audioClips.length, embeddedAudioCount };
  });

  ipcMain.handle('export:ffmpeg-frame', async (_event, input) => {
    const session = ffmpegExportSession;
    if (!session || input?.id !== session.id) throw new Error('FFmpeg export session is not active');
    if (session.frameCount >= Math.ceil(session.duration * session.exporter.spec.fps)) throw new Error('All frames for this export have already been written');
    await session.exporter.writeFrame(input.frame);
    session.frameCount += 1;
    return { framesWritten: session.frameCount };
  });

  ipcMain.handle('export:ffmpeg-finish', async (_event, input) => {
    const session = ffmpegExportSession;
    if (!session || input?.id !== session.id) throw new Error('FFmpeg export session is not active');
    try {
      validateCompletedFrameCount(session.frameCount, session.duration, session.exporter.spec.fps);
      await session.exporter.finish();
      return { outputPath: session.outputPath, framesWritten: session.frameCount, audioClipCount: session.audioClipCount, embeddedAudioCount: session.embeddedAudioCount };
    } catch (error) {
      await session.exporter.cancel().catch(() => {});
      await fs.rm(session.outputPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      if (ffmpegExportSession?.id === session.id) ffmpegExportSession = null;
    }
  });

  ipcMain.handle('export:ffmpeg-cancel', async (_event, input) => {
    const session = ffmpegExportSession;
    if (!session || input?.id !== session.id) return { canceled: true };
    ffmpegExportSession = null;
    await session.exporter.cancel();
    await fs.rm(session.outputPath, { force: true }).catch(() => {});
    return { canceled: true };
  });

  ipcMain.handle('providers:list', async () => (await readProviderStore()).map(publicProvider));
  ipcMain.handle('providers:save', async (_event, input) => {
    if (!input || typeof input !== 'object') throw new Error('Provider configuration is invalid');
    const kind = input.kind;
    if (!PROVIDER_KINDS.has(kind)) throw new Error('Choose a supported API type');
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
    const model = typeof input.model === 'string' ? input.model.trim().slice(0, 200) : '';
    if (!name) throw new Error('Provider name is required');
    if (!model) throw new Error('Model ID is required');
    const baseUrl = normalizeProviderUrl(input.baseUrl, kind);
    const providers = await readProviderStore();
    const id = typeof input.id === 'string' && providers.some(p => p.id === input.id) ? input.id : crypto.randomUUID();
    const old = providers.find(p => p.id === id);
    let encryptedKey = old?.encryptedKey || '';
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this system. API key was not saved.');
      encryptedKey = safeStorage.encryptString(input.apiKey.trim()).toString('base64');
    }
    const next = { id, name, kind, baseUrl, model, encryptedKey, updatedAt: new Date().toISOString() };
    const index = providers.findIndex(p => p.id === id);
    if (index >= 0) providers[index] = next; else providers.push(next);
    await writeProviderStore(providers);
    return publicProvider(next);
  });
  ipcMain.handle('providers:delete', async (_event, id) => {
    const providers = await readProviderStore();
    const next = providers.filter(p => p.id !== id);
    await writeProviderStore(next);
    return { deleted: next.length !== providers.length };
  });
  ipcMain.handle('providers:test', async (_event, id) => {
    const provider = (await readProviderStore()).find(p => p.id === id);
    if (!provider) throw new Error('Provider was not found');
    return requestProvider(provider, '', true);
  });
  ipcMain.handle('providers:ask', async (_event, input) => {
    const provider = (await readProviderStore()).find(p => p.id === input?.id);
    if (!provider) throw new Error('Choose a saved API provider first');
    if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('Describe what you want to edit');
    const context = typeof input.projectContext === 'string' ? input.projectContext.slice(0, 12000) : '';
    return requestProvider(provider, 'Editing request:\n' + input.prompt.trim().slice(0, 5000) + '\n\nCurrent project summary:\n' + context, false);
  });

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
    lastNotifiedExternalHash = null;
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
    lastNotifiedExternalHash = null;
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
    lastNotifiedExternalHash = null;
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
      lastNotifiedExternalHash = null;
      return { saved: true, recovery: false, filePath: currentProjectPath };
    }
    const filePath = recoveryFilePath();
    await writeProject(filePath, data);
    return { saved: true, recovery: true, filePath };
  });
  ipcMain.handle('project:accept-external', async () => {
    if (!currentProjectPath) return { accepted: false };
    const raw = await fs.readFile(currentProjectPath);
    if (raw.length > MAX_PROJECT_BYTES) throw new Error('Project file exceeds 20 MB');
    migrateProject(JSON.parse(raw.toString('utf8')));
    lastSavedHash = hashContent(raw);
    lastNotifiedExternalHash = null;
    return { accepted: true, filePath: currentProjectPath };
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
app.on('before-quit', () => {
  const session = ffmpegExportSession;
  ffmpegExportSession = null;
  if (session) {
    void session.exporter.cancel().catch(() => {}).finally(() => fs.rm(session.outputPath, { force: true }).catch(() => {}));
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
