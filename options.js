const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

for (const el of $$('[data-icon]')) {
  const ic = VL.icon(el.dataset.icon, 16);
  if (el.className) ic.classList.add(...el.className.split(' '));
  el.replaceWith(ic);
}

let words = [];
let pronCache = {};
let settings = VL.normSettings();
let caps = { llm: false, llmName: 'AI', deepgram: false, mic: false };
let filter = 'all';
let query = '';
let editingId = null;
let deferred = false;

/* ---------- tiện ích ---------- */

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}
const lozenge = (text, kind = '') => el('span', { className: `lz ${kind}`, textContent: text });

const MSG_ICONS = { error: 'error', success: 'success', info: 'info', ai: 'sparkles' };
function setMsg(target, kind, text, loading) {
  target.className = 'imsg ' + (kind || '');
  target.textContent = '';
  if (!text) return;
  target.append(loading ? el('span', { className: 'spin' }) : VL.icon(MSG_ICONS[kind] || 'info', 16), el('span', { textContent: text }));
}

/** Flag kiểu Atlassian ở góc trái dưới */
function flag(kind, title, desc) {
  const box = $('#flags');
  const f = el('div', { className: `flag ${kind}`, role: 'status' },
    VL.icon(kind === 'error' ? 'error' : kind === 'info' ? 'info' : 'success', 20),
    el('div', {}, el('div', { className: 't', textContent: title }), desc ? el('div', { className: 'd', textContent: desc }) : null));
  box.append(f);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => f.remove(), 4000);
}

async function mutate(fn) {
  const { words: ws = [] } = await chrome.storage.local.get('words');
  const r = fn(ws);
  await chrome.storage.local.set({ words: ws });
  return r;
}

/* ---------- điều hướng ---------- */

function route() {
  const page = (location.hash || '#words').slice(1);
  const valid = ['words', 'settings', 'ai', 'sync'].includes(page) ? page : 'words';
  for (const p of $$('.page')) p.hidden = p.id !== `page-${valid}`;
  for (const n of $$('.nav-item')) n.classList.toggle('active', n.dataset.page === valid);
  window.scrollTo(0, 0);
}
for (const n of $$('.nav-item')) n.addEventListener('click', () => { location.hash = n.dataset.page; });
window.addEventListener('hashchange', route);
$('#goBulk').addEventListener('click', () => {
  location.hash = 'sync';
  setTimeout(() => { $('#bulk').focus(); $('#bulkTitle').scrollIntoView({ block: 'center' }); }, 50);
});

/* =================== TỪ VỰNG =================== */

const speak = VL.makeSpeaker((m) => chrome.runtime.sendMessage(m));

async function loadWords() {
  const d = await chrome.storage.local.get(['words', 'pronCache', 'settings', 'aiCaps']);
  words = d.words || [];
  pronCache = d.pronCache || {};
  settings = VL.normSettings(d.settings);
  caps = { llm: false, llmName: 'AI', deepgram: false, mic: false, ...(d.aiCaps || {}) };
  renderCounts();
  renderModes();
  renderAiStatus();
  renderImportUi();
  if (editingId) { deferred = true; return; }
  renderList();
}

function renderCounts() {
  const learned = words.filter((w) => w.learned).length;
  $('#cTotal').textContent = words.length;
  $('#cLearning').textContent = words.length - learned;
  $('#cLearned').textContent = learned;
  $('#tAll').textContent = words.length;
  $('#tLearning').textContent = words.length - learned;
  $('#tLearned').textContent = learned;
}

function renderList() {
  deferred = false;
  const tb = $('#tbody');
  tb.textContent = '';
  const q = VL.fold(query);
  let list = words.filter((w) => filter === 'all' || (filter === 'learned' ? w.learned : !w.learned));
  if (q) list = list.filter((w) => VL.fold(`${w.en} ${w.vi} ${w.note || ''}`).includes(q));
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const empty = $('#empty');
  empty.hidden = list.length > 0;
  empty.textContent = '';
  if (!list.length) {
    empty.append(
      el('div', { className: 'h3', textContent: words.length ? 'Không có từ nào khớp' : 'Chưa có từ nào' }),
      el('div', { textContent: words.length ? 'Thử tìm với từ khóa khác.' : 'Bôi đen một từ trên trang web → chuột phải → “Lưu vào Vocab Lock”.' }));
  }
  for (const w of list) tb.append(w.id === editingId ? editRow(w) : viewRow(w));
}

function iconBtn(name, title, onclick, extra = '') {
  const b = el('button', { className: `ibtn sm ${extra}`, type: 'button', title, ariaLabel: title }, VL.icon(name, 16));
  b.addEventListener('click', onclick);
  return b;
}

/** Phiên âm hiển thị: tự nhập > từ điển > AI gợi ý */
function ipaOf(w) {
  if (w.ipaCustom) return w.ipaCustom;
  return VL.pronFor(pronCache[VL.key(w.en)], settings.accent).ipa || w.ipaAI || '';
}

function viewRow(w) {
  const spk = el('button', { className: 'spk sm', type: 'button', title: 'Nghe phát âm (nhấn lần nữa để nghe chậm)', ariaLabel: 'Nghe phát âm' }, VL.icon('speaker', 13));
  spk.addEventListener('click', () => speak(w.en, spk));
  const pronText = [ipaOf(w), w.reading ? `đọc: ${w.reading}` : ''].filter(Boolean).join(' · ');
  return el('tr', { className: w.learned ? 'learned' : '' },
    el('td', {},
      el('div', { className: 'en-line' }, spk, el('span', { className: 'en', textContent: w.en }), w.pos ? lozenge(w.pos) : null),
      pronText ? el('span', { className: 'ipa', textContent: pronText }) : null,
      w.note ? el('div', { className: 'note', textContent: w.note }) : null),
    el('td', {},
      el('div', { className: 'vi', textContent: w.vi }),
      w.example ? el('div', { className: 'ex', textContent: w.example }) : null,
      w.example && w.exampleVi ? el('div', { className: 'exvi', textContent: w.exampleVi }) : null),
    el('td', { className: 'num', textContent: `${w.correct || 0} / ${w.wrong || 0}` }),
    el('td', {}, w.learned ? lozenge('Đã thuộc', 'success') : lozenge('Đang học', 'info')),
    el('td', { className: 'act' },
      iconBtn('edit', 'Sửa', () => { editingId = w.id; renderList(); }),
      iconBtn(w.learned ? 'undo' : 'check', w.learned ? 'Học lại' : 'Đánh dấu đã thuộc', () => toggleLearned(w.id)),
      iconBtn('trash', 'Xóa', () => removeWord(w), 'danger')));
}

