// Frame-by-frame pose detection in the browser with MediaPipe Pose Landmarker.
// The video is read from a local object URL; nothing is uploaded.
import { FilesetResolver, PoseLandmarker } from './vendor/tasks-vision/vision_bundle.mjs';

const WASM = new URL('./vendor/tasks-vision/wasm', import.meta.url).href;
export const MODELS = {
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};

let fileset = null;
const cache = {};
async function landmarker(model) {
  fileset ||= await FilesetResolver.forVisionTasks(WASM);
  if (cache[model]) return cache[model];
  const opts = delegate => ({
    baseOptions: { modelAssetPath: MODELS[model], delegate },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { cache[model] = await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
  catch (e) { cache[model] = await PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
  return cache[model];
}

const once = (el, ev) => new Promise((res, rej) => {
  const ok = () => { el.removeEventListener('error', bad); res(); };
  const bad = () => { el.removeEventListener(ev, ok); rej(new Error('video')); };
  el.addEventListener(ev, ok, { once: true }); el.addEventListener('error', bad, { once: true });
});

export async function loadVideo(src) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
  v.src = src;
  await once(v, 'loadedmetadata');
  if (!v.videoWidth) throw new Error('video');
  if (v.readyState < 2) await once(v, 'loadeddata');
  return v;
}

// Source frame rate from presented-frame timestamps while playing a short stretch.
export async function estimateFps(v) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return null;
  const ts = [];
  v.currentTime = 0; await once(v, 'seeked');
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
    v.currentTime = t0 + i / fs + 0.002;
    await once(v, 'seeked');
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
