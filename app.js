'use strict';

const STORAGE_KEY = 'datsumou-calendar-v1';
const SIDE_LABEL = { L: '左', R: '右', B: '両', N: '' };

const DEFAULT_PARTS = [
  ['顔', [['額', false], ['頬', true], ['鼻下', false], ['あご', false], ['もみあげ', true]]],
  ['首・肩', [['首', false], ['うなじ', false], ['肩', true]]],
  ['腕', [['ワキ', true], ['ひじ上', true], ['ひじ下', true], ['手の甲・指', true]]],
  ['体', [['胸', false], ['お腹', false], ['背中上', false], ['背中下', false], ['腰', false]]],
  ['VIO', [['V', false], ['I', false], ['O', false]]],
  ['脚', [['お尻', true], ['太もも', true], ['ひざ', true], ['ひざ下', true], ['足の甲・指', true]]],
];

// ---------- 状態 ----------

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultState() {
  const parts = [];
  for (const [group, items] of DEFAULT_PARTS) {
    for (const [name, paired] of items) parts.push({ id: uid(), name, group, paired, archived: false });
  }
  return { version: 2, intervalDays: 14, parts, records: [] };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.parts) && Array.isArray(s.records)) return migrate(s);
    }
  } catch (e) {
    console.warn('データの読み込みに失敗しました', e);
  }
  return defaultState();
}

// v1（サロン向け）→ v2（家庭用脱毛器向け）
function migrate(s) {
  if ((s.version || 1) < 2) {
    if (s.intervalDays === 56) s.intervalDays = 14;
    for (const r of s.records) {
      if (r.place && !r.device) r.device = r.place;
      delete r.place;
    }
    s.version = 2;
  }
  return s;
}

let state = loadState();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('保存に失敗しました: ' + e.message);
  }
}

const partById = id => state.parts.find(p => p.id === id);

// ---------- 日付ユーティリティ ----------