function tf(input) {
  return el('div', { className: 'tf compact' }, input);
}

function editField(label, input, cls = '', helper = '') {
  return el('div', { className: `field ${cls}` },
    el('label', { className: 'flabel', textContent: label }),
    el('div', { className: 'tf' }, input),
    helper ? el('div', { className: 'helper', textContent: helper }) : null);
}

/** Ô sửa từ mở rộng: chỉnh tay đủ các trường (giống những gì AI điền) */
function editRow(w) {
  const inp = (value, placeholder, extra = {}) => el('input', { value: value || '', placeholder, ...extra });
  const dictIpa = VL.pronFor(pronCache[VL.key(w.en)], settings.accent).ipa || w.ipaAI || '';
  const f = {
    en: inp(w.en, 'vd: cutover', { spellcheck: false }),
    vi: inp(w.vi, 'Nhiều nghĩa cách nhau bằng dấu phẩy'),
    pos: inp(w.pos, 'n, v, adj, adv…', { spellcheck: false }),
    ipaCustom: inp(w.ipaCustom, dictIpa ? `${dictIpa} (tự động)` : '/ˈkʌtˌoʊvər/', { spellcheck: false }),
    reading: inp(w.reading, 'vd: CẮT-âu-vơ'),
    example: inp(w.example, 'Câu ví dụ tiếng Anh'),
    exampleVi: inp(w.exampleVi, 'Dịch câu ví dụ'),
    note: el('textarea', { value: w.note || '', placeholder: 'Ghi chú (Enter để xuống dòng)', rows: 2 })
  };
  const note = f.note;
  const grow = () => { note.style.height = 'auto'; note.style.height = Math.min(note.scrollHeight + 2, 200) + 'px'; };
  note.addEventListener('input', grow);
  setTimeout(grow, 0);

  const msg = el('div', { className: 'imsg' });
  const cancel = () => {
    editingId = null;
    if (deferred) loadWords(); else renderList();
  };
  const save = async () => {
    const nEn = VL.clean(f.en.value, 120), nVi = VL.clean(f.vi.value);
    if (!nEn || !nVi) return flag('error', 'Thiếu thông tin', 'Cần nhập cả từ và nghĩa.');
    const r = await mutate((ws) => {
      if (ws.some((x) => x.id !== w.id && VL.key(x.en) === VL.key(nEn))) return 'dup';
      const x = ws.find((x) => x.id === w.id);
      if (!x) return 'gone';
      Object.assign(x, {
        en: nEn, vi: nVi, note: VL.cleanText(f.note.value),
        pos: VL.clean(f.pos.value, 20), ipaCustom: VL.clean(f.ipaCustom.value, 80), reading: VL.clean(f.reading.value, 80),
        example: VL.clean(f.example.value), exampleVi: VL.clean(f.exampleVi.value), updatedAt: Date.now()
      });
      return 'ok';
    });
    if (r === 'dup') return flag('error', 'Từ bị trùng', `“${nEn}” đã có trong danh sách.`);
    editingId = null;
    flag('success', 'Đã lưu thay đổi');
    loadWords();
  };
  for (const i of Object.values(f)) {
    i.addEventListener('keydown', (e) => {
      // Ô ghi chú: Enter = xuống dòng, Ctrl/⌘ + Enter = lưu
      if (e.key === 'Enter' && (i !== note || e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
      if (e.key === 'Escape') cancel();
    });
  }
  setTimeout(() => f.vi.focus(), 0);

  const bSave = el('button', { className: 'btn primary', type: 'button', textContent: 'Lưu' });
  bSave.addEventListener('click', save);
  const bCancel = el('button', { className: 'btn subtle', type: 'button', textContent: 'Hủy' });
  bCancel.addEventListener('click', cancel);
  let bAi = null;
  if (caps.llm) {
    // Điền các ô đang trống bằng AI (ô đã có chữ thì giữ nguyên)
    bAi = el('button', { className: 'btn discovery', type: 'button' }, VL.icon('sparkles', 16), el('span', { textContent: 'Điền ô trống bằng AI' }));
    bAi.addEventListener('click', async () => {
      bAi.disabled = true;
      setMsg(msg, 'ai', `${caps.llmName} đang điền…`, true);
      const r = await chrome.runtime.sendMessage({ type: 'aiFill', en: f.en.value, context: w.context || '' });
      bAi.disabled = false;
      if (!r || !r.ok) return setMsg(msg, 'error', (r && r.error) || 'Không gọi được AI.');
      const fillIf = (k, v) => { if (!f[k].value.trim() && v) f[k].value = v; };
      fillIf('vi', r.vi); fillIf('pos', r.pos); fillIf('reading', r.reading);
      if (!f.example.value.trim() && r.example) { f.example.value = r.example; fillIf('exampleVi', r.exampleVi); }
      if (!f.ipaCustom.value.trim() && !dictIpa && r.ipaAI) f.ipaCustom.value = r.ipaAI;
      setMsg(msg, 'ai', 'Đã điền các ô trống — kiểm tra lại rồi bấm Lưu.');
    });
  }

  return el('tr', { className: 'editing' },
    el('td', { colSpan: 5 },
      el('div', { className: 'edit-grid' },
        editField('Từ tiếng Anh', f.en, 'c2'),
        editField('Nghĩa tiếng Việt', f.vi, 'c3'),
        editField('Loại từ', f.pos, 'c1'),
        editField('Phiên âm', f.ipaCustom, 'c2', 'Để trống = lấy từ từ điển'),
        editField('Cách đọc', f.reading, 'c2'),
        el('div', { className: 'field c2' }),
        editField('Câu ví dụ', f.example, 'c3'),
        editField('Dịch câu ví dụ', f.exampleVi, 'c3'),
        editField('Ghi chú', f.note, '', 'Ghi chú chỉ hiện sau khi bạn trả lời đúng. Enter để xuống dòng, Ctrl + Enter để lưu.'),
        el('div', { className: 'actions' }, el('span', { className: 'grow' }, bAi, ' ', msg), bCancel, bSave))));
}

async function toggleLearned(id) {
  let now;
  await mutate((ws) => {
    const x = ws.find((x) => x.id === id);
    if (!x) return;
    x.learned = !x.learned;
    now = x.learned;
    if (!x.learned) x.streak = 0;
    x.updatedAt = Date.now();
  });
  flag('success', now ? 'Đã đánh dấu thuộc' : 'Đã chuyển về đang học');
}

async function removeWord(w) {
  if (!confirm(`Xóa từ “${w.en}”?`)) return;
  await mutate((ws) => {
    const i = ws.findIndex((x) => x.id === w.id);
    if (i >= 0) ws.splice(i, 1);
  });
  flag('success', 'Đã xóa từ', w.en);
}

$('#search').addEventListener('input', (e) => { query = e.target.value; renderList(); });
$('#filter').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (!b) return;
  filter = b.dataset.f;
  for (const x of $$('#filter .tab')) x.classList.toggle('on', x === b);
  renderList();
});

