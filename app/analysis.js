// Gait analysis for a side-view running clip, ported from the Python pipeline
// (core.py + analyze.py). Runs in the browser and in Node (for testing).
// Coordinates are image pixels, x to the right, y down. Analysis assumes the
// runner moves toward +x and that "R" landmarks are the side nearer the camera;
// prepare() mirrors / relabels clips that do not match.

export const L = { sh: 11, el: 13, wr: 15, hip: 23, kn: 25, an: 27, he: 29, to: 31, ear: 7 };
export const R = { sh: 12, el: 14, wr: 16, hip: 24, kn: 26, an: 28, he: 30, to: 32, ear: 8 };
const LEG = [[25, 26], [27, 28], [29, 30], [31, 32]];
// left/right landmark pairs (MediaPipe pose, 33 points)
const LR_PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18],
  [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];

/* ---------- small numeric helpers ---------- */
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const std = a => { if (a.length < 1) return 0; const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
const percentile = (a, p) => { const s = [...a].sort((x, y) => x - y); const k = (s.length - 1) * p / 100; const f = Math.floor(k), c = Math.min(s.length - 1, f + 1); return s[f] + (s[c] - s[f]) * (k - f); };
const hypot = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const deg = r => r * 180 / Math.PI;

function ang3(a, b, c) {
  const v1x = a[0] - b[0], v1y = a[1] - b[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
  const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) + 1e-9);
  return deg(Math.acos(Math.max(-1, Math.min(1, cos))));
}
// angle of lo->hi from vertical, + = leaning toward +x (forward)
const lean = (lo, hi) => deg(Math.atan2(hi[0] - lo[0], -(hi[1] - lo[1])));

function interp(xq, xs, ys) {
  return xq.map(x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    let i = 1; while (xs[i] < x) i++;
    const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[i - 1] + t * (ys[i] - ys[i - 1]);
  });
}

/* ---------- Savitzky-Golay (poly 2, scipy mode='interp') ---------- */
function polyfit2(xs, ys) {
  // least squares y = c0 + c1 x + c2 x^2
  let S = [0, 0, 0, 0, 0], T = [0, 0, 0];
  for (let i = 0; i < xs.length; i++) { let p = 1; for (let k = 0; k < 5; k++) { S[k] += p; if (k < 3) T[k] += p * ys[i]; p *= xs[i]; } }
  const M = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
  return solve3(M, T);
}
function solve3(M, b) {
  const A = M.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    for (let r = 0; r < 3; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < 4; c++) A[r][c] -= f * A[i][c]; }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}
function savgol1(y, win) {
  const n = y.length; if (n < win) win = n % 2 ? n : n - 1;
  if (win < 3) return y.slice();
  const h = (win - 1) / 2, out = new Array(n);
  const xs = Array.from({ length: win }, (_, i) => i - h);
  // interior: convolution weights from fitting at x=0
  const w = xs.map((_, j) => { const e = xs.map((__, k) => (k === j ? 1 : 0)); return polyfit2(xs, e)[0]; });
  for (let i = h; i < n - h; i++) { let s = 0; for (let j = 0; j < win; j++) s += w[j] * y[i - h + j]; out[i] = s; }
  const ev = (c, x) => c[0] + c[1] * x + c[2] * x * x;
  const xe = Array.from({ length: win }, (_, i) => i);
  const c0 = polyfit2(xe, y.slice(0, win)); for (let i = 0; i < h; i++) out[i] = ev(c0, i);
  const c1 = polyfit2(xe, y.slice(n - win)); for (let i = n - h; i < n; i++) out[i] = ev(c1, i - (n - win));
  return out;
}
function smooth(P, fps) {
  // P: N x 33 x 2
  let win = Math.round(fps * 0.15) | 1; win = Math.max(win, 5);
  const N = P.length, out = P.map(f => f.map(p => [p[0], p[1]]));
  for (let j = 0; j < 33; j++) for (let d = 0; d < 2; d++) {
    const s = savgol1(P.map(f => f[j][d]), win);
    for (let t = 0; t < N; t++) out[t][j][d] = s[t];
  }
  return out;
}

