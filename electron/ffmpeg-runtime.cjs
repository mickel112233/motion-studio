const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

function binaryName(platform = process.platform) {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function candidatePaths({ platform = process.platform, resourcesPath = process.resourcesPath, appPath = process.cwd(), env = process.env } = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const pathDelimiter = platform === 'win32' ? ';' : ':';
  const name = binaryName(platform);
  const candidates = [];
  if (resourcesPath) {
    candidates.push(pathApi.join(resourcesPath, 'ffmpeg', name));
    candidates.push(pathApi.join(resourcesPath, 'assets', 'runtime', 'ffmpeg', name));
  }
  if (appPath) {
    candidates.push(pathApi.join(appPath, 'assets', 'runtime', 'ffmpeg', name));
    candidates.push(pathApi.join(appPath, 'runtime', 'ffmpeg', name));
  }
  const pathEntries = (env.PATH || '').split(pathDelimiter).filter(Boolean);
  for (const entry of pathEntries) candidates.push(pathApi.join(entry, name));
  return [...new Set(candidates)];
}

function inspectFfmpeg(options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  const run = options.spawnSync || spawnSync;
  const platform = options.platform || process.platform;
  const candidates = candidatePaths({ ...options, platform });
  for (const executable of candidates) {
    if (!existsSync(executable)) continue;
    const result = run(executable, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 3000, maxBuffer: 1024 * 1024 });
    if (result.error || result.status !== 0) continue;
    const firstLine = String(result.stdout || '').split(/\r?\n/, 1)[0].trim();
    if (!firstLine.toLowerCase().startsWith('ffmpeg version')) continue;
    return { available: true, executable, version: firstLine };
  }
  return {
    available: false,
    executable: null,
    version: null,
    message: 'FFmpeg was not found. The current build will use browser-based WebM export where supported.'
  };
}

module.exports = { binaryName, candidatePaths, inspectFfmpeg };