/* =================== CÀI ĐẶT CHUNG =================== */

const MODE_INFO = {
  meaning: { d: 'Hiện từ tiếng Anh, bạn gõ nghĩa tiếng Việt.', req: [] },
  reverse: { d: 'Hiện nghĩa tiếng Việt, bạn gõ lại từ tiếng Anh.', req: [] },
  choice: { d: 'Chọn 1 trong 4 nghĩa. Cần ít nhất 4 từ có nghĩa khác nhau.', req: [] },
  cloze: { d: 'Điền từ vào câu. Có mô hình AI thì tạo câu mới mỗi lần; không có thì dùng câu ví dụ hoặc câu gốc lúc bạn lưu từ.', req: [] },
  speak: { d: 'Đọc to từ vào micro, Deepgram nghe ra đúng từ thì mở khóa.', req: ['deepgram', 'mic'] }
};

function renderModes() {
  const box = $('#modes');
  if (!box || box.contains(document.activeElement)) return;
  box.textContent = '';
  for (const [m, info] of Object.entries(MODE_INFO)) {
    const missing = [];
    if (info.req.includes('deepgram') && !caps.deepgram) missing.push('Cần Deepgram');
    else if (info.req.includes('mic') && !caps.mic) missing.push('Cần quyền micro');
    if (m === 'choice' && words.length < 4) missing.push('Cần ≥ 4 từ');
    const cb = el('input', { type: 'checkbox', checked: !!settings.modes[m], ariaLabel: VL.MODE_LABELS[m] });
    cb.addEventListener('change', () => saveSettings({ modes: { ...settings.modes, [m]: cb.checked } }));
    const tags = [];
    if (m === 'cloze') tags.push(caps.llm ? lozenge(`Dùng ${caps.llmName}`, 'discovery') : lozenge('Tốt hơn khi có AI'));
    if (m === 'speak') tags.push(lozenge('Deepgram', 'discovery'));
    for (const x of missing) tags.push(lozenge(x, 'warning'));
    const tryBtn = el('button', { className: 'btn subtle', type: 'button', title: 'Hỏi thử kiểu này ngay' }, VL.icon('play', 14), el('span', { textContent: 'Thử' }));
    tryBtn.addEventListener('click', () => tryMode(m));
    box.append(el('label', { className: 'mode' + (missing.length ? ' disabled' : '') },
      cb,
      el('div', { className: 'info' },
        el('div', { className: 't' }, VL.MODE_LABELS[m], ...tags),
        el('div', { className: 'd', textContent: info.d })),
      tryBtn));
  }
}

async function tryMode(mode) {
  const r = await chrome.runtime.sendMessage({ type: 'quizNow', mode });
  if (r && r.ok && r.already) flag('info', 'Đang có câu hỏi chờ', 'Trả lời câu hỏi hiện tại trên trang web trước đã.');
  else if (r && r.ok) flag('success', 'Đã gửi câu hỏi', 'Mở một trang web bất kỳ (vd Facebook) để thấy màn hình hỏi.');
  else if (r && r.reason === 'empty') flag('error', 'Chưa có từ nào đang học');
  else flag('error', 'Chưa dùng được kiểu này', 'Kiểm tra lại yêu cầu ghi bên cạnh (key, quyền micro, số lượng từ, câu ví dụ).');
}

function fillSettingsForm() {
  const s = settings;
  $('#sEnabled').checked = !!s.enabled;
  $('#sMin').value = s.minMinutes;
  $('#sMax').value = s.maxMinutes;
  $('#sAccents').checked = !!s.ignoreAccents;
  $('#sAuto').value = s.autoLearnStreak;
  $('#sAccent').value = s.accent;
  $('#sAutoSpeak').checked = !!s.autoSpeak;
  $('#sPauseMedia').checked = s.pauseMedia !== false;
  $('#sAiFill').checked = !!s.aiAutoFill;
  $('#sAiGrade').checked = !!s.aiGrade;
  $('#sVoice').checked = !!s.voiceAnswer;
}

