const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { binaryName, candidatePaths, inspectFfmpeg, probeAudioStream } = require('./ffmpeg-runtime.cjs');

test('selects the platform-specific FFmpeg executable name', () => {
  assert.equal(binaryName('win32'), 'ffmpeg.exe');
  assert.equal(binaryName('linux'), 'ffmpeg');
});

test('checks packaged, project runtime, and PATH locations without shell commands', () => {
  const candidates = candidatePaths({
    platform: 'win32',
    resourcesPath: 'C:/app/resources',
    appPath: 'C:/app',
    env: { PATH: 'C:/tools;D:/ffmpeg/bin' }
  });
  assert.ok(candidates.includes(path.win32.join('C:/app/resources', 'ffmpeg', 'ffmpeg.exe')));
  assert.ok(candidates.includes(path.win32.join('C:/app', 'assets', 'runtime', 'ffmpeg', 'ffmpeg.exe')));
  assert.ok(candidates.includes(path.win32.join('C:/tools', 'ffmpeg.exe')));
  assert.equal(new Set(candidates).size, candidates.length);
});

test('reports a valid FFmpeg executable and version', () => {
  const result = inspectFfmpeg({
    platform: 'linux',
    resourcesPath: '/resources',
    appPath: '/app',
    env: { PATH: '' },
    existsSync: candidate => candidate === path.join('/resources', 'ffmpeg', 'ffmpeg'),
    spawnSync: (executable, args, options) => {
      assert.equal(executable, path.join('/resources', 'ffmpeg', 'ffmpeg'));
      assert.deepEqual(args, ['-version']);
      assert.equal(options.shell, undefined);
      return { status: 0, stdout: 'ffmpeg version 7.1 Copyright (c) FFmpeg developers\n' };
    }
  });
  assert.equal(result.available, true);
  assert.equal(result.version, 'ffmpeg version 7.1 Copyright (c) FFmpeg developers');
});

test('does not treat failed, timed out, or unrelated executables as FFmpeg', () => {
  const options = {
    platform: 'linux', resourcesPath: '/resources', appPath: '/app', env: { PATH: '' },
    existsSync: candidate => candidate === path.join('/resources', 'ffmpeg', 'ffmpeg'),
    spawnSync: () => ({ status: 1, stdout: 'not ffmpeg' })
  };
  const result = inspectFfmpeg(options);
  assert.equal(result.available, false);
  assert.equal(result.executable, null);
  assert.match(result.message, /browser-based WebM export/);
});

test('detects embedded audio streams with a sibling ffprobe without shell execution', () => {
  const calls = [];
  const found = probeAudioStream({
    platform: 'linux',
    ffmpegPath: '/tools/ffmpeg',
    filePath: '/media/source video.mp4',
    env: { PATH: '' },
    existsSync: candidate => candidate === '/tools/ffprobe',
    spawnSync: (executable, args, options) => {
      calls.push({ executable, args, options });
      return { status: 0, stdout: '1\\n' };
    }
  });
  assert.equal(found, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, '/tools/ffprobe');
  assert.ok(calls[0].args.includes('/media/source video.mp4'));
  assert.equal(calls[0].options.shell, false);
});

test('skips embedded audio when ffprobe is missing or the source has no audio stream', () => {
  assert.equal(probeAudioStream({ ffmpegPath: '/tools/ffmpeg', filePath: '/media/silent.mp4', platform: 'linux', env: { PATH: '' }, existsSync: () => false }), false);
  assert.equal(probeAudioStream({
    ffmpegPath: '/tools/ffmpeg', filePath: '/media/silent.mp4', platform: 'linux', env: { PATH: '' },
    existsSync: candidate => candidate === '/tools/ffprobe',
    spawnSync: () => ({ status: 0, stdout: '' })
  }), false);
});
