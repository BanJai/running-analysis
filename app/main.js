// Page logic: upload -> in-browser pose detection -> analysis -> side-by-side loop with the
// standard clip, skeleton overlays and the four comparison tabs.
import { loadVideo, estimateFps, detectPoses } from './detect.js';
import { prepare, pickWindow, analyze, toImage } from './analysis.js';
import { buildTabs, LV } from './verdicts.js';

const $ = id => document.getElementById(id);
const f0 = v => v == null || !isFinite(v) ? '–' : Math.round(v).toString();
const f1 = v => v == null || !isFinite(v) ? '–' : (Math.round(v * 10) / 10).toFixed(1);
const signed = v => v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + f1(v);
const MAX_SPAN = 20;

/* ---------- standard clip (landmarks precomputed with the same detector) ---------- */
const stdReady = fetch('app/std/std_pose.json').then(r => r.json()).then(raw => {
  const prep = prepare(raw, 'right');
  const an = analyze(prep);
  return { raw, prep, an, pts: toImage(prep, an.pts), names: { R: '右', L: '左' }, t0: 0 };
});

/* ---------- upload ---------- */
let busy = null, objUrl = null;
const drop = $('drop');
['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(e => drop.addEventListener(e, () => drop.classList.remove('over')));
drop.addEventListener('drop', ev => { ev.preventDefault(); const f = ev.dataTransfer.files[0]; if (f) run(f); });
$('file').addEventListener('change', ev => { const f = ev.target.files[0]; if (f) run(f); ev.target.value = ''; });
$('cancel').onclick = () => busy?.abort();
$('again').onclick = () => { stopLoop(); $('results').hidden = true; $('upload').hidden = false; $('upload').scrollIntoView({ behavior: 'smooth' }); };

function showErr(msg) { const e = $('err'); e.textContent = msg; e.hidden = !msg; }
function progress(p, txt) { $('progbar').style.width = (p * 100).toFixed(1) + '%'; if (txt) $('progtxt').textContent = txt; }

async function run(file) {
  if (busy) return;
  showErr('');
  if (!file.type.startsWith('video/') && !/\.(mov|mp4|m4v|webm)$/i.test(file.name)) return showErr('請揀一個影片檔（MP4 或者 MOV）。');
  busy = new AbortController();
  $('prog').hidden = false; drop.style.pointerEvents = 'none'; progress(0, '載入影片…');
  if (objUrl) URL.revokeObjectURL(objUrl);
  objUrl = URL.createObjectURL(file);
  try {
    const S = await stdReady;
    let v;
    try { v = await loadVideo(objUrl); }
    catch (e) { throw new Error('呢個瀏覽器播唔到呢條片（例如部分 Windows 電腦唔支援 iPhone 嘅 HEVC 格式）。試吓用 Safari 或手機打開，或者先轉做 H.264 MP4。'); }
    const dur = v.duration;
    let t0 = Math.max(0, +$('t0').value || 0), t1 = Math.min(dur, +$('t1').value || dur);
    if (t1 - t0 > MAX_SPAN) t1 = t0 + MAX_SPAN;
    if (t1 - t0 < S.an.dur + 0.5) {
      if (dur < S.an.dur + 0.5) throw new Error(`條片太短（${dur.toFixed(1)} 秒），最少要有 3 秒連續跑步。`);
      throw new Error(`分析範圍太短（${(t1 - t0).toFixed(1)} 秒），請揀最少 3 秒。條片長 ${dur.toFixed(1)} 秒。`);
    }
    progress(0, '估計幀率…');
    const src = await estimateFps(v);
    const fs = src && src >= 50 ? 60 : src && src >= 20 ? Math.round(src) : 30;
    progress(0, '載入骨架模型（第一次會耐少少）…');
    const N = Math.floor((t1 - t0) * fs);
    const startT = performance.now();
    const raw = await detectPoses(v, {
      fs, t0, t1, model: $('model').value, signal: busy.signal,
      onProgress: p => {
        const done = Math.round(p * N), el = (performance.now() - startT) / 1000;
        const left = p > 0.03 ? Math.round(el / p * (1 - p)) : null;
        progress(p, `逐格搵關節：${done} / ${N} 格` + (left != null ? `，大約仲要 ${left} 秒` : ''));
      },
    });
    progress(1, '分析步態…');
    let prep;
    try { prep = prepare(raw, $('dir').value); }
    catch (e) { throw new Error('片入面搵唔到清楚嘅人形。請用正側面、成個人入鏡嘅片再試。'); }
    const nw = Math.round(S.an.dur * fs);
    const win = pickWindow(prep, nw);
    const U = analyze(prep, win.start, win.n);
    const full = analyze(prep);
    if (U.strikes.length < 2) throw new Error('搵唔到足夠嘅落地動作。請確認片入面係側面連續跑步，同埋分析範圍冇揀錯。');
    const user = {
      raw, prep, an: U, full, win, fs, srcFps: src,
      pts: toImage(prep, U.pts), names: prep.mirrored ? { R: '左', L: '右' } : { R: '右', L: '左' },
      t0: raw.t0 + win.start / fs + 0.002,
    };
    show(user, S, v);
  } catch (e) {
    if (e.message === 'abort') showErr('已取消。');
    else { console.error(e); showErr(e.message && !/^[a-z]+$/.test(e.message) ? e.message : '分析出錯，請換條片再試。'); }
  } finally {
    busy = null; $('prog').hidden = true; drop.style.pointerEvents = '';
  }
}

/* ---------- results ---------- */
let loop = null;
function stopLoop() { if (loop) cancelAnimationFrame(loop); loop = null; $('vu').pause(); $('vs').pause(); }

function show(user, S, probe) {
  const U = user.an, Su = U.summary, Ss = S.an.summary;
  $('upload').hidden = true; $('results').hidden = false;
  const vu = $('vu'), vs = $('vs');
  $('boxu').style.aspectRatio = `${user.raw.w} / ${user.raw.h}`;
  $('boxs').style.aspectRatio = `${S.raw.w} / ${S.raw.h}`;
  vu.src = objUrl;
  const dirTxt = user.prep.mirrored ? '向左跑，所以近鏡嗰邊係左邊' : '向右跑，近鏡嗰邊係右邊';
  $('clipnote').textContent = `你嘅片剪咗 ${user.t0.toFixed(2)}–${(user.t0 + U.dur).toFixed(2)} 秒（同標準片一樣長 ${S.an.dur.toFixed(2)} 秒），兩條片都由近鏡腳落地前 0.17 秒開始，所以會同步循環播放。` +
    `偵測到你${dirTxt}；骨架上橙色係近鏡嗰邊，藍色係遠嗰邊，黃色數字係關節角度。` +
    (user.win.fallback ? ' （搵唔到特別穩定嘅一段，用咗分析範圍中間嗰段。）' : '') +
    (user.prep.detected < user.raw.img.length * 0.8 ? ` 注意：只有 ${Math.round(user.prep.detected / user.raw.img.length * 100)}% 嘅格搵到人，結果可能唔準。` : '');

  const clips = [
    { v: vu, c: $('cu'), A: U, pts: user.pts, names: user.names, label: '你嘅片', t0: user.t0 },
    { v: vs, c: $('cs'), A: S.an, pts: S.pts, names: S.names, label: '標準片', t0: 0 },
  ];
  setupPlayer(clips, U.dur);

  // tabs + verdicts
  const TABS = buildTabs(U, S.an, user.names);
  window.__result = { win: user.win, t0: user.t0, fs: user.fs, mirrored: user.prep.mirrored, summary: Su, levels: TABS.map(t => t.level + ' ' + t.head) };
  renderTabs(TABS, clips, U, S.an, user.names);
  renderCurves(U, S.an);
  const F = user.full.summary, nSt = user.full.strikes.length;
  $('longnote').textContent = `核對：用成個分析範圍（${user.full.dur.toFixed(1)} 秒、${nSt} 次落地）再計一次，步頻 ${f0(F.cadence)}、落地前伸 ${f0(F.reach)}%、腳掌角 ${signed(F.alpha)}°、前傾 ${signed(F.phi)}°、肩耳距 ${F.se.toFixed(2)}。` +
    `取樣 ${user.fs} fps` + (user.srcFps ? `（原片約 ${Math.round(user.srcFps)} fps）` : '') + `，修正左右腳對調 ${user.prep.swaps} 格。`;
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- synced playback ---------- */
let freezeAt = () => {};
function setupPlayer(clips, len) {
  stopLoop();
  const [cu, cs] = clips, vu = cu.v, vs = cs.v;
  let rate = 1, skel = true, playing = true;
  const local = () => Math.min(len, Math.max(0, vu.currentTime - cu.t0));
  const setLabel = () => { const b = $('play'); b.textContent = playing ? '暫停' : '播放'; b.setAttribute('aria-pressed', playing ? 'false' : 'true'); };
  const seekBoth = t => { vu.currentTime = cu.t0 + t; vs.currentTime = Math.min(vs.duration || len, t); };
  const play = () => { playing = true; vu.playbackRate = vs.playbackRate = rate; vu.play().catch(() => {}); vs.play().catch(() => {}); setLabel(); };
  const pause = () => { playing = false; vu.pause(); vs.pause(); setLabel(); };
  $('play').onclick = () => playing ? pause() : play();
  document.querySelectorAll('.rate').forEach(b => b.onclick = () => {
    rate = +b.dataset.r; vu.playbackRate = vs.playbackRate = rate;
    document.querySelectorAll('.rate').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  });
  const step = d => { pause(); seekBoth(Math.min(len - 0.01, Math.max(0, local() + d / 30))); };
  $('step').onclick = () => step(1);
  $('prev').onclick = () => step(-1);
  $('skel').onclick = () => { skel = !skel; $('skel').setAttribute('aria-pressed', skel ? 'true' : 'false'); };
  freezeAt = (tu, ts) => {
    pause(); vu.currentTime = cu.t0 + tu; vs.currentTime = ts;
    document.querySelector('.stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const start = () => { seekBoth(0); play(); };
  if (vu.readyState >= 1) start(); else vu.addEventListener('loadedmetadata', start, { once: true });

  const tick = () => {
    if (playing && !vu.seeking) {
      if (vu.currentTime >= cu.t0 + len - 0.004 || vu.currentTime < cu.t0 - 0.05 || vu.ended) { seekBoth(0); if (vu.paused) vu.play().catch(() => {}); if (vs.paused) vs.play().catch(() => {}); }
      else if (!vs.seeking && Math.abs(vs.currentTime - local()) > 0.06) vs.currentTime = local();
    }
    $('tu').textContent = local().toFixed(2) + 's';
    $('ts').textContent = vs.currentTime.toFixed(2) + 's';
    $('bar').style.width = (local() / len * 100) + '%';
    for (const c of clips) draw(c, c === cu ? local() : vs.currentTime, skel);
    loop = requestAnimationFrame(tick);
  };
  loop = requestAnimationFrame(tick);
}

/* ---------- skeleton overlay (same look as the earlier overlay videos) ---------- */
const NEAR = '#ff8c28', FAR = '#50c8ff', MIDC = 'rgba(255,255,255,.86)', YEL = '#ffe600';
const LIMBS = { R: [[12, 14], [14, 16], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]], L: [[11, 13], [13, 15], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31]] };
const EVN = { strike: '落地', toeoff: '離地', mid: '支撐中期' };

function draw(c, t, skel) {
  const cv = c.c, box = cv.parentElement, dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(box.clientWidth * dpr), H = Math.round(box.clientHeight * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d'); g.clearRect(0, 0, W, H);
  const A = c.A, n = A.n; if (!n) return;
  const vw = c.v.videoWidth || W, vh = c.v.videoHeight || H;
  const k = Math.min(W / vw, H / vh), ox = (W - vw * k) / 2, oy = (H - vh * k) / 2;
  const s = W / 540; // UI scale relative to the 540 px wide overlay videos
  const fr = Math.min(n - 1, Math.max(0, t * A.fps)), i0 = Math.floor(fr), i1 = Math.min(n - 1, i0 + 1), a = fr - i0, ni = Math.round(fr);
  // landmarks are in the video's own pixel size, so the same contain-fit maps them onto the canvas
  const P = j => [ox + (c.pts[i0][j][0] * (1 - a) + c.pts[i1][j][0] * a) * k, oy + (c.pts[i0][j][1] * (1 - a) + c.pts[i1][j][1] * a) * k];
  const FA = A.frame_angles;
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (skel) {
    const line = (p, q, col, w) => { g.strokeStyle = col; g.lineWidth = w * s; g.beginPath(); g.moveTo(...p); g.lineTo(...q); g.stroke(); };
    for (const [x, y] of LIMBS.L) line(P(x), P(y), FAR, 5);
    line(P(11), P(12), MIDC, 4); line(P(23), P(24), MIDC, 4);
    const sh = [(P(11)[0] + P(12)[0]) / 2, (P(11)[1] + P(12)[1]) / 2], hp = [(P(23)[0] + P(24)[0]) / 2, (P(23)[1] + P(24)[1]) / 2];
    line(hp, sh, MIDC, 3);
    for (const [x, y] of LIMBS.R) line(P(x), P(y), NEAR, 7);
    const dot = (j, col, r, ol) => { const p = P(j); g.fillStyle = col; g.beginPath(); g.arc(p[0], p[1], r * s, 0, 7); g.fill(); if (ol) { g.strokeStyle = '#000'; g.lineWidth = 1.2 * s; g.stroke(); } };
    for (const j of [11, 13, 15, 23, 25, 27]) dot(j, FAR, 5);
    for (const j of [12, 14, 16, 24, 26, 28]) dot(j, NEAR, 7, true);
    const arc = (cj, aj, bj, r) => {
      const C = P(cj), Pa = P(aj), Pb = P(bj);
      let a1 = Math.atan2(Pa[1] - C[1], Pa[0] - C[0]), a2 = Math.atan2(Pb[1] - C[1], Pb[0] - C[0]);
      let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      g.strokeStyle = YEL; g.lineWidth = 3 * s; g.beginPath(); g.arc(C[0], C[1], r * s, a1, a1 + d, d < 0); g.stroke();
    };
    arc(26, 24, 28, 24); arc(14, 12, 16, 20); arc(24, 12, 26, 26);
    const nm = c.names;
    tag(g, P(26), 16, -14, `膝 ${f0(FA.knee_R[ni])}°`, YEL, 22, s);
    tag(g, P(24), 18, -10, `髖 ${f0(FA.hip_R[ni])}°`, YEL, 22, s);
    tag(g, P(14), 14, -6, `肘 ${f0(FA.elbow_R[ni])}°`, YEL, 22, s);
    tag(g, P(28), 14, -34, `踝 ${f0(FA.ankle_R[ni])}°`, YEL, 18, s);
    tag(g, P(25), -96, -10, `${nm.L}膝 ${f0(FA.knee_L[ni])}°`, FAR, 18, s);
  }
  // HUD
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, W, 64 * s);
  g.fillStyle = '#fff'; g.font = `600 ${20 * s}px "Noto Sans HK",sans-serif`; g.textBaseline = 'top';
  g.fillText(`${t.toFixed(2)}s  軀幹前傾 ${signed(FA.trunk[ni])}°`, 12 * s, 10 * s);
  const evs = A.events.filter(e => ni >= e.f && ni < e.f + Math.max(1, Math.round(A.fps * 0.12))).map(e => c.names[e.s] + '腳' + EVN[e.k]);
  if (evs.length) { g.fillStyle = '#ff5a5a'; g.font = `700 ${18 * s}px "Noto Sans HK",sans-serif`; g.fillText(evs.join('  '), 12 * s, 38 * s); }
}
function tag(g, p, dx, dy, txt, col, size, s) {
  g.font = `600 ${size * s}px "Noto Sans HK",sans-serif`; g.textBaseline = 'top';
  const x = p[0] + dx * s, y = p[1] + dy * s, w = g.measureText(txt).width;
  g.fillStyle = 'rgba(0,0,0,.66)'; g.beginPath(); g.roundRect ? g.roundRect(x - 4 * s, y - 3 * s, w + 8 * s, size * s + 6 * s, 5 * s) : g.rect(x - 4 * s, y - 3 * s, w + 8 * s, size * s + 6 * s); g.fill();
  g.fillStyle = col; g.fillText(txt, x, y);
}

/* ---------- tabs ---------- */
function stripSVG(t, U, S, nm) {
  const list = t.list || 'strikes', key = t.metric;
  const A = U[list].filter(x => x[key] != null), B = S[list].filter(x => x[key] != null);
  const a = A.map(x => x[key]), b = B.map(x => x[key]);
  if (!a.length && !b.length) return '<p class="note">冇足夠數據。</p>';
  const all = a.concat(b, t.mref); const lo = Math.floor(Math.min(...all) - 3), hi = Math.ceil(Math.max(...all) + 3);
  const W = 460, H = 150, L = 36, R = 10, T = 12, Bm = 26;
  const n = Math.max(a.length, b.length);
  const x = i => L + (i + 0.5) * (W - L - R) / n, y = v => T + (hi - v) / (hi - lo) * (H - T - Bm);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${t.mlabel}">`;
  s += `<rect x="${L}" y="${y(t.mref[1])}" width="${W - L - R}" height="${y(t.mref[0]) - y(t.mref[1])}" fill="var(--good)" opacity=".12"/>`;
  const step = (hi - lo) > 30 ? 10 : 5;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) s += `<line class="ax" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  for (let i = 0; i < n; i++) { const e = A[i] ? [A[i], nm] : [B[i], { R: '右', L: '左' }]; s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${e[1][e[0].side]}</text>`; }
  const dots = (arr, col, dx) => arr.map((v, i) => `<circle cx="${x(i) + dx}" cy="${y(v)}" r="5" fill="${col}"><title>${v.toFixed(1)}</title></circle>`).join('');
  return s + dots(b, 'var(--std)', 5) + dots(a, 'var(--me)', -5) + '</svg>';
}