const clamp = (v, lo, hi, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

let flagTimer = null;
async function saveSettings(patch = {}) {
  const { settings: cur } = await chrome.storage.local.get('settings');
  const base = VL.normSettings(cur);
  const min = clamp($('#sMin').value, 1, 1440, base.minMinutes);
  const max = Math.max(min, clamp($('#sMax').value, 1, 1440, base.maxMinutes));
  const next = VL.normSettings({
    ...base,
    enabled: $('#sEnabled').checked,
    minMinutes: min,
    maxMinutes: max,
    ignoreAccents: $('#sAccents').checked,
    autoLearnStreak: clamp($('#sAuto').value, 0, 50, 0),
    accent: $('#sAccent').value === 'uk' ? 'uk' : 'us',
    autoSpeak: $('#sAutoSpeak').checked,
    pauseMedia: $('#sPauseMedia').checked,
    aiAutoFill: $('#sAiFill').checked,
    aiGrade: $('#sAiGrade').checked,
    voiceAnswer: $('#sVoice').checked,
    ...patch
  });
  if (!Object.values(next.modes).some(Boolean)) next.modes.meaning = true; // luôn còn ít nhất 1 kiểu
  const scheduleChanged = next.enabled !== base.enabled || next.minMinutes !== base.minMinutes || next.maxMinutes !== base.maxMinutes;
  settings = next;
  await chrome.storage.local.set({ settings: next });
  if (scheduleChanged) await chrome.runtime.sendMessage({ type: 'settingsChanged' });
  fillSettingsForm();
  renderModes();
  clearTimeout(flagTimer);
  flagTimer = setTimeout(() => flag('success', 'Đã lưu thay đổi'), 250);
}

for (const id of ['sEnabled', 'sPauseMedia', 'sAccents', 'sAccent', 'sAutoSpeak', 'sAiFill', 'sAiGrade', 'sVoice']) {
  $('#' + id).addEventListener('change', () => saveSettings());
}
for (const id of ['sMin', 'sMax', 'sAuto']) {
  $('#' + id).addEventListener('change', () => saveSettings());
}

/* =================== AI & GIỌNG NÓI =================== */

for (const b of $$('[data-reveal]')) {
  b.addEventListener('click', () => {
    const i = $('#' + b.dataset.reveal);
    i.type = i.type === 'password' ? 'text' : 'password';
  });
}

function setStatus(id, state) {
  const map = { ok: ['Đã kết nối', 'success'], none: ['Chưa cấu hình', ''], err: ['Lỗi', 'danger'], busy: ['Đang kiểm tra', 'info'] };
  const [t, k] = map[state];
  const lz = $(id);
  lz.textContent = t;
  lz.className = `lz ${k}`;
}

function renderAiStatus() {
  const any = caps.llm || caps.deepgram;
  $('#navAiLz').textContent = any ? 'Đang bật' : 'Tuỳ chọn';
  $('#navAiLz').className = `lz ${any ? 'success' : 'discovery'}`;
}

/* ---------- Mô hình AI (nhà cung cấp tuỳ chọn) ---------- */

const FORMAT_INFO = {
  openai: ['OpenAI-compatible', '/chat/completions — OpenAI, OpenRouter, Groq, DeepSeek, 9router, Ollama, LM Studio…'],
  gemini: ['Google Gemini', '/models/…:generateContent — API gốc của Google AI Studio'],
  anthropic: ['Anthropic', '/messages — API gốc của Claude']
};
for (const [id, p] of Object.entries(VL.LLM_PRESETS)) {
  const o = el('option', { value: id, textContent: p.label });
  o.dataset.desc = p.baseUrl ? p.baseUrl.replace(/^https?:\/\//, '') : 'Tự nhập Base URL bất kỳ';
  $('#lPreset').append(o);
}
for (const id of Object.keys(VL.LLM_FORMATS)) {
  const o = el('option', { value: id, textContent: FORMAT_INFO[id][0] });
  o.dataset.desc = FORMAT_INFO[id][1];
  $('#lFormat').append(o);
}

// Dropdown kiểu Atlassian thay cho select / datalist mặc định của trình duyệt
for (const id of ['lPreset', 'lFormat', 'sAccent', 'dModel']) UISelect.enhance($('#' + id));
const modelCombo = UISelect.combobox($('#lModel'), {
  getItems: () => [...$('#lModels').options].map((o) => ({ value: o.value, label: o.value, desc: o.label && o.label !== o.value ? o.label : '' })),
  emptyText: 'Chưa có danh sách — bấm “Tải danh sách” để lấy các model đang có.'
});

let savedLlm = null; // cấu hình đang lưu (không chứa key)
const baseOf = (u) => String(u || '').trim().replace(/\/+$/, '');
const isLocalUrl = (u) => {
  try { return /^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)|\.local$/.test(new URL(u).hostname); } catch (e) { return false; }
};

function llmForm() {
  return { preset: $('#lPreset').value, format: $('#lFormat').value, baseUrl: $('#lBase').value.trim(),
    key: $('#gKey').value.trim(), model: $('#lModel').value.trim() };
}

function renderLlmHelp() {
  const pid = $('#lPreset').value;
  const p = VL.LLM_PRESETS[pid] || VL.LLM_PRESETS.custom;
  const keepKey = savedLlm && savedLlm.hasKey && savedLlm.baseUrl === baseOf($('#lBase').value);
  $('#gKey').placeholder = keepKey ? `Đã lưu: ${savedLlm.masked} — để trống để giữ key cũ` : (p.keyHint || 'API key');
  const optional = p.noKey || isLocalUrl($('#lBase').value);
  $('#lKeyOpt').textContent = optional ? '(không bắt buộc)' : '';
  const help = $('#lKeyHelp');
  help.textContent = '';
  if (p.keyUrl) help.append('Lấy key tại ', el('a', { href: p.keyUrl, target: '_blank', rel: 'noopener', textContent: p.keyUrl.replace(/^https:\/\//, '') }), '.');
  else help.textContent = optional ? 'Máy chủ chạy trên máy thường không cần key.' : 'Key do nhà cung cấp của bạn cấp. Để trống nếu máy chủ không yêu cầu.';
  $('#lBaseHelp').textContent = pid === 'ollama'
    ? 'Ollama chặn extension theo mặc định: đặt biến môi trường OLLAMA_ORIGINS=chrome-extension://* rồi khởi động lại Ollama.'
    : 'Địa chỉ gốc của API (phần trước /chat/completions, /models…). Dùng được cả proxy riêng hoặc máy chủ chạy trên máy.';
}

function fillModelList(models) {
  const dl = $('#lModels');
  dl.textContent = '';
  for (const m of models || []) dl.append(el('option', { value: m.id, label: m.label && m.label !== m.id ? m.label : null }));
}

$('#lPreset').addEventListener('change', () => {
  const p = VL.LLM_PRESETS[$('#lPreset').value];
  $('#lFormat').value = p.format;
  if (p.baseUrl || $('#lPreset').value === 'custom') $('#lBase').value = p.baseUrl || '';
  $('#lModel').value = savedLlm && savedLlm.preset === $('#lPreset').value && savedLlm.baseUrl === baseOf(p.baseUrl) ? savedLlm.model : '';
  fillModelList([]);
  setMsg($('#gMsg'), '', '');
  renderLlmHelp();
  if ($('#lPreset').value === 'custom') $('#lBase').focus();
});
$('#lBase').addEventListener('input', renderLlmHelp);
$('#lFormat').addEventListener('change', renderLlmHelp);

$('#lList').addEventListener('click', async () => {
  const b = $('#lList');
  b.disabled = true;
  setMsg($('#gMsg'), 'info', 'Đang tải danh sách model…', true);
  const r = await chrome.runtime.sendMessage({ type: 'listLlmModels', ...llmForm() });
  b.disabled = false;
  if (!r || !r.ok) return setMsg($('#gMsg'), 'error', (r && r.error) || 'Không tải được danh sách model.');
  fillModelList(r.models);
  if (!$('#lModel').value && r.suggested) $('#lModel').value = r.suggested;
  setMsg($('#gMsg'), 'success', r.models.length
    ? `Có ${r.models.length} model — chọn trong danh sách, hoặc gõ để lọc.`
    : 'Máy chủ không trả về model nào — gõ tên model bằng tay.');
  $('#lModel').focus();
  if (r.models.length) modelCombo.open(true);
});

function fillLlmForm(c) {
  const pid = c && c.baseUrl ? c.preset : 'gemini';
  const p = VL.LLM_PRESETS[pid] || VL.LLM_PRESETS.custom;
  $('#lPreset').value = pid;
  $('#lFormat').value = c && c.baseUrl ? c.format : p.format;
  $('#lBase').value = c && c.baseUrl ? c.baseUrl : p.baseUrl;
  $('#lModel').value = (c && c.model) || '';
  $('#gKey').value = '';
  renderLlmHelp();
}

async function loadAiConfig() {
  const c = await chrome.runtime.sendMessage({ type: 'getAiConfig' });
  if (!c) return;
  savedLlm = c.llm;
  fillLlmForm(c.llm);
  setStatus('#gStatus', c.llm.ready ? 'ok' : 'none');
  if (c.llm.ready) $('#gStatus').textContent = `Đã kết nối · ${c.llm.name}`;
  $('#gClear').hidden = !c.llm.baseUrl;

  setStatus('#dStatus', c.deepgram.set ? 'ok' : 'none');
  $('#dKey').value = '';
  $('#dKey').placeholder = c.deepgram.set ? `Đã lưu: ${c.deepgram.masked} — nhập key mới để thay` : 'Deepgram API key';
  $('#dModel').value = c.deepgram.model || 'nova-3';
  showClear('d', c.deepgram.set);
}

function showClear(p, show) {
  let b = $(`#${p}Clear`);
  if (!b) {
    b = el('button', { id: `${p}Clear`, className: 'btn subtle', type: 'button', textContent: 'Xóa key' });
    b.addEventListener('click', async () => {
      if (!confirm('Xóa key này khỏi máy?')) return;
      await chrome.runtime.sendMessage({ type: 'saveDeepgram', key: '' });
      flag('success', 'Đã xóa key');
      setMsg($(`#${p}Msg`), '', '');
      loadAiConfig();
    });
    $(`#${p}Save`).after(b);
  }
  b.hidden = !show;
}

$('#gClear').addEventListener('click', async () => {
  if (!confirm('Xóa cấu hình mô hình AI (kể cả API key) khỏi máy?')) return;
  await chrome.runtime.sendMessage({ type: 'clearLlm' });
  setMsg($('#gMsg'), '', '');
  flag('success', 'Đã xóa cấu hình AI', 'Extension quay về chế độ miễn phí.');
  loadAiConfig();
});

async function saveLlmConfig() {
  setStatus('#gStatus', 'busy');
  setMsg($('#gMsg'), 'info', 'Đang gọi thử mô hình AI…', true);
  $('#gSave').disabled = true;
  const r = await chrome.runtime.sendMessage({ type: 'saveLlm', ...llmForm() });
  $('#gSave').disabled = false;
  if (r && r.ok) {
    setMsg($('#gMsg'), 'success', `Kết nối thành công — đang dùng ${r.name} · ${r.model}.`);
    if (r.models) fillModelList(r.models);
    flag('success', `Đã kết nối ${r.name}`, r.model);
    await loadAiConfig();
  } else {
    setStatus('#gStatus', r && r.code === 'need-model' ? 'none' : 'err');
    if (r && r.models) fillModelList(r.models);
    setMsg($('#gMsg'), 'error', (r && r.error) || 'Không kết nối được.');
    if (r && r.code === 'need-model') $('#lModel').focus();
  }
}
$('#gSave').addEventListener('click', saveLlmConfig);
$('#lModel').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveLlmConfig(); });

async function saveDeepgramKey() {
  const key = $('#dKey').value.trim();
  setStatus('#dStatus', 'busy');
  setMsg($('#dMsg'), 'info', 'Đang kiểm tra key với Deepgram…', true);
  $('#dSave').disabled = true;
  const r = await chrome.runtime.sendMessage({ type: 'saveDeepgram', ...(key ? { key } : {}), model: $('#dModel').value });
  $('#dSave').disabled = false;
  if (r && r.ok && !r.cleared) {
    setStatus('#dStatus', 'ok');
    setMsg($('#dMsg'), 'success', 'Kết nối thành công.');
    flag('success', 'Đã kết nối Deepgram', caps.mic ? null : 'Bấm “Cấp quyền micro” để dùng được tính năng nói.');
    loadAiConfig();
  } else if (r && r.cleared) {
    setStatus('#dStatus', 'none');
    setMsg($('#dMsg'), 'error', 'Nhập API key trước đã.');
  } else {
    setStatus('#dStatus', 'err');
    setMsg($('#dMsg'), 'error', (r && r.error) || 'Không kiểm tra được key.');
  }
}
$('#dSave').addEventListener('click', saveDeepgramKey);
$('#dModel').addEventListener('change', async () => {
  const c = await chrome.runtime.sendMessage({ type: 'getAiConfig' });
  if (c && c.deepgram.set) saveDeepgramKey();
});

function renderMic(state) {
  const desc = $('#micDesc');
  const b = $('#micBtn');
  if (state === 'granted') {
    desc.textContent = 'Đã cấp quyền — extension có thể thu âm khi bạn bấm nút micro.';
    b.lastChild.textContent = 'Đã cấp quyền';
    b.disabled = true;
  } else if (state === 'denied') {
    desc.textContent = 'Micro đang bị chặn. Bấm biểu tượng ổ khóa trên thanh địa chỉ của trang này → cho phép Micro, rồi tải lại trang.';
    b.lastChild.textContent = 'Thử lại';
    b.disabled = false;
  } else {
    desc.textContent = 'Cần cấp một lần để extension thu âm khi bạn luyện nói.';
    b.lastChild.textContent = 'Cấp quyền micro';
    b.disabled = false;
  }
}

async function checkMic() {
  try {
    const p = await navigator.permissions.query({ name: 'microphone' });
    renderMic(p.state);
    if ((p.state === 'granted') !== !!caps.mic) await chrome.runtime.sendMessage({ type: 'setMic', granted: p.state === 'granted' });
    p.onchange = () => checkMic();
  } catch (e) {
    renderMic(caps.mic ? 'granted' : 'prompt');
  }
}

$('#micBtn').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    await chrome.runtime.sendMessage({ type: 'setMic', granted: true });
    renderMic('granted');
    flag('success', 'Đã cấp quyền micro');
  } catch (e) {
    await chrome.runtime.sendMessage({ type: 'setMic', granted: false });
    renderMic('denied');
    flag('error', 'Chưa cấp được quyền micro', String(e.message || e));
  }
});