/* ---------- scipy.signal.find_peaks(x, distance, prominence) ---------- */
function findPeaks(x, distance, prominence) {
  const n = x.length; let peaks = [];
  for (let i = 1; i < n - 1;) {
    if (x[i - 1] < x[i]) {
      let ahead = i + 1; while (ahead < n - 1 && x[ahead] === x[i]) ahead++;
      if (x[ahead] < x[i]) { peaks.push(Math.floor((i + ahead - 1) / 2)); i = ahead; continue; }
    }
    i++;
  }
  if (distance > 1 && peaks.length) {
    const keep = new Array(peaks.length).fill(true);
    const order = peaks.map((p, i) => i).sort((a, b) => x[peaks[a]] - x[peaks[b]]); // ascending; scipy walks from highest
    for (let k = order.length - 1; k >= 0; k--) {
      const j = order[k]; if (!keep[j]) continue;
      for (let i = j - 1; i >= 0 && peaks[j] - peaks[i] < distance; i--) keep[i] = false;
      for (let i = j + 1; i < peaks.length && peaks[i] - peaks[j] < distance; i++) keep[i] = false;
    }
    peaks = peaks.filter((_, i) => keep[i]);
  }
  return peaks.filter(p => {
    let lmin = x[p], rmin = x[p];
    for (let i = p - 1; i >= 0 && x[i] <= x[p]; i--) lmin = Math.min(lmin, x[i]);
    for (let i = p + 1; i < n && x[i] <= x[p]; i++) rmin = Math.min(rmin, x[i]);
    return x[p] - Math.max(lmin, rmin) >= prominence;
  });
}

/* ---------- preparation: fill gaps, direction, left/right ---------- */
function fillGaps(arr, dims) {
  // arr: N x 33 x dims, NaN where missing -> linear interpolation per series
  const N = arr.length;
  for (let j = 0; j < 33; j++) for (let d = 0; d < dims; d++) {
    const ok = []; for (let t = 0; t < N; t++) if (Number.isFinite(arr[t][j][d])) ok.push(t);
    if (!ok.length) continue;
    for (let t = 0; t < N; t++) {
      if (Number.isFinite(arr[t][j][d])) continue;
      let k = 0; while (k < ok.length && ok[k] < t) k++;
      const a = ok[k - 1], b = ok[k];
      if (a == null) arr[t][j][d] = arr[b][j][d];
      else if (b == null) arr[t][j][d] = arr[a][j][d];
      else arr[t][j][d] = arr[a][j][d] + (arr[b][j][d] - arr[a][j][d]) * (t - a) / (b - a);
    }
  }
}

function bodyH(P) {
  return median(P.map(f => hypot(f[0], mid(f[27], f[28]))));
}

// Viterbi over per-frame leg swap state; prior: R leg nearer camera (smaller world z)
function fixLR(img, wld) {
  const N = img.length;
  const hip = img.map(f => mid(f[23], f[24]));
  const bh = bodyH(img);
  const feat = (t, s) => {
    const out = [];
    for (const [l, r] of LEG) {
      const [a, b] = s === 0 ? [l, r] : [r, l];
      out.push(img[t][a][0] - hip[t][0], img[t][a][1] - hip[t][1], img[t][b][0] - hip[t][0], img[t][b][1] - hip[t][1]);
    }
    return out;
  };
  const unary = (t, s) => {
    let c = 0;
    for (const [l, r] of LEG.slice(0, 2)) { const [a, b] = s === 0 ? [l, r] : [r, l]; c += Math.max(0, wld[t][b][2] - wld[t][a][2] + 0.02); }
    return c;
  };
  const F = [];
  for (let t = 0; t < N; t++) F.push([feat(t, 0), feat(t, 1)]);
  const cost = [[80 * unary(0, 0), 80 * unary(0, 1)]], bp = [[0, 0]];
  for (let t = 1; t < N; t++) {
    cost.push([0, 0]); bp.push([0, 0]);
    for (const s of [0, 1]) {
      const c = [0, 1].map(p => {
        let d = 0; for (let k = 0; k < F[t][s].length; k++) d += Math.abs(F[t][s][k] - F[t - 1][p][k]);
        return cost[t - 1][p] + d * 0.25 * (500 / bh) + (s !== p ? 30 : 0);
      });
      const p = c[0] <= c[1] ? 0 : 1; cost[t][s] = c[p] + 80 * unary(t, s); bp[t][s] = p;
    }
  }
  const st = new Array(N); let s = cost[N - 1][0] <= cost[N - 1][1] ? 0 : 1;
  for (let t = N - 1; t >= 0; t--) { st[t] = s; s = bp[t][s]; }
  let swaps = 0;
  for (let t = 0; t < N; t++) if (st[t] === 1) {
    swaps++;
    for (const [l, r] of LEG) { [img[t][l], img[t][r]] = [img[t][r], img[t][l]]; [wld[t][l], wld[t][r]] = [wld[t][r], wld[t][l]]; }
  }
  return swaps;
}