function renderTabs(TABS, clips, U, S, nm) {
  const pane = $('pane');
  const renderPane = t => {
    const tb = t.rows.map(r => `<tr><td>${r[0]}</td><td class="v me">${r[1]}</td><td class="v st">${r[2]}</td><td class="ref">${r[3]}</td></tr>`).join('');
    pane.innerHTML = `
      <div class="lead"><span class="pill ${t.level}">${LV[t.level]}</span><h2>${t.head}</h2><p class="std">標準：${t.goal}</p></div>
      <div class="tblwrap"><table><thead><tr><th>指標</th><th>你嘅片</th><th>標準片</th><th>參考範圍</th></tr></thead><tbody>${tb}</tbody></table></div>
      <div class="two">
        ${t.metric ? `<div class="box"><h3>${t.mlabel} <small>綠色帶＝參考範圍</small></h3>${stripSVG(t, U, S, nm)}<div class="legend"><span><i style="background:var(--me)"></i>你嘅片</span><span><i style="background:var(--std)"></i>標準片</span></div></div>` : ''}
        <div class="box">
          <h3>做得好</h3><ul>${t.good.map(x => `<li>${x}</li>`).join('')}</ul>
          <h3>可以改善</h3><ul>${t.fix.map(x => `<li>${x}</li>`).join('')}</ul>
          <h3>小練習</h3><p>${t.drill}</p>
          <div><button class="frz" type="button">${t.freeze.label}</button></div>
        </div>
      </div>`;
    pane.querySelector('.frz').onclick = () => {
      const list = t.freeze.kind === 'mid' ? 'mids' : 'strikes';
      const pick = C => { const xs = C[list].filter(x => x.side === 'R'); return xs[Math.min(1, xs.length - 1)] || C[list][0]; };
      const a = pick(U), b = pick(S); if (!a || !b) return;
      freezeAt(a.f / U.fps, b.f / S.fps + 0.001);
    };
  };
  const select = id => {
    const t = TABS.find(x => x.id === id) || TABS[0];
    document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === t.id ? 'true' : 'false'));
    renderPane(t);
    try { localStorage.setItem('tab', t.id); } catch (e) {}
  };
  $('tabs').innerHTML = TABS.map((t, i) => `<button role="tab" type="button" data-id="${t.id}">${i + 1}. ${t.name}</button>`).join('');
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => select(b.dataset.id));
  $('verdicts').innerHTML = TABS.map((t, i) => `<button class="vcard" type="button" data-id="${t.id}"><small>分頁 ${i + 1}</small><span class="t">${t.name}</span><span class="pill ${t.level}">${LV[t.level]}</span></button>`).join('');
  document.querySelectorAll('.vcard').forEach(b => b.onclick = () => { select(b.dataset.id); $('tabs').scrollIntoView({ behavior: 'smooth' }); });
  let start = null; try { start = localStorage.getItem('tab'); } catch (e) {}
  select(start || TABS[0].id);
}