/* =================== NHẬP & ĐỒNG BỘ =================== */

// Danh sách cột của dạng đầy đủ
VL.TABLE_COLS.forEach((k, i) => {
  if (i) $('#colList').append(el('span', { className: 'sep', textContent: '|' }));
  $('#colList').append(lozenge(VL.COL_LABELS[k], i < 2 ? 'req' : ''));
});

const pad2 = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(VL.csvCell).join(',')).join('\r\n'); // BOM để Excel đọc đúng tiếng Việt

$('#template').addEventListener('click', () => {
  download('vocab-lock-mau.csv', toCsv([
    VL.TABLE_COLS.map((k) => VL.COL_LABELS[k]),
    ['cutover', 'quá trình cắt chuyển, chuyển đổi hệ thống', 'n', '/ˈkʌtˌoʊvər/', 'CẮT-âu-vơ',
      'The final cutover to the new software is scheduled for midnight.',
      'Việc chuyển đổi cuối cùng sang phần mềm mới được lên lịch vào nửa đêm.', 'Thuật ngữ IT'],
    ['impacts', 'ảnh hưởng, tác động', 'v', '', '', 'The new policy directly impacts our daily workflow.', '', ''],
    ['resilient', 'kiên cường, dẻo dai', '', '', '', '', '', '']
  ]), 'text/csv;charset=utf-8');
  flag('success', 'Đã tải file mẫu', 'Mở bằng Excel / Google Sheets, điền tiếp rồi nhập lại ở mục “Nhập từ file”.');
});

