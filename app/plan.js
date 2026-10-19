// 12-week half marathon plan (課表 from Chun's screenshot). Race on 20/12/2026, a Sunday.
// km = running distance of each session; walking recoveries (400m 行) are not counted.

const COLS = ['二：EASY', '四：配速', '六/日：EASY', '日/六：LONG'];

const WEEKS = [
  ['W1', [['5K', 5], ['1K 慢熱 + 4×(1K 快@6:30 + 400m 行)', 5], ['5K', 5], ['8K', 8]]],
  ['W2', [['5K', 5], ['6K Tempo @7:00', 6], ['5K', 5], ['10K', 10]]],
  ['W3', [['6K', 6], ['1K 慢熱 + 5×(1K 快 + 400m 行)', 6], ['5K', 5], ['11K', 11]]],
  ['W4', [['5K', 5], ['6K Tempo', 6], ['5K', 5], ['12K（減量週）', 12]], 'down'],
  ['W5', [['6K', 6], ['7K Tempo', 7], ['6K', 6], ['14K', 14]]],
  ['W6', [['6K', 6], ['6×(1K 快 + 400m 行)', 6], ['6K', 6], ['15K', 15]]],
  ['W7', [['6K', 6], ['8K Tempo', 8], ['6K', 6], ['16K', 16]]],
  ['W8', [['6K', 6], ['6×(1K 快 + 400m 行)', 6], ['5K', 5], ['12K（減量週）', 12]], 'down'],
  ['W9', [['6K', 6], ['8K Tempo', 8], ['6K', 6], ['18K', 18]]],
  ['W10', [['6K', 6], ['5K @目標配速 7:06 + 3K Easy', 8], ['6K', 6], ['19K（最長）', 19]]],
  ['W11', [['6K', 6], ['6K Tempo', 6], ['5K', 5], ['14K', 14]]],
  ['W12 比賽週', [['4K Easy', 4], ['3K Easy + 3×100m 加速', 3.3], ['休息', 0], ['20/12 比賽 21.1K', 21.1]], 'race'],
];

// W1 starts Monday 28/9 (Chun: 19/10 week is W4); W12 race week ends on race day 20/12.
// Dates are built from day numbers so DST changes can't shift a week boundary.
const day = n => new Date(2026, 8, 28 + n);  // n days after W1's Monday
const fmt = d => `${d.getDate()}/${d.getMonth() + 1}`;
const km = n => (Number.isInteger(n) ? n : n.toFixed(1)) + ' km';

const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const isNow = n => today >= day(n) && today < day(n + 7);
const range = n => `${fmt(day(n))}–${fmt(day(n + 6))}`;

const row = ([wk, cells, kind], n) => {
  const total = cells.reduce((s, c) => s + c[1], 0);
  const cls = [kind, isNow(n) ? 'now' : ''].filter(Boolean).join(' ');
  return `<tr${cls ? ` class="${cls}"` : ''}>
    <th scope="row"><b>${wk}</b>${isNow(n) ? '<span class="tag">本週</span>' : ''}<small class="num">${range(n)}</small></th>
    ${cells.map((c, j) => `<td data-l="${COLS[j]}">${c[0]}</td>`).join('')}
    <td data-l="總跑量" class="v">${km(total)}</td>
  </tr>`;
};
const rows = WEEKS.map((w, i) => row(w, i * 7)).join('');

const all = WEEKS.reduce((s, w) => s + w[1].reduce((t, c) => t + c[1], 0), 0);

document.getElementById('plan').innerHTML = `
  <table>
    <thead><tr><th>週數</th>${COLS.map(c => `<th>${c}</th>`).join('')}<th>總跑量</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
document.getElementById('plansum').textContent =
  `12 週合共約 ${km(all)}（只計跑步距離，400m 行唔計）。`;