/**
 * raw: { fps, w, h, img: N x 33 x [x_px, y_px, z, vis] (null frame = not detected), world: N x 33 x 3 }
 * dir: 'auto' | 'right' | 'left'
 * returns { fps, w, h, mirrored, P (analysis coords, smoothed), vis (N), detected, swaps }
 */
export function prepare(raw, dir = 'auto') {
  const N = raw.img.length;
  const img = raw.img.map(f => f ? f.map(p => [...p]) : Array.from({ length: 33 }, () => [NaN, NaN, NaN, 0]));
  const wld = raw.world.map(f => f ? f.map(p => [...p]) : Array.from({ length: 33 }, () => [NaN, NaN, NaN]));
  const detected = raw.img.filter(Boolean).length;
  if (detected < 10) throw new Error('nodetect');
  fillGaps(img, 3); fillGaps(wld, 3);
  // running direction: toe ahead of heel points the way the runner faces
  let mirrored;
  if (dir === 'auto') {
    const d = median(img.map(f => (f[31][0] - f[29][0]) + (f[32][0] - f[30][0])));
    mirrored = d < 0;
  } else mirrored = dir === 'left';
  if (mirrored) {
    // flip x so the runner moves toward +x, and swap labels so "R" stays the near-camera side
    for (const f of img) { for (const p of f) p[0] = raw.w - p[0]; for (const [a, b] of LR_PAIRS) [f[a], f[b]] = [f[b], f[a]]; }
    for (const f of wld) for (const [a, b] of LR_PAIRS) [f[a], f[b]] = [f[b], f[a]];
  }
  const swaps = fixLR(img, wld);
  const P = smooth(img.map(f => f.map(p => [p[0], p[1]])), raw.fps);
  const vis = img.map(f => mean([0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].map(j => f[j][3] || 0)));
  return { fps: raw.fps, w: raw.w, h: raw.h, mirrored, P, vis, detected, swaps };
}