/* ---------- AI điền ô trống ---------- */
const FILL_KEYS = ['vi', 'pos', 'reading', 'example'];
const needsAiFill = (w) => !w.pos || !w.reading || !w.example;
let aiJob = null;

function showProgress(id, text) {
  $(`#${id}`).hidden = !text;
  $(`#${id}Text`).textContent = text || '';
}
$('#bulkStop').addEventListener('click', () => { if (aiJob) aiJob.stop = true; });
$('#fillStop').addEventListener('click', () => { if (aiJob) aiJob.stop = true; });

/** Gọi AI lần lượt cho từng từ — chỉ điền ô còn trống, ô bạn đã nhập thì giữ nguyên */
async function aiFillItems(items, progress) {
  aiJob = { stop: false };
  const need = items.filter((it) => FILL_KEYS.some((k) => !it[k]));
  let done = 0, failed = 0, lastErr = '';
  for (const it of need) {
    if (aiJob.stop) break;
    progress(`${caps.llmName} đang điền ${done + 1}/${need.length}: ${it.en}`);
    const r = await chrome.runtime.sendMessage({ type: 'aiFill', en: it.en, context: it.context || '' });
    done++;
    if (r && r.ok) {
      if (!it.vi && r.vi) it.vi = r.vi;
      if (!it.pos && r.pos) it.pos = r.pos;
      if (!it.reading && r.reading) it.reading = r.reading;
      if (!it.example && r.example) {
        it.example = r.example;
        if (!it.exampleVi) it.exampleVi = r.exampleVi;
      }
      if (!it.ipaCustom && !it.ipaAI && r.ipaAI) it.ipaAI = r.ipaAI;
      it._filled = true;
    } else {
      failed++;
      lastErr = (r && r.error) || 'lỗi không rõ';
      // Sai key / hết lượt thì dừng luôn, khỏi gọi tiếp vô ích
      if (r && ['auth', 'no-key', 'quota', 'config'].includes(r.code)) break;
    }
  }
  const stopped = aiJob.stop;
  aiJob = null;
  return { done, failed, total: need.length, stopped, lastErr };
}

