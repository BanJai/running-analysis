// Turns the two clips' metrics into the four tabs: verdict, table, what's good, what to fix.
// Thresholds follow running_analysis_prompt_4tabs.md (reference starting values, not medical norms).
export const LV = { good: '做得好', warn: '留意', bad: '要改' };

const ok = v => v != null && isFinite(v);
const f0 = v => ok(v) ? Math.round(v).toString() : '–';
const f1 = v => ok(v) ? (Math.round(v * 10) / 10).toFixed(1) : '–';
const f2 = v => ok(v) ? v.toFixed(2) : '–';
const signed = v => ok(v) ? (v > 0 ? '+' : '') + f1(v) : '–';
const asym = (a, b) => ok(a) && ok(b) && (a + b) !== 0 ? Math.abs(a - b) / Math.abs((a + b) / 2) * 100 : 0;
const mixTxt = m => `腳跟 ${m['腳跟']}・中足 ${m['中足']}・前腳掌 ${m['前腳掌']}`;
const dominant = m => Object.entries(m).sort((a, b) => b[1] - a[1])[0][0];
// a problem counts as main when it shows in at least 3 steps and 40 % of them
const mainIssue = (bad, n) => bad >= 3 && n > 0 && bad / n >= 0.4;

export function buildTabs(U, S, nm) {
  const Su = U.summary, Ss = S.summary;
  const near = nm.R + '腳', far = nm.L + '腳';
  const nSt = U.strikes.length;

  /* 1. foot strike position */
  const t1 = (() => {
    const over = U.strikes.filter(x => x.reach > 35).length;
    const good = [], fix = [];
    let level = 'good', head;
    if (mainIssue(over, nSt)) { level = 'bad'; head = '落地點太前，有跨大步傾向'; }
    else if (Su.reach > 20 || over > 0) { level = 'warn'; head = '落地點略為偏前'; }
    else head = '落地點喺身體下面附近，冇跨大步';
    if (ok(Su.reach) && ok(Ss.reach)) head += Math.abs(Su.reach - Ss.reach) <= 5 ? '，同標準片差唔多' : (Su.reach < Ss.reach ? '，仲近過標準片' : '，比標準片前');
    if (ok(Su.knee_strike)) {
      if (Su.knee_strike > 178) fix.push(`落地時膝蓋差唔多伸直（${f0(Su.knee_strike)}°），容易將衝擊傳去膝頭，落地時留少少屈曲。`);
      else if (Su.knee_strike >= 155) good.push(`落地時膝蓋有微曲（${f0(Su.knee_strike)}°），冇鎖死。`);
    }
    if (ok(Su.shin)) {
      if (Su.shin > 15) fix.push(`落地時小腿向前伸（${signed(Su.shin)}°），即係隻腳伸出去先落地。`);
      else if (Su.shin <= 8) good.push(`小腿落地時接近垂直（${signed(Su.shin)}°）` + (ok(Ss.shin) && Su.shin < Ss.shin ? '，比標準片仲直。' : '。'));
    }
    if (ok(Su.cadence) && ok(Ss.cadence)) {
      if (Su.cadence < Ss.cadence - 4) { fix.push(`步頻 ${f0(Su.cadence)} 對比標準片 ${f0(Ss.cadence)}，可以試吓提高 5%（約 ${f0(Su.cadence * 1.05)} 步/分），步頻高啲落地點自然會收返入身體下面。`); if (level === 'good') level = 'warn'; }
      else if (Su.cadence >= Ss.cadence - 4) good.push(`步頻 ${f0(Su.cadence)} 步/分，同標準片（${f0(Ss.cadence)}）相若或者更高。`);
    }
    if (ok(Su.reach_L) && ok(Su.reach_R) && Math.abs(Su.reach_L - Su.reach_R) > 5) {
      const fwd = Su.reach_R > Su.reach_L ? [near, far, Su.reach_R, Su.reach_L] : [far, near, Su.reach_L, Su.reach_R];
      fix.push(`${fwd[0]}落地點比${fwd[1]}前（${f0(fwd[2])}% vs ${f0(fwd[3])}%），留意${fwd[0]}落地時「收返入身體下面」。`);
      if (level === 'good') level = 'warn';
    } else if (ok(Su.reach_L) && ok(Su.reach_R)) good.push('左右腳落地位置好平均。');
    if (level === 'bad') fix.unshift(`有 ${over} / ${nSt} 步落地點離髖部超過腿長 35%，落地時會有煞車力。改法優先提高步頻 5–10%，唔好刻意縮步。`);
    if (!fix.length) fix.push('暫時唔使改，保持呢個落地位置。');
    if (!good.length) good.push(`落地點平均離髖部 ${f0(Su.reach)}% 腿長（標準片 ${f0(Ss.reach)}%）。`);
    return {
      id: 'strike-pos', name: '腳掌著地位置', goal: '避免跨大步：腳盡量喺髖部正下方落地', level, head, good, fix,
      rows: [
        ['落地點離髖部（÷腿長）', f0(Su.reach) + '%', f0(Ss.reach) + '%', '< 20% 理想，> 35% 算跨步太大'],
        ['　左腳／右腳', side2(Su.reach_L, Su.reach_R, nm, v => f0(v) + '%'), f0(Ss.reach_L) + '% / ' + f0(Ss.reach_R) + '%', '左右差 ≤ 5% 正常'],
        ['落地時小腿角', signed(Su.shin) + '°', signed(Ss.shin) + '°', '0–8°（小腿接近垂直），> 15° 算腳向前伸'],
        ['落地時膝角', f0(Su.knee_strike) + '°', f0(Ss.knee_strike) + '°', '160–175°，> 178° 算膝蓋鎖死'],
        ['步頻', f0(Su.cadence) + ' 步/分', f0(Ss.cadence) + ' 步/分', '休閒跑 160–190，只作比較'],
      ],
      drill: '節拍器設高過而家步頻 5%，跑 3 × 2 分鐘，中間慢跑 1 分鐘。',
      metric: 'reach', mlabel: '每步落地點離髖部（%腿長）', mref: [0, 20], freeze: { kind: 'strike', label: `定格：${near}落地` },
    };
  })();

  /* 2. strike type */
  const t2 = (() => {
    const heel = Su.strike_mix['腳跟'], frac = nSt ? heel / nSt : 0;
    const dom = dominant(Su.strike_mix), sdom = dominant(Ss.strike_mix);
    let level = 'good';
    if (frac >= 0.4 && heel >= 2) level = t1.level === 'good' ? 'warn' : 'bad';
    const head = `以${dom}著地為主` + (dom === sdom ? `，同標準片一樣` : `（標準片以${sdom}為主）`);
    const good = [], fix = [];
    if (dom !== '腳跟') good.push(`大部分步都係${dom}著地，符合建議。`);
    else if (sdom === '腳跟') good.push('著地分類同標準片一樣，都係腳跟先著地為主。');
    if (asym(Su.contact_L, Su.contact_R) <= 8 && ok(Su.contact_L) && ok(Su.contact_R)) good.push(`左右腳觸地時間接近（${f0(Su.contact_L)} / ${f0(Su.contact_R)} ms）。`);
    if (level === 'bad') fix.push('腳跟著地加上落地點偏前，落地時煞車力較大。先將落地點收返身體下面（分頁 1），著地方式通常會跟住改善。');
    else if (level === 'warn') fix.push('腳跟著地本身唔一定係問題，落地位置又合格，唔使硬改；保持落地點喺身體下面就得。');
    if (ok(Su.alpha) && ok(Ss.alpha) && Su.alpha > Ss.alpha + 3) fix.push(`腳掌角大過標準片約 ${f0(Su.alpha - Ss.alpha)}°，即係腳尖翹高啲先落地。`);
    if (asym(Su.contact_L, Su.contact_R) > 8) fix.push(`左右腳觸地時間有差（${nm.L} ${f0(Su.contact_L)} / ${nm.R} ${f0(Su.contact_R)} ms），可能係一邊用力唔同，長段跑留意吓。`);
    if (!fix.length) fix.push('暫時唔使改。');
    if (!good.length) good.push(`落地腳掌角平均 ${signed(Su.alpha)}°（標準片 ${signed(Ss.alpha)}°）。`);
    return {
      id: 'strike-type', name: '著地方式', goal: '中足或前腳掌著地', level, head, good, fix,
      rows: [
        ['落地腳掌角 α（腳尖高為正）', signed(Su.alpha) + '°', signed(Ss.alpha) + '°', '> +8° 腳跟、−1.6~+8° 中足、< −1.6° 前腳掌'],
        ['　左腳／右腳', side2(Su.alpha_L, Su.alpha_R, nm, v => signed(v) + '°'), signed(Ss.alpha_L) + '° / ' + signed(Ss.alpha_R) + '°', ''],
        ['著地方式分佈（步數）', mixTxt(Su.strike_mix), mixTxt(Ss.strike_mix), '建議以中足／前腳掌為主'],
        ['觸地時間（參考）', f0(Su.contact) + ' ms', f0(Ss.contact) + ' ms', '慢跑約 220–300 ms，量法可能偏長'],
      ],
      drill: '原地輕跳 3 × 20 下，感受用前半腳掌落地；之後跑 30 秒試吓「無聲落地」。',
      metric: 'alpha', mlabel: '每步落地腳掌角 α（°）', mref: [-1.6, 8], freeze: { kind: 'strike', label: `定格：${near}落地` },
    };
  })();

  /* 3. slight forward lean */
  const t3 = (() => {
    let level = 'good', head;
    const good = [], fix = [];
    const phi = Su.phi, bend = Su.bend;
    if (!ok(phi)) { level = 'warn'; head = '搵唔到足夠嘅支撐中期去量前傾'; }
    else if (phi < 0) { level = 'bad'; head = '身體向後仰'; fix.push(`前傾角 ${signed(phi)}°，即係重心喺腳後面。試吓由腳踝成條身向前傾到 3–5°。`); }
    else if (ok(bend) && bend > 8) { level = 'bad'; head = '前傾係由腰折落去，唔係由腳踝前傾'; fix.push(`軀幹比下身多傾 ${f1(bend)}°，即係彎腰。收緊核心、挺胸，用成條身由腳踝前傾。`); }
    else if (phi > 12) { level = 'bad'; head = '前傾太多'; fix.push(`前傾角 ${signed(phi)}°，太前會增加腰背負擔，收返到 8° 以內。`); }
    else if (phi < 2) { level = 'warn'; head = '身體好直，前傾角偏細'; fix.push(`前傾角 ${signed(phi)}°，可以試吓由腳踝成條身向前多傾 2–3°（唔好彎腰）。` + (ok(Ss.phi) && Ss.phi < 3 ? `標準片都只係 ${signed(Ss.phi)}°，所以呢項只當「留意」。` : '')); }
    else head = '由腳踝微微前傾，角度合理';
    if (ok(Su.head) && Su.head > 20) { if (level === 'good') level = 'warn'; fix.push(`頭部向前探（${f0(Su.head)}% 軀幹長），眼望前面 10–20 米，下巴微收。`); }
    if (ok(phi) && phi >= 3 && phi <= 8) good.push(`前傾角 ${signed(phi)}° 喺合理範圍。`);
    if (ok(bend) && bend <= 5) good.push('冇由腰折落去，軀幹同下身大致成一直線。');
    if (ok(Su.head) && Su.head <= 10) good.push('頭部冇向前探。');
    if (!fix.length) fix.push('暫時唔使改。');
    if (!good.length) good.push(`軀幹角 ${signed(Su.phi_trunk)}°（標準片 ${signed(Ss.phi_trunk)}°）。`);
    return {
      id: 'lean', name: '微幅前傾', goal: '由腳踝微微向前傾，而唔係彎腰', level, head, good, fix,
      rows: [
        ['全身前傾角 φ（踝→肩）', signed(Su.phi) + '°', signed(Ss.phi) + '°', '3–8° 合理，< 2° 算太直，> 12° 算太前'],
        ['下身線（踝→髖）', signed(Su.phi_leg) + '°', signed(Ss.phi_leg) + '°', '只作描述'],
        ['軀幹角（髖→肩）', signed(Su.phi_trunk) + '°', signed(Ss.phi_trunk) + '°', '只作描述'],
        ['折腰差（軀幹 − 下身）', signed(Su.bend) + '°', signed(Ss.bend) + '°', '≤ 5° 合理，> 8° 算由腰折'],
        ['頭部前伸（÷軀幹長）', f0(Su.head) + '%', f0(Ss.head) + '%', '≤ 10% 合理，> 20% 算頭向前探'],
      ],
      drill: '靠牆前傾：身體一直線，由腳踝向前倒到就快跌先起步，做 10 次。',
      metric: 'phi', mlabel: '每次支撐中期前傾角 φ（°）', mref: [3, 8], list: 'mids', freeze: { kind: 'mid', label: `定格：${near}支撐中期` },
    };
  })();

  /* 4. relaxed shoulders */
  const t4 = (() => {
    const shrinking = ok(Su.se_first) && ok(Su.se_second) && Su.se_second < Su.se_first * 0.9;
    let level = 'good', head;
    const good = [], fix = [];
    if (Su.se < 0.15 && shrinking) { level = 'bad'; head = '有聳膊頭，而且越跑越聳'; }
    else if (Su.se < 0.17) { level = 'warn'; head = '肩膀有啲聳起'; }
    else if (shrinking) { level = 'warn'; head = '肩膀大致放鬆，但後段有少少縮起'; }
    else head = '肩膀放鬆' + (ok(Su.elbow_med) && Su.elbow_med >= 60 && Su.elbow_med <= 120 ? '，擺臂角度喺常見範圍' : '');
    if (level === 'good') good.push('肩耳距充足，冇聳肩跡象' + (shrinking ? '。' : '，前後段都一樣。'));
    if (ok(Su.elbow_med) && Su.elbow_med >= 70 && Su.elbow_med <= 110) good.push(`手肘屈 ${f0(Su.elbow_med)}° 左右，屬常見範圍（標準片 ${f0(Ss.elbow_med)}°）。`);
    if (level !== 'good') fix.push(`肩耳距 ${f2(Su.se)}（標準片 ${f2(Ss.se)}）。跑步時提自己「膊頭放落褲袋」，雙手輕握，好似揸住薯片咁。`);
    if (ok(Su.elbow_med) && (Su.elbow_med < 60 || Su.elbow_med > 120)) fix.push(`手肘角 ${f0(Su.elbow_med)}°，${Su.elbow_med < 60 ? '屈得好實，手臂容易繃緊' : '手臂太直，擺臂幫唔到推進'}，試吓保持 80–100°。`);
    if (!fix.length) fix.push('暫時唔使改。跑長距離時留意後段肩膀有冇慢慢縮起。');
    if (!good.length) good.push(`右肘角範圍 ${f0(Su.elbow_min)}–${f0(Su.elbow_max)}°。`);
    return {
      id: 'shoulder', name: '肩膀放鬆', goal: '肩膀自然沉，唔好聳膊頭', level, head, good, fix,
      rows: [
        ['肩耳距（÷軀幹長）', f2(Su.se), f2(Ss.se), '≥ 0.22 合理，< 0.17 算聳肩'],
        ['前半段／後半段', f2(Su.se_first) + ' / ' + f2(Su.se_second), f2(Ss.se_first) + ' / ' + f2(Ss.se_second), '後半縮短 > 10% 算越跑越聳'],
        ['近鏡肘角（中位數）', f0(Su.elbow_med) + '°', f0(Ss.elbow_med) + '°', '70–110° 常見'],
        ['近鏡肘角範圍', f0(Su.elbow_min) + '–' + f0(Su.elbow_max) + '°', f0(Ss.elbow_min) + '–' + f0(Ss.elbow_max) + '°', '只作描述'],
      ],
      drill: '跑前聳肩再放低 10 次；跑步時每分鐘提自己「膊頭放落褲袋」。',
      metric: null, freeze: { kind: 'strike', label: `定格：${near}落地` },
    };
  })();

  return [t1, t2, t3, t4];
}

// "left / right" cell, always in the runner's left-then-right order
function side2(vL, vR, nm, fmt) {
  // internal L/R are far/near; nm maps them to the runner's actual sides
  return nm.L === '左' ? `${fmt(vL)} / ${fmt(vR)}` : `${fmt(vR)} / ${fmt(vL)}`;
}