/* ---------- gait events (Zeni 2008) ---------- */
export function eventsZeni(P, fps) {
  const hipx = P.map(f => (f[23][0] + f[24][0]) / 2);
  const bh = bodyH(P);
  const ev = [];
  for (const [s, J] of [['L', L], ['R', R]]) {
    const hs = P.map((f, i) => f[J.he][0] - hipx[i]), to = P.map((f, i) => -(f[J.to][0] - hipx[i]));
    for (const i of findPeaks(hs, Math.floor(0.45 * fps), 0.15 * bh)) ev.push([i, s, 'strike']);
    for (const i of findPeaks(to, Math.floor(0.45 * fps), 0.15 * bh)) ev.push([i, s, 'toeoff']);
  }
  const cmp = (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
  ev.sort(cmp);
  const out = [...ev];
  for (const [i, s, k] of ev) {
    if (k !== 'strike') continue;
    const J = s === 'L' ? L : R;
    const nxt = ev.filter(([j, s2, k2]) => s2 === s && k2 === 'toeoff' && j > i);
    if (!nxt.length || nxt[0][0] - i > fps * 0.5) continue;
    const j = nxt[0][0]; const d = []; for (let t = i; t <= j; t++) d.push(hipx[t] - P[t][J.an][0]);
    let cr = -1; for (let t = 0; t < d.length - 1; t++) if (d[t] < 0 && d[t + 1] >= 0) { cr = t; break; }
    out.push([i + (cr >= 0 ? cr + 1 : Math.floor((j - i) / 2)), s, 'mid']);
  }
  return out.sort(cmp);
}

/* ---------- most stable window (pick.py) ---------- */
// window of nw frames starting `lead` seconds before a near-side strike; prefers even
// step timing, steady body size (camera distance) and good landmark visibility
export function pickWindow(prep, nw, lead = 0.1667) {
  const { P, fps, vis } = prep; const N = P.length;
  if (N <= nw) return { start: 0, n: N };
  const ev = eventsZeni(P, fps), off = Math.round(lead * fps);
  const bh = P.map(f => hypot(f[0], mid(f[27], f[28])));
  let best = null;
  for (const [i, s, k] of ev) {
    if (s !== 'R' || k !== 'strike') continue;
    const a = i - off, b = a + nw; if (a < 0 || b > N) continue;
    const st = ev.filter(([j, , k2]) => k2 === 'strike' && j >= a && j < b).map(e => e[0]);
    if (st.length < 3) continue;
    const iv = st.slice(1).map((v, q) => (v - st[q]) / fps);
    const seg = bh.slice(a, b), mv = mean(vis.slice(a, b));
    const score = std(iv) * 1000 / 10 + std(seg) / mean(seg) * 100 + (mv < 0.85 ? 10 : 0);
    if (!best || score < best.score) best = { start: a, n: nw, score };
  }
  if (best) return best;
  // fallback: the middle of the clip
  return { start: Math.max(0, Math.floor((N - nw) / 2)), n: nw, fallback: true };
}

/* ---------- per-clip metrics (analyze.run) ---------- */
export function angles(P) {
  const out = {};
  for (const [s, J] of [['L', L], ['R', R]]) {
    out['knee_' + s] = P.map(f => ang3(f[J.hip], f[J.kn], f[J.an]));
    out['hip_' + s] = P.map(f => ang3(f[J.sh], f[J.hip], f[J.kn]));
    out['elbow_' + s] = P.map(f => ang3(f[J.sh], f[J.el], f[J.wr]));
    out['ankle_' + s] = P.map(f => ang3(f[J.kn], f[J.an], f[J.to]));
  }
  out.trunk = P.map(f => lean(mid(f[23], f[24]), mid(f[11], f[12])));
  return out;
}

export function analyze(prep, start = 0, n = null) {
  const fps = prep.fps;
  const P = prep.P.slice(start, n == null ? undefined : start + n);
  const N = P.length;
  const ev = eventsZeni(P, fps), A = angles(P);
  const hipm = P.map(f => mid(f[23], f[24])), shm = P.map(f => mid(f[11], f[12]));
  const leg = median([...P.map(f => hypot(f[23], f[27])), ...P.map(f => hypot(f[24], f[28]))]);
  const trunkL = median(P.map((f, i) => hypot(shm[i], hipm[i])));
  const J = { L, R };
  const strikes = ev.filter(e => e[2] === 'strike'), toeoffs = ev.filter(e => e[2] === 'toeoff'), mids = ev.filter(e => e[2] === 'mid');
  const st = strikes.map(([i, s]) => {
    const j = J[s], an = P[i][j.an], kn = P[i][j.kn], he = P[i][j.he], to = P[i][j.to];
    const nxt = toeoffs.filter(([t, s2]) => s2 === s && t > i);
    const alpha = deg(Math.atan2(he[1] - to[1], to[0] - he[0]));
    return {
      f: i, t: +(i / fps).toFixed(3), side: s,
      reach: (an[0] - hipm[i][0]) / leg * 100,
      shin: deg(Math.atan2(an[0] - kn[0], an[1] - kn[1])),
      knee: A['knee_' + s][i], alpha,
      strike: alpha > 8 ? '腳跟' : (alpha < -1.6 ? '前腳掌' : '中足'),
      contact: nxt.length && nxt[0][0] - i < fps * 0.6 ? (nxt[0][0] - i) / fps * 1000 : null,
    };
  });
  const ms = mids.map(([i, s]) => {
    const an = P[i][J[s].an];
    const phi = lean(an, shm[i]), phiLeg = lean(an, hipm[i]), tr = lean(hipm[i], shm[i]);
    return { f: i, t: +(i / fps).toFixed(3), side: s, phi, phi_leg: phiLeg, phi_trunk: tr, bend: tr - phiLeg, head: (P[i][8][0] - P[i][12][0]) / trunkL * 100 };
  });
  // shoulder-ear distance along the trunk axis (near side), per frame
  const se = P.map((f, i) => {
    const ax = [shm[i][0] - hipm[i][0], shm[i][1] - hipm[i][1]], nrm = Math.hypot(...ax);
    return ((f[8][0] - f[12][0]) * ax[0] + (f[8][1] - f[12][1]) * ax[1]) / nrm / trunkL;
  });
  const sint = strikes.slice(1).map((e, q) => e[0] - strikes[q][0]);
  const cad = sint.length ? 60 / (mean(sint) / fps) : null;
  // gait-cycle curves (near strike -> near strike), 0..100 %
  const rs = strikes.filter(e => e[1] === 'R').map(e => e[0]), curves = {};
  for (const key of ['knee_R', 'hip_R', 'elbow_R', 'ankle_R', 'knee_L', 'trunk']) {
    const cyc = [];
    for (let q = 0; q < rs.length - 1; q++) {
      const a = rs[q], b = rs[q + 1];
      const xs = Array.from({ length: b - a + 1 }, (_, i) => i / (b - a));
      cyc.push(interp(Array.from({ length: 51 }, (_, i) => i / 50), xs, A[key].slice(a, b + 1)));
    }
    curves[key] = cyc.length ? cyc[0].map((_, i) => +(mean(cyc.map(c => c[i]))).toFixed(1)) : [];
  }
  const m = v => v.length ? mean(v) : null;
  const side = (lst, s, k) => lst.filter(x => x.side === s && x[k] != null).map(x => x[k]);
  const all = (lst, k) => lst.filter(x => x[k] != null).map(x => x[k]);
  const half = Math.floor(N / 2);
  const summary = {
    cadence: cad, step_ms: sint.length ? mean(sint) / fps * 1000 : null,
    reach: m(all(st, 'reach')), reach_L: m(side(st, 'L', 'reach')), reach_R: m(side(st, 'R', 'reach')),
    shin: m(all(st, 'shin')), knee_strike: m(all(st, 'knee')),
    alpha: m(all(st, 'alpha')), alpha_L: m(side(st, 'L', 'alpha')), alpha_R: m(side(st, 'R', 'alpha')),
    contact: m(all(st, 'contact')), contact_L: m(side(st, 'L', 'contact')), contact_R: m(side(st, 'R', 'contact')),
    strike_mix: Object.fromEntries(['腳跟', '中足', '前腳掌'].map(k => [k, st.filter(x => x.strike === k).length])),
    phi: m(all(ms, 'phi')), phi_leg: m(all(ms, 'phi_leg')), phi_trunk: m(all(ms, 'phi_trunk')),
    bend: m(all(ms, 'bend')), head: m(all(ms, 'head')),
    se: median(se), se_first: median(se.slice(0, half)), se_second: median(se.slice(half)),
    elbow_med: median(A.elbow_R), elbow_min: percentile(A.elbow_R, 5), elbow_max: percentile(A.elbow_R, 95),
    elbowL_med: median(A.elbow_L),
    knee_max_flex: Math.min(...A.knee_R), trunk_mean: mean(A.trunk),
  };
  return {
    fps, n: N, dur: N / fps, start, leg_px: leg, trunk_px: trunkL,
    events: ev.map(([f, s, k]) => ({ f, s, k })), strikes: st, mids: ms, summary, curves,
    frame_angles: A, se, pts: P,
  };
}

// analysis coords -> original image coords (undo the mirror; labels stay near = R)
export function toImage(prep, P) {
  return prep.mirrored ? P.map(f => f.map(p => [prep.w - p[0], p[1]])) : P;
}