function renderBulkInfo() {
  const { items, errors, header } = VL.parseWordTable($('#bulk').value);
  const info = $('#bulkInfo');
  if (!items.length && !errors.length) { info.textContent = ''; return; }
  const noVi = items.filter((i) => !i.vi).length;
  const useAi = caps.llm && $('#bulkAi').checked;
  const parts = [`Đọc được ${items.length} từ${header ? ' (có dòng tiêu đề)' : ''}`];
  if (noVi) parts.push(useAi ? `${noVi} từ chưa có nghĩa — AI sẽ điền` : `${noVi} từ chưa có nghĩa sẽ bị bỏ qua`);
  if (errors.length) parts.push(`${errors.length} dòng không đọc được (dòng ${errors.slice(0, 5).join(', ')}${errors.length > 5 ? '…' : ''})`);
  info.textContent = parts.join(' · ');
}
$('#bulk').addEventListener('input', renderBulkInfo);
$('#bulkAi').addEventListener('change', renderBulkInfo);

function renderImportUi() {
  $('#bulkAiRow').hidden = !caps.llm;
  renderBulkInfo();
  $('#aiFillSection').hidden = !caps.llm;
  const need = words.filter(needsAiFill).length;
  $('#aiFillDesc').textContent = need
    ? `${need} từ đã lưu còn thiếu loại từ, cách đọc hoặc câu ví dụ. ${caps.llmName} chỉ điền phần còn trống, không sửa phần bạn đã nhập.`
    : 'Các từ đã lưu đều có đủ loại từ, cách đọc và câu ví dụ.';
  $('#aiFillBtn').disabled = !need || !!aiJob;
}

$('#bulkAdd').addEventListener('click', async () => {
  const { items, errors } = VL.parseWordTable($('#bulk').value);
  if (!items.length) return flag('error', 'Không đọc được dòng nào', 'Dạng ngắn: word - nghĩa. Dạng đầy đủ: các cột cách nhau bằng |');
  const btn = $('#bulkAdd');
  btn.disabled = true;
  let ai = null;
  if (caps.llm && $('#bulkAi').checked) {
    ai = await aiFillItems(items, (t) => showProgress('bulkProgress', t));
    showProgress('bulkProgress', '');
  }
  const r = await chrome.runtime.sendMessage({ type: 'addWords', items: items.map(({ _filled, ...it }) => it) });
  btn.disabled = false;
  const skipped = errors.length + (r.invalid || 0);
  const details = [];
  if (ai && ai.total) {
    details.push(`AI đã điền ${ai.done - ai.failed}/${ai.total} từ${ai.stopped ? ' (đã dừng giữa chừng)' : ''}.${ai.failed ? ` Lỗi: ${ai.lastErr}` : ''}`);
  }
  if (skipped) details.push(`Bỏ qua ${skipped} dòng (không đọc được hoặc thiếu nghĩa) — các dòng đó vẫn giữ trong ô để bạn sửa.`);
  flag(r.added + r.updated ? 'success' : 'error', `Thêm ${r.added} từ, cập nhật ${r.updated} từ`, details.join(' ') || null);
  document.body.dataset.lastBulk = JSON.stringify({ ...r, ai });
  if (!skipped) $('#bulk').value = '';
  else {
    // Giữ lại các dòng chưa lưu được
    const bad = items.filter((it) => !it.vi).map((it) => it.en);
    $('#bulk').value = bad.join('\n');
  }
  renderBulkInfo();
});

$('#aiFillBtn').addEventListener('click', async () => {
  const targets = words.filter(needsAiFill).map((w) => ({
    id: w.id, en: w.en, vi: w.vi, pos: w.pos, reading: w.reading, example: w.example, exampleVi: w.exampleVi,
    ipaCustom: w.ipaCustom, ipaAI: w.ipaAI, context: w.context
  }));
  if (!targets.length) return;
  $('#aiFillBtn').disabled = true;
  const ai = await aiFillItems(targets, (t) => showProgress('fillProgress', t));
  showProgress('fillProgress', '');
  const filled = new Map(targets.filter((t) => t._filled).map((t) => [t.id, t]));
  await mutate((ws) => {
    for (const x of ws) {
      const t = filled.get(x.id);
      if (!t) continue;
      for (const k of ['pos', 'reading', 'example', 'exampleVi', 'ipaAI']) {
        if (!x[k] && t[k]) x[k] = VL.clean(t[k], k === 'pos' ? 20 : 300);
      }
      x.updatedAt = Date.now();
    }
  });
  flag(filled.size ? 'success' : 'error', `Đã bổ sung ${filled.size}/${ai.total} từ`,
    [ai.stopped ? 'Đã dừng giữa chừng.' : '', ai.failed ? `Lỗi: ${ai.lastErr}` : ''].filter(Boolean).join(' ') || null);
  renderImportUi();
});