/* ---------- gait-cycle curves ---------- */
function renderCurves(U, S) {
  const CUR = [['knee_R', '近鏡膝角', '°，180 = 伸直'], ['hip_R', '近鏡髖角（肩-髖-膝）', '°'], ['elbow_R', '近鏡肘角', '°'], ['trunk', '軀幹前傾', '°，正數 = 向前']];
  $('curves').innerHTML = CUR.map(([k, name, unit]) => {
    const a = U.curves[k], b = S.curves[k];
    if (!a.length || !b.length) return `<div class="box"><h3>${name}</h3><p class="note">片段入面唔夠一個完整步態週期。</p></div>`;
    const all = a.concat(b); const lo = Math.floor(Math.min(...all) / 5) * 5 - 5, hi = Math.ceil(Math.max(...all) / 5) * 5 + 5;
    const W = 460, H = 180, L = 36, R = 22, T = 10, B = 24;
    const x = i => L + i / 50 * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const step = (hi - lo) > 60 ? 20 : (hi - lo) > 24 ? 10 : 5;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${name}">`;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) s += `<line class="ax" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    [0, 25, 50, 75, 100].forEach(p => s += `<text x="${x(p / 2)}" y="${H - 6}" text-anchor="middle">${p}%</text>`);
    const path = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    s += `<path d="${path(b)}" fill="none" stroke="var(--std)" stroke-width="2.5"/><path d="${path(a)}" fill="none" stroke="var(--me)" stroke-width="2.5"/></svg>`;
    return `<div class="box"><h3>${name} <small>${unit}</small></h3>${s}</div>`;
  }).join('');
}

// for automated checks
window.__runFile = run;
