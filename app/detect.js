// Frame-by-frame pose detection in the browser with MediaPipe Pose Landmarker.
// The video is read from a local object URL; nothing is uploaded.
import { FilesetResolver, PoseLandmarker } from './vendor/tasks-vision/vision_bundle.mjs';

const WASM = new URL('./vendor/tasks-vision/wasm', import.meta.url).href;
export const MODELS = {
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('model')), ms))]);

let fileset = null;
const cache = {};
async function landmarker(model) {
  fileset ||= await withTimeout(FilesetResolver.forVisionTasks(WASM), 60000);
  if (cache[model]) return cache[model];
  const opts = delegate => ({
    baseOptions: { modelAssetPath: MODELS[model], delegate },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  // GPU (WebGL) first; some phones fail or never finish creating it, so fall back to CPU
  try { cache[model] = await withTimeout(PoseLandmarker.createFromOptions(fileset, opts("GPU")), 180000); }
  catch (e) { cache[model] = await withTimeout(PoseLandmarker.createFromOptions(fileset, opts("CPU")), 180000); }
  return cache[model];
}

// Resolve on `ev`, reject on a media error or after `ms` (iOS Safari can stay silent forever
// instead of firing an error, so every wait has a limit).
const once = (el, ev, ms = 15000) => new Promise((res, rej) => {
  let timer;
  const done = fn => arg => { clearTimeout(timer); el.removeEventListener(ev, ok); el.removeEventListener('error', bad); fn(arg); };
  const ok = done(res), bad = done(() => rej(new Error('video')));
  el.addEventListener(ev, ok, { once: true }); el.addEventListener('error', bad, { once: true });
  timer = setTimeout(done(() => rej(new Error('timeout'))), ms);
});

// Seek and wait for the frame; seeking to the current time fires no 'seeked' in Safari.
export async function seekTo(v, t, ms = 8000) {
  if (Math.abs(v.currentTime - t) < 1e-4 && !v.seeking) return;
  const p = once(v, 'seeked', ms);
  v.currentTime = t;
  await p;
}

export async function loadVideo(src) {
  const v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
  // iOS Safari only decodes media for elements in the document; keep it on screen but invisible
  v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
  document.body.appendChild(v);
  const meta = once(v, 'loadedmetadata', 20000);
  v.src = src; v.load();
  await meta;
  if (!v.videoWidth) throw new Error('video');
  if (v.readyState < 2) {
    // iOS ignores preload until playback starts; a muted play()/pause() makes it decode the first frame
    const data = once(v, 'loadeddata', 20000);
    try { await v.play(); } catch (e) {}
    await data;
    v.pause();
  }
  return v;
}

export function disposeVideo(v) {
  if (!v) return;
  v.pause(); v.removeAttribute('src'); v.load(); v.remove();
}

// Source frame rate from presented-frame timestamps while playing a short stretch.
export async function estimateFps(v) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return null;
  const ts = [];
  await seekTo(v, 0);
  await new Promise(res => {
    let done = false;
    const stop = () => { if (done) return; done = true; v.pause(); res(); };
    const cb = (now, meta) => { ts.push(meta.mediaTime); if (ts.length >= 24) stop(); else v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
    v.play().catch(stop);
    setTimeout(stop, 2500);
  });
  const d = ts.slice(1).map((t, i) => t - ts[i]).filter(x => x > 0.002).sort((a, b) => a - b);
  if (d.length < 5) return null;
  return 1 / d[0 | (d.length / 2)];
}

/**
 * Detect poses from t0 to t1 (seconds) sampled at fs Hz.
 * Returns { fps: fs, w, h, t0, img: [N][33][x,y,z,vis] | null, world: [N][33][x,y,z] | null }
 */
export async function detectPoses(v, { fs, t0 = 0, t1 = v.duration, model = 'heavy', onProgress = () => {}, signal } = {}) {
  const lm = await landmarker(model);
  const w = v.videoWidth, h = v.videoHeight;
  const N = Math.max(1, Math.floor((t1 - t0) * fs + 1e-3));
  const img = [], world = [];
  // draw each seeked frame to a canvas first: passing the <video> directly can hand the
  // model a stale frame when the element is not on screen
  const k = Math.min(1, 960 / Math.max(w, h));
  const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  const ctx = cv.getContext('2d', { willReadFrequently: false });
  // timestamps for VIDEO mode must increase across calls on the same landmarker
  const base = (lm._lastTs || 0) + 1000;
  for (let i = 0; i < N; i++) {
    if (signal?.aborted) throw new Error('abort');
    try { await seekTo(v, t0 + i / fs + 0.002); }
    catch (e) { if (e.message === 'timeout' && i > 0) { img.push(null); world.push(null); continue; } throw e; }
    const ts = base + Math.round(i * 1000 / fs);
    ctx.drawImage(v, 0, 0, cv.width, cv.height);
    const r = lm.detectForVideo(cv, ts);
    lm._lastTs = ts;
    if (r.landmarks && r.landmarks.length) {
      img.push(r.landmarks[0].map(p => [+(p.x * w).toFixed(2), +(p.y * h).toFixed(2), +(p.z * w).toFixed(2), +(p.visibility ?? 0).toFixed(3)]));
      world.push(r.worldLandmarks[0].map(p => [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)]));
    } else { img.push(null); world.push(null); }
    if (i % 3 === 0) onProgress((i + 1) / N);
  }
  onProgress(1);
  return { fps: fs, w, h, t0, img, world };
}
