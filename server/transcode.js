// Video compression pipeline with adaptive renditions.
//
// Codec: H.264. The 480p floor stays Baseline profile (hardware-decodes on every
// cheap Android), with higher renditions in Main/High for sharper playback on
// good phones and laptops. Each rendition is a self-contained progressive MP4
// with +faststart, so a plain <video> can stream it and the client just picks
// the right file for the connection.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

// Portrait targets. We never upscale: a rendition is only produced when the
// source is at least about that tall (480 is always produced as the floor).
export const RENDITIONS = [
  { label: '480',  w: 480,  h: 854,  crf: 23, maxrate: '900k',  bufsize: '1800k', profile: 'baseline', level: '3.1', abr: '64k'  },
  { label: '720',  w: 720,  h: 1280, crf: 22, maxrate: '1800k', bufsize: '3600k', profile: 'main',     level: '3.1', abr: '96k'  },
  { label: '1080', w: 1080, h: 1920, crf: 21, maxrate: '3500k', bufsize: '7000k', profile: 'high',     level: '4.0', abr: '128k' },
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

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-800)}`))));
  });
}

const scaleFilter = (w, h) => `scale='if(gt(a,${w}/${h}),${w},-2)':'if(gt(a,${w}/${h}),-2,${h})',fps=30`;
const imageFit = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p`;

function rArgs(r, input, output, { isImage = false, audioPath = null, maxSeconds = 60, silentSeconds = 8 } = {}) {
  const a = ['-y'];
  if (isImage) a.push('-loop', '1', '-i', input); else a.push('-i', input);
  if (audioPath) a.push('-i', audioPath);
  a.push('-vf', isImage ? imageFit(r.w, r.h) : scaleFilter(r.w, r.h),
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', r.profile, '-level', r.level,
    '-crf', String(r.crf), '-maxrate', r.maxrate, '-bufsize', r.bufsize, '-pix_fmt', 'yuv420p');
  const hasAudio = audioPath || !isImage;
  if (hasAudio) a.push('-c:a', 'aac', '-b:a', r.abr, '-ac', '2', '-ar', '44100');
  if (audioPath) a.push('-map', '0:v:0', '-map', '1:a:0');
  if (isImage && audioPath) a.push('-t', String(maxSeconds), '-shortest');
  else if (isImage) a.push('-t', String(silentSeconds));
  else if (audioPath) a.push('-shortest');
  a.push('-movflags', '+faststart', output);
  return a;
}

// Largest pixel dimension of the source, used to avoid upscaling.
export async function probeMaxDim(file) {
  if (!(await hasFfmpeg())) return 0;
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'quiet', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(0));
    p.on('exit', () => { const [w, h] = out.trim().split(',').map(Number); resolve(Math.max(w || 0, h || 0)); });
  });
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

// Produce renditions at `${outBase}_<label>.mp4`. Encodes 480 first and calls
// opts.onFirst(labels) so the caller can publish immediately, then fills in the
// HD renditions. Returns the list of labels actually produced.
export async function renderRenditions(input, outBase, opts = {}) {
  if (!(await hasFfmpeg())) {
    fs.copyFileSync(input, `${outBase}_480.mp4`); // keep posting working without ffmpeg
    if (opts.onFirst) await opts.onFirst(['480']);
    return ['480'];
  }
  const srcMax = opts.isImage ? Infinity : await probeMaxDim(input);
  const made = [];
  for (const r of RENDITIONS) {
    if (r.label !== '480' && srcMax && srcMax < r.h * 0.95) continue; // never upscale
    await runFfmpeg(rArgs(r, input, `${outBase}_${r.label}.mp4`, opts));
    made.push(r.label);
    if (r.label === '480' && opts.onFirst) await opts.onFirst([...made]);
  }
  return made;
}
