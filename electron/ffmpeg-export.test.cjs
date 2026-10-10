const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createFfmpegFrameExporter, validateExportSpec, buildFfmpegArgs, normalizeAudioClips } = require('./ffmpeg-export.cjs');

function fakeSpawn(captured) {
  return (executable, args, options) => {
    captured.executable = executable;
    captured.args = args;
    captured.options = options;
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('close', 1, 'SIGTERM')); return true; };
    child.stdin.on('finish', () => queueMicrotask(() => child.emit('close', 0, null)));
    return child;
  };
}

test('validates dimensions, frame rate, and memory bounds', () => {
  assert.equal(validateExportSpec({ width: 1920, height: 1080, fps: 30 }).frameBytes, 1920 * 1080 * 4);
  assert.throws(() => validateExportSpec({ width: 15, height: 1080, fps: 30 }), /width/);
  assert.throws(() => validateExportSpec({ width: 1919, height: 1080, fps: 30 }), /even width and height/);
  assert.throws(() => validateExportSpec({ width: 1920, height: 1080, fps: 61 }), /frame rate/);
  assert.throws(() => validateExportSpec({ width: 8192, height: 8192, fps: 30 }), /too large/);
});

test('builds a shell-free FFmpeg MP4 command and accepts exact-size RGBA frames', async () => {
  const captured = {};
  const exporter = createFfmpegFrameExporter({
    executable: '/usr/bin/ffmpeg', outputPath: '/tmp/output.mp4',
    width: 16, height: 16, fps: 24, duration: 2, audioClips: [{ path: '/media/music.wav', start: 0.5, duration: 1.5, volume: 50, fadeIn: 0.25, fadeOut: 0.5 }], spawnImpl: fakeSpawn(captured)
  });
  assert.equal(captured.executable, '/usr/bin/ffmpeg');
  assert.equal(captured.options.shell, false);
  assert.ok(captured.args.includes('pipe:0'));
  assert.ok(captured.args.includes('libx264'));
  assert.ok(captured.args.includes('/media/music.wav'));
  assert.ok(captured.args.includes('aac'));
  assert.ok(captured.args[captured.args.indexOf('-filter_complex') + 1].includes('volume=0.5000'));
  assert.ok(captured.args.includes('-filter_complex'));
  assert.ok(captured.args[captured.args.indexOf('-filter_complex') + 1].includes('adelay=500|500'));
  await exporter.writeFrame(new Uint8Array(16 * 16 * 4));
  await assert.rejects(exporter.writeFrame(new Uint8Array(4)), /byte length/);
  await exporter.finish();
});

test('rejects invalid paths and cancels a running export', async () => {
  assert.throws(() => createFfmpegFrameExporter({ executable: '', outputPath: '/tmp/out.mp4', width: 16, height: 16, fps: 24 }), /executable/);
  const exporter = createFfmpegFrameExporter({
    executable: '/usr/bin/ffmpeg', outputPath: '/tmp/output.mp4',
    width: 16, height: 16, fps: 24, duration: 1, spawnImpl: fakeSpawn({})
  });
  await exporter.cancel();
  await assert.rejects(exporter.writeFrame(new Uint8Array(16 * 16 * 4)), /no longer accepting/);
});

test('builds a synchronized audio mix with volume, fades, and timeline offsets', () => {
  const args = buildFfmpegArgs({
    width: 1280, height: 720, fps: 30, duration: 10, outputPath: '/tmp/out.mp4',
    audioClips: [
      { path: '/a.wav', start: 0, duration: 4, volume: 100, fadeIn: 1, fadeOut: 1 },
      { path: '/b.mp3', start: 3, duration: 12, volume: 25, fadeIn: 0, fadeOut: 0 }
    ]
  });
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /afade=t=in:st=0:d=1\.0000/);
  assert.match(filter, /afade=t=out:st=3\.0000:d=1\.0000/);
  assert.match(filter, /adelay=3000\|3000/);
  assert.match(filter, /amix=inputs=2/);
  assert.ok(filter.includes('[aout]'));
  assert.equal(normalizeAudioClips([{ path: '/late.wav', start: 12, duration: 2, volume: 100 }], 10).length, 0);
});

test('rejects malformed or excessive audio clips and invalid export duration', () => {
  assert.throws(() => normalizeAudioClips([{ path: '/a.wav', start: -1, duration: 2, volume: 50 }], 10), /invalid timing/);
  assert.throws(() => normalizeAudioClips(Array.from({ length: 33 }, (_, i) => ({ path: '/' + i, start: 0, duration: 1, volume: 100 })), 10), /32 audio clips/);
  assert.throws(() => createFfmpegFrameExporter({ executable: 'ffmpeg', outputPath: '/tmp/out.mp4', width: 16, height: 16, fps: 24 }), /duration/);
});
