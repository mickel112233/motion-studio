const { spawn } = require('node:child_process');

const MAX_FRAME_BYTES = 128 * 1024 * 1024;

function validateExportSpec({ width, height, fps }) {
  if (!Number.isInteger(width) || width < 16 || width > 8192) throw new Error('Export width must be between 16 and 8192 pixels');
  if (!Number.isInteger(height) || height < 16 || height > 8192) throw new Error('Export height must be between 16 and 8192 pixels');
  if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error('Export frame rate must be between 1 and 60 FPS');
  const frameBytes = width * height * 4;
  if (!Number.isSafeInteger(frameBytes) || frameBytes > MAX_FRAME_BYTES) throw new Error('Frame is too large for the FFmpeg export pipeline');
  return { width, height, fps, frameBytes };
}

function createFfmpegFrameExporter({ executable, outputPath, width, height, fps, spawnImpl = spawn }) {
  if (typeof executable !== 'string' || !executable) throw new Error('FFmpeg executable is required');
  if (typeof outputPath !== 'string' || !outputPath) throw new Error('Export output path is required');
  const spec = validateExportSpec({ width, height, fps });
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pixel_format', 'rgba',
    '-video_size', spec.width + 'x' + spec.height,
    '-framerate', String(spec.fps), '-i', 'pipe:0',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath
  ];
  const child = spawnImpl(executable, args, { shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  let closed = false;
  let processError = null;
  child.stderr?.on('data', chunk => {
    stderr = (stderr + chunk.toString()).slice(-16384);
  });
  child.on('error', error => { processError = error; });
  child.stdin?.on('error', error => { processError = error; });
  const completion = new Promise((resolve, reject) => {
    child.on('close', (code, signal) => {
      closed = true;
      if (processError) reject(new Error('Could not run FFmpeg: ' + processError.message));
      else if (code !== 0) reject(new Error('FFmpeg export failed' + (signal ? ' (' + signal + ')' : '') + (stderr.trim() ? ': ' + stderr.trim() : ' with exit code ' + code)));
      else resolve();
    });
  });

  return {
    spec,
    async writeFrame(input) {
      if (closed || child.stdin.destroyed || child.stdin.writableEnded) throw new Error('FFmpeg export is no longer accepting frames');
      const frame = Buffer.isBuffer(input) ? input : ArrayBuffer.isView(input) ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : input instanceof ArrayBuffer ? Buffer.from(input) : null;
      if (!frame || frame.byteLength !== spec.frameBytes) throw new Error('Frame byte length does not match the configured RGBA dimensions');
      if (processError) throw new Error('FFmpeg could not continue: ' + processError.message);
      if (!child.stdin.write(frame)) {
        await new Promise((resolve, reject) => {
          const onDrain = () => { cleanup(); resolve(); };
          const onError = error => { cleanup(); reject(error); };
          const cleanup = () => { child.stdin.removeListener('drain', onDrain); child.stdin.removeListener('error', onError); };
          child.stdin.once('drain', onDrain);
          child.stdin.once('error', onError);
        });
      }
    },
    async finish() {
      if (!closed && !child.stdin.writableEnded) child.stdin.end();
      await completion;
    },
    async cancel() {
      if (!closed) {
        child.stdin.destroy();
        child.kill();
      }
      await completion.catch(() => {});
    }
  };
}

module.exports = { MAX_FRAME_BYTES, validateExportSpec, createFfmpegFrameExporter };