const pad = n => String(n).padStart(2, '0');
const toKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}
function diffDays(a, b) {
  return Math.round((fromKey(b) - fromKey(a)) / 86400000);
}
function formatJP(key) {
  const d = fromKey(key);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${'日月火水木金土'[d.getDay()]})`;
}
const todayKey = () => toKey(new Date());

// ---------- 表示ヘルパー ----------

const $ = sel => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return node;
}

function itemChip(item, withLevel = false) {
  const part = partById(item.partId);
  const name = part ? part.name : '(不明な部位)';
  return el('span', { class: `chip ${item.side}` },
    item.side !== 'N' ? el('span', { class: 'side' }, SIDE_LABEL[item.side]) : null,
    name,
    withLevel && item.level ? el('span', { class: 'lv' }, ` Lv${item.level}`) : null);
}

function recordsOn(key) {
  return state.records.filter(r => r.date === key);
}

// 表示順を部位リストの順にそろえる
function sortItems(items) {
  const order = new Map(state.parts.map((p, i) => [p.id, i]));
  return [...items].sort((a, b) => (order.get(a.partId) ?? 1e9) - (order.get(b.partId) ?? 1e9));
}

// ---------- カレンダー ----------

let viewYear, viewMonth; // viewMonth: 0-11
{
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
}

function renderCalendar() {
  $('#month-label').textContent = `${viewYear}年 ${viewMonth + 1}月`;
  const grid = $('#calendar-grid');
  grid.replaceChildren();

  const first = new Date(viewYear, viewMonth, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const today = todayKey();

  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (i >= 35 && d.getMonth() !== viewMonth) break; // 6週目が不要なら省略
    const key = toKey(d);
    const recs = recordsOn(key);
    const items = sortItems(recs.flatMap(r => r.items));

    const cls = ['day'];
    if (d.getMonth() !== viewMonth) cls.push('other');
    if (key === today) cls.push('today');
    if (d.getDay() === 0) cls.push('sun');
    if (d.getDay() === 6) cls.push('sat');
    if (recs.length) cls.push('has-record');

    const MAX = 3;
    grid.append(el('button', { class: cls.join(' '), type: 'button', onclick: () => openDay(key) },
      el('span', { class: 'num' }, d.getDate()),
      items.slice(0, MAX).map(it => itemChip(it)),
      items.length > MAX ? el('span', { class: 'more' }, `+${items.length - MAX}`) : null,
    ));
  }

  // 月内の記録一覧
  const prefix = `${viewYear}-${pad(viewMonth + 1)}-`;
  const monthRecs = state.records
    .filter(r => r.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));
  const list = $('#month-list');
  list.replaceChildren();
  if (!monthRecs.length) {
    list.append(el('p', { class: 'hint' }, 'この月の記録はありません。日付をタップして記録を追加できます。'));
  } else {
    list.append(...monthRecs.map(recordCard));
  }
}

function recordCard(rec) {
  return el('div', { class: 'record-card', onclick: () => openRecord(rec) },
    el('div', { class: 'head' },
      el('span', {}, formatJP(rec.date)),
      rec.device ? el('span', { class: 'place' }, rec.device) : null),
    el('div', { class: 'chips' }, sortItems(rec.items).map(it => itemChip(it, true))),
    rec.memo ? el('div', { class: 'memo' }, rec.memo) : null,
  );
}

// ---------- 日別ダイアログ ----------

let dayKey = null;

function openDay(key) {
  const recs = recordsOn(key);
  if (!recs.length) {
    openRecord(null, key);
    return;
  }
  dayKey = key;
  $('#day-title').textContent = formatJP(key);
  $('#day-records').replaceChildren(...recs.map(r => {
    const card = recordCard(r);
    card.addEventListener('click', () => $('#day-dialog').close(), { capture: true });
    return card;
  }));
  $('#day-dialog').showModal();
}

$('#close-day').addEventListener('click', () => $('#day-dialog').close());
$('#add-on-day').addEventListener('click', () => {
  $('#day-dialog').close();
  openRecord(null, dayKey);
});

// ---------- 記録ダイアログ ----------

let editingId = null;
// partId -> { L, R } (左右あり) / { N } (左右なし)
let picks = {};
// partId -> 出力レベル（文字列）
let levels = {};

function openRecord(rec, dateKey) {
  editingId = rec ? rec.id : null;
  picks = {};
  levels = {};
  if (rec) {
    for (const it of rec.items) {
      if (it.level) levels[it.partId] = it.level;
      const p = picks[it.partId] = picks[it.partId] || {};
      if (it.side === 'B') { p.L = true; p.R = true; }
      else p[it.side] = true;
    }
  }
  $('#dialog-title').textContent = rec ? '記録を編集' : '記録を追加';
  $('#record-date').value = rec ? rec.date : (dateKey || todayKey());
  $('#record-device').value = rec ? rec.device || '' : lastDevice();
  $('#record-memo').value = rec ? rec.memo || '' : '';
  $('#delete-record').hidden = !rec;
  renderPicker();
  $('#record-dialog').showModal();
}

function lastDevice() {
  const sorted = [...state.records].sort((a, b) => b.date.localeCompare(a.date));
  return sorted.find(r => r.device)?.device || '';
}

// その部位で最後に使った出力レベル
function lastLevel(partId) {
  const sorted = [...state.records].sort((a, b) => b.date.localeCompare(a.date));
  for (const r of sorted) {
    const it = r.items.find(i => i.partId === partId && i.level);
    if (it) return it.level;
  }
  return '';
}

function renderPicker() {
  const picker = $('#part-picker');
  picker.replaceChildren();
  const groups = new Map();
  for (const p of state.parts) {
    // アーカイブ済みの部位は、編集中の記録で使われている場合のみ表示
    if (p.archived && !picks[p.id]) continue;
    const g = p.group || 'その他';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  for (const [g, parts] of groups) {
    picker.append(el('div', { class: 'part-group' },
      el('h4', {}, g),
      el('div', { class: 'items' }, parts.map(pickControl)),
    ));
  }
  renderLevels();
}

function renderLevels() {
  const box = $('#level-inputs');
  const selected = state.parts.filter(p => picks[p.id]);
  box.replaceChildren();
  if (!selected.length) return;
  box.append(el('h4', {}, '出力レベル（任意・前回の値を自動入力）'));
  for (const p of selected) {
    if (!(p.id in levels)) levels[p.id] = lastLevel(p.id);
    box.append(el('label', { class: 'level-row' },
      el('span', {}, p.name),
      el('input', {
        type: 'text', inputmode: 'numeric', value: levels[p.id], placeholder: '例：3',
        oninput: e => { levels[p.id] = e.target.value.trim(); },
      })));
  }
}

function pickControl(part) {
  const sel = picks[part.id] || {};
  const anySelected = Object.values(sel).some(Boolean);
  const toggle = side => () => {
    const p = picks[part.id] = picks[part.id] || {};
    p[side] = !p[side];
    if (!Object.values(p).some(Boolean)) delete picks[part.id];
    renderPicker();
  };
  if (part.paired) {
    return el('span', { class: 'pick' + (anySelected ? ' selected' : '') },
      el('span', { class: 'name' }, part.name),
      el('button', { type: 'button', class: 'L', 'aria-pressed': String(!!sel.L), onclick: toggle('L') }, '左'),
      el('button', { type: 'button', class: 'R', 'aria-pressed': String(!!sel.R), onclick: toggle('R') }, '右'),
    );
  }
  return el('span', { class: 'pick single' + (anySelected ? ' selected' : '') },
    el('button', { type: 'button', class: 'N', 'aria-pressed': String(!!sel.N), onclick: toggle('N') }, part.name),
  );
}

function picksToItems() {
  const items = [];
  for (const [partId, p] of Object.entries(picks)) {
    const side = p.L && p.R ? 'B' : p.L ? 'L' : p.R ? 'R' : p.N ? 'N' : null;
    if (!side) continue;
    const item = { partId, side };
    if (levels[partId]) item.level = levels[partId];
    items.push(item);
  }
  return items;
}

$('#record-form').addEventListener('submit', e => {
  e.preventDefault();
  const items = picksToItems();
  if (!items.length) {
    alert('部位を1つ以上選んでください。');
    return;
  }
  const data = {
    date: $('#record-date').value,
    device: $('#record-device').value.trim(),
    memo: $('#record-memo').value.trim(),
    items,
  };
  if (editingId) {
    Object.assign(state.records.find(r => r.id === editingId), data);
  } else {
    state.records.push({ id: uid(), ...data });
  }
  save();
  const d = fromKey(data.date);
  viewYear = d.getFullYear();
  viewMonth = d.getMonth();
  $('#record-dialog').close();
  renderAll();
});

$('#cancel-record').addEventListener('click', () => $('#record-dialog').close());
$('#delete-record').addEventListener('click', () => {
  if (!editingId || !confirm('この記録を削除しますか？')) return;
  state.records = state.records.filter(r => r.id !== editingId);
  save();
  $('#record-dialog').close();
  renderAll();
});

// ---------- 部位別サマリー ----------

function renderSummary() {
  // partId:side -> { 照射日 -> 出力レベル }
  const hist = new Map();
  const push = (k, date, level) => {
    if (!hist.has(k)) hist.set(k, new Map());
    const m = hist.get(k);
    if (level || !m.has(date)) m.set(date, level || '');
  };
  for (const r of state.records) {
    for (const it of r.items) {
      if (it.side === 'B') {
        push(`${it.partId}:L`, r.date, it.level);
        push(`${it.partId}:R`, r.date, it.level);
      } else push(`${it.partId}:${it.side}`, r.date, it.level);
    }
  }

  const today = todayKey();
  const rows = [];
  let currentGroup = null;
  for (const p of state.parts) {
    const sides = p.paired ? ['L', 'R'] : ['N'];
    const used = sides.some(s => hist.has(`${p.id}:${s}`));
    if (p.archived && !used) continue;
    const g = p.group || 'その他';
    if (g !== currentGroup) {
      currentGroup = g;
      rows.push(el('tr', { class: 'group-row' }, el('td', { colspan: 4 }, g)));
    }
    sides.forEach((s, i) => {
      const byDate = hist.get(`${p.id}:${s}`) || new Map();
      const dates = [...byDate.keys()].sort();
      const last = dates[dates.length - 1];
      const lastLv = last && byDate.get(last);
      let nextCell = '—';
      if (last) {
        const next = addDays(last, state.intervalDays);
        const left = diffDays(today, next);
        const cls = left <= 0 ? 'due' : left <= 3 ? 'soon' : '';
        const note = left <= 0 ? '（照射OK）' : `（あと${left}日）`;
        nextCell = el('span', { class: cls }, `${next.replaceAll('-', '/')} ${note}`);
      }
      rows.push(el('tr', {},
        el('td', {}, i === 0 ? p.name : '',
          s !== 'N' ? el('span', { class: `side-tag ${s}` }, ' ' + SIDE_LABEL[s]) : null),
        el('td', {}, `${dates.length}回`),
        el('td', {}, last ? last.replaceAll('-', '/') : '—',
          lastLv ? el('span', { class: 'lv' }, ` Lv${lastLv}`) : null),
        el('td', {}, nextCell),
      ));
    });
  }

  $('#summary-table').replaceChildren(el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, '部位'), el('th', {}, '回数'), el('th', {}, '前回'), el('th', {}, '次回目安'))),
    el('tbody', {}, rows),
  ));
}

// ---------- 設定 ----------

function renderSettings() {
  $('#interval-input').value = state.intervalDays;
  const usedIds = new Set(state.records.flatMap(r => r.items.map(i => i.partId)));
  $('#part-list').replaceChildren(...state.parts.map((p, idx) => el('li', {},
    el('span', {}, p.name),
    el('span', { class: 'grp' }, p.group || 'その他'),
    p.paired ? el('span', { class: 'tag' }, '左右') : null,
    p.archived ? el('span', { class: 'grp' }, '（非表示）') : null,
    el('span', { class: 'spacer' }),
    el('button', { type: 'button', title: '上へ', disabled: idx === 0, onclick: () => movePart(idx, -1) }, '↑'),
    el('button', { type: 'button', title: '下へ', disabled: idx === state.parts.length - 1, onclick: () => movePart(idx, 1) }, '↓'),
    p.archived
      ? el('button', { type: 'button', onclick: () => { p.archived = false; save(); renderAll(); } }, '再表示')
      : el('button', { type: 'button', class: 'danger', onclick: () => removePart(p, usedIds.has(p.id)) }, usedIds.has(p.id) ? '非表示' : '削除'),
  )));
}

function movePart(idx, delta) {
  const [p] = state.parts.splice(idx, 1);
  state.parts.splice(idx + delta, 0, p);
  save();
  renderAll();
}

function removePart(part, used) {
  if (used) {
    // 過去の記録で使われている部位は、記録を残すため非表示にする
    if (!confirm(`「${part.name}」は記録で使われているため、選択肢から非表示にします。よろしいですか？`)) return;
    part.archived = true;
  } else {
    if (!confirm(`「${part.name}」を削除しますか？`)) return;
    state.parts = state.parts.filter(p => p !== part);
  }
  save();
  renderAll();
}

$('#interval-input').addEventListener('change', e => {
  const v = parseInt(e.target.value, 10);
  if (v > 0) {
    state.intervalDays = v;
    save();
    renderAll();
  } else {
    e.target.value = state.intervalDays;
  }
});

$('#add-part-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#new-part-name').value.trim();
  if (!name) return;
  state.parts.push({
    id: uid(),
    name,
    group: $('#new-part-group').value.trim() || 'その他',
    paired: $('#new-part-paired').checked,
    archived: false,
  });
  save();
  $('#new-part-name').value = '';
  renderAll();
});

$('#export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `datsumou-${todayKey()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#import-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const s = JSON.parse(await file.text());
    if (!s || !Array.isArray(s.parts) || !Array.isArray(s.records)) throw new Error('形式が正しくありません');
    if (!confirm('現在のデータを読み込んだデータで置き換えます。よろしいですか？')) return;
    state = migrate({ intervalDays: 14, ...s });
    save();
    renderAll();
  } catch (err) {
    alert('インポートに失敗しました: ' + err.message);
  }
});

$('#reset-btn').addEventListener('click', () => {
  if (!confirm('すべての記録と部位設定を削除して初期状態に戻します。よろしいですか？')) return;
  state = defaultState();
  save();
  renderAll();
});

// ---------- ナビゲーション ----------

$('#prev-month').addEventListener('click', () => {
  if (--viewMonth < 0) { viewMonth = 11; viewYear--; }
  renderCalendar();
});
$('#next-month').addEventListener('click', () => {
  if (++viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderCalendar();
});
$('#today-btn').addEventListener('click', () => {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  renderCalendar();
});

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${tab.dataset.view}`));
}));

function renderAll() {
  renderCalendar();
  renderSummary();
  renderSettings();
}

renderAll();
