// Video compression pipeline.
//
// Codec decision: H.264 (AVC) Baseline profile, level 3.0.
//   - It is the ONLY codec with hardware decode on effectively every Android
//     phone ever sold, including <$60 devices. HEVC/AV1 would save 30-50%
//     bandwidth but fall back to CPU decode on cheap phones, which stutters
//     and drains the battery — exactly the phones we target.
//   - 480x854 (portrait 480p), capped at 30fps.
//   - CRF 27 with a hard bitrate ceiling of 450 kbps video + 48 kbps HE-ish AAC
//     mono audio => ~500 kbps total. A 60-second clip is ~3.5 MB and streams
//     in real time on a 0.7 Mbps 3G link with headroom for jitter.
//   - +faststart moves the moov atom to the front so playback starts before
//     the file finishes downloading.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

export const FFMPEG_ARGS = (input, output) => [
  '-y', '-i', input,
  '-vf', "scale='if(gt(a,480/854),480,-2)':'if(gt(a,480/854),-2,854)',fps=30",
  '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0',
  '-crf', '27', '-maxrate', '450k', '-bufsize', '900k',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-ar', '44100',
  '-movflags', '+faststart',
  output,
];

let ffmpegAvailable = null;
export async function hasFfmpeg() {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  ffmpegAvailable = await new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-version']);
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
  return ffmpegAvailable;
}

export async function transcode(inputPath, outputPath) {
  if (!(await hasFfmpeg())) {
    // No ffmpeg on this machine: keep the original so uploads still work,
    // but flag it — production must always transcode.
    fs.copyFileSync(inputPath, outputPath);
    return { transcoded: false };
  }
  await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', FFMPEG_ARGS(inputPath, outputPath));
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-800)}`))));
  });
  return { transcoded: true };
}

export async function probeDuration(file) {
  if (!(await hasFfmpeg())) return 0;
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(0));
    p.on('exit', () => resolve(parseFloat(out) || 0));
  });
}