/* ---------- xuất ---------- */
$('#export').addEventListener('click', async () => {
  const d = await chrome.storage.local.get(['words', 'settings']);
  const data = {
    app: 'vocab-lock',
    version: 2,
    exportedAt: new Date().toISOString(),
    words: d.words || [],
    settings: VL.normSettings(d.settings)
  };
  download(`vocab-lock-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
  flag('success', `Đã xuất ${data.words.length} từ`, 'File nằm trong thư mục Tải xuống.');
});

$('#exportCsv').addEventListener('click', async () => {
  const { words: ws = [] } = await chrome.storage.local.get('words');
  download(`vocab-lock-${today()}.csv`, toCsv([
    VL.TABLE_COLS.map((k) => VL.COL_LABELS[k]),
    ...ws.map((w) => VL.TABLE_COLS.map((k) => (k === 'ipaCustom' ? ipaOf(w) : w[k] || '')))
  ]), 'text/csv;charset=utf-8');
  flag('success', `Đã xuất ${ws.length} từ ra CSV`, 'Mở được bằng Excel / Google Sheets.');
});

/* ---------- nhập file CSV ---------- */
async function importTable(text) {
  const { items, errors } = VL.parseWordTable(text, { csv: true });
  const valid = items.filter((i) => i.vi);
  const skipped = errors.length + items.length - valid.length;
  if (!valid.length) {
    return flag('error', 'Không đọc được từ nào trong file', 'Cần ít nhất cột Từ và cột Nghĩa. Bấm “Tải file mẫu” để xem cách điền.');
  }
  const mode = document.querySelector('input[name=mode]:checked').value;
  const note = skipped ? `Bỏ qua ${skipped} dòng thiếu từ hoặc nghĩa.` : null;
  if (mode === 'replace') {
    if (!confirm(`Thay toàn bộ danh sách hiện tại bằng ${valid.length} từ trong file?`)) return;
    const seen = new Map();
    for (const it of valid) seen.set(VL.key(it.en), VL.newWord(it));
    await chrome.storage.local.set({ words: [...seen.values()] });
    flag('success', `Đã thay bằng ${seen.size} từ`, note);
    setMsgSync(`CSV thay thế: ${seen.size}`);
  } else {
    const r = await chrome.runtime.sendMessage({ type: 'addWords', items: valid });
    flag('success', `Nhập xong: thêm ${r.added}, cập nhật ${r.updated}`, note);
    setMsgSync(`CSV gộp: thêm ${r.added}, cập nhật ${r.updated}`);
  }
  chrome.runtime.sendMessage({ type: 'backfillPron' });
}

function sanitize(w) {
  if (!w || typeof w !== 'object') return null;
  const en = VL.clean(w.en, 120), vi = VL.clean(w.vi);
  if (!en || !vi) return null;
  const n = (v) => (Number.isFinite(+v) && +v >= 0 ? Math.floor(+v) : 0);
  const base = VL.newWord({ ...w, en, vi });
  return {
    ...base,
    id: typeof w.id === 'string' && w.id ? w.id : base.id,
    learned: !!w.learned,
    correct: n(w.correct), wrong: n(w.wrong), streak: n(w.streak), lastAsked: n(w.lastAsked),
    createdAt: n(w.createdAt) || base.createdAt,
    updatedAt: n(w.updatedAt) || base.updatedAt
  };
}

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const text = await file.text();
  // Không phải JSON (vd .csv xuất từ Excel / Google Sheets) -> đọc dạng bảng
  if (!/\.json$/i.test(file.name) && !/^\s*[[{]/.test(text.replace(/^\uFEFF/, ''))) return importTable(text);
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return flag('error', 'File không hợp lệ', 'File không phải JSON.');
  }
  const raw = Array.isArray(data) ? data : data && data.words;
  if (!Array.isArray(raw)) return flag('error', 'File không hợp lệ', 'Không tìm thấy danh sách từ trong file.');
  const incoming = raw.map(sanitize).filter(Boolean);
  const mode = document.querySelector('input[name=mode]:checked').value;

  if (mode === 'replace') {
    if (!confirm(`Thay toàn bộ danh sách hiện tại bằng ${incoming.length} từ trong file?`)) return;
    const seen = new Map();
    for (const w of incoming) seen.set(VL.key(w.en), w);
    const patch = { words: [...seen.values()] };
    if (data && data.settings && typeof data.settings === 'object') patch.settings = VL.normSettings(data.settings);
    await chrome.storage.local.set(patch);
    flag('success', `Đã thay bằng ${patch.words.length} từ`);
  } else {
    const r = await mutate((ws) => {
      const idx = new Map(ws.map((w, i) => [VL.key(w.en), i]));
      let added = 0, updated = 0, kept = 0;
      for (const w of incoming) {
        const k = VL.key(w.en);
        if (!idx.has(k)) {
          if (ws.some((x) => x.id === w.id)) w.id = VL.uid();
          idx.set(k, ws.length);
          ws.push(w);
          added++;
        } else {
          const i = idx.get(k);
          if ((w.updatedAt || 0) > (ws[i].updatedAt || 0)) {
            ws[i] = { ...w, id: ws[i].id };
            updated++;
          } else kept++;
        }
      }
      return { added, updated, kept };
    });
    flag('success', 'Gộp xong', `Thêm ${r.added}, cập nhật ${r.updated}, giữ nguyên ${r.kept}.`);
    setMsgSync(`Gộp xong: thêm ${r.added}, cập nhật ${r.updated}, giữ nguyên ${r.kept}.`);
  }
  await chrome.runtime.sendMessage({ type: 'settingsChanged' });
  chrome.runtime.sendMessage({ type: 'backfillPron' });
  settings = VL.normSettings((await chrome.storage.local.get('settings')).settings);
  fillSettingsForm();
});

// Ghi lại kết quả nhập gần nhất (để kiểm tra / xem lại)
function setMsgSync(text) {
  document.body.dataset.lastImport = text;
}

/* =================== khởi động =================== */

chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && (c.words || c.pronCache || c.aiCaps)) loadWords();
});

(async () => {
  route();
  await loadWords();
  fillSettingsForm();
  await loadAiConfig();
  checkMic();
})();
