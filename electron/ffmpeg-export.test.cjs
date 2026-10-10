const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createFfmpegFrameExporter, validateExportSpec } = require('./ffmpeg-export.cjs');

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
  assert.throws(() => validateExportSpec({ width: 1920, height: 1080, fps: 61 }), /frame rate/);
  assert.throws(() => validateExportSpec({ width: 8192, height: 8192, fps: 30 }), /too large/);
});

test('builds a shell-free FFmpeg MP4 command and accepts exact-size RGBA frames', async () => {
  const captured = {};
  const exporter = createFfmpegFrameExporter({
    executable: '/usr/bin/ffmpeg', outputPath: '/tmp/output.mp4',
    width: 16, height: 16, fps: 24, spawnImpl: fakeSpawn(captured)
  });
  assert.equal(captured.executable, '/usr/bin/ffmpeg');
  assert.equal(captured.options.shell, false);
  assert.ok(captured.args.includes('pipe:0'));
  assert.ok(captured.args.includes('libx264'));
  await exporter.writeFrame(new Uint8Array(16 * 16 * 4));
  await assert.rejects(exporter.writeFrame(new Uint8Array(4)), /byte length/);
  await exporter.finish();
});

test('rejects invalid paths and cancels a running export', async () => {
  assert.throws(() => createFfmpegFrameExporter({ executable: '', outputPath: '/tmp/out.mp4', width: 16, height: 16, fps: 24 }), /executable/);
  const exporter = createFfmpegFrameExporter({
    executable: '/usr/bin/ffmpeg', outputPath: '/tmp/output.mp4',
    width: 16, height: 16, fps: 24, spawnImpl: fakeSpawn({})
  });
  await exporter.cancel();
  await assert.rejects(exporter.writeFrame(new Uint8Array(16 * 16 * 4)), /no longer accepting/);
});
