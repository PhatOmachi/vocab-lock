const $ = (id) => document.getElementById(id);

// Thay các ô <span data-icon="..."> bằng icon SVG
for (const el of document.querySelectorAll('[data-icon]')) el.replaceWith(VL.icon(el.dataset.icon, 16));

let caps = { llm: false, llmName: 'AI' };
const aiName = () => caps.llmName || 'AI';
let extras = {};
let viFromAi = false;

function fmtLeft(ms) {
  if (ms <= 60000) return 'dưới 1 phút';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${m % 60} phút`;
}

const MSG_ICONS = { error: 'error', success: 'success', info: 'info', ai: 'sparkles' };
function setMsg(el, kind, text, loading) {
  el.className = 'imsg ' + (kind || '');
  el.textContent = '';
  if (!text) return;
  const ic = loading ? Object.assign(document.createElement('span'), { className: 'spin' }) : VL.icon(MSG_ICONS[kind] || 'info', 16);
  el.append(ic, Object.assign(document.createElement('span'), { textContent: text }));
}

async function render() {
  const d = await VL.getAll();
  caps = d.caps;
  const learned = d.words.filter((w) => w.learned).length;
  const learning = d.words.length - learned;
  $('cTotal').textContent = d.words.length;
  $('cLearning').textContent = learning;
  $('cLearned').textContent = learned;
  $('enabled').checked = !!d.settings.enabled;
  $('aiBtn').hidden = !caps.llm;

  let t;
  if (d.pendingQuiz) t = 'Đang có câu hỏi chờ bạn trả lời trên trang web.';
  else if (!d.settings.enabled) t = 'Đang tắt hỏi ngẫu nhiên.';
  else if (!learning) t = 'Thêm vài từ để bắt đầu được hỏi nhé.';
  else t = `Câu hỏi tiếp theo trong khoảng ${fmtLeft((d.nextQuizAt || 0) - Date.now())}.`;
  $('next').textContent = t;
  $('status').className = 'smsg ' + (d.pendingQuiz ? 'warning' : 'neutral');
}

function renderAi() {
  const p = $('aiPanel');
  p.textContent = '';
  const rows = [];
  const div = (...kids) => { const d = document.createElement('div'); d.append(...kids); return d; };
  if (extras.pos || extras.reading) {
    const lbl = Object.assign(document.createElement('span'), { className: 'lbl', textContent: extras.pos || '' });
    rows.push(div(lbl, extras.pos && extras.reading ? ' · ' : '', extras.reading ? `đọc: ${extras.reading}` : ''));
  }
  if (extras.example) {
    rows.push(div(Object.assign(document.createElement('i'), { textContent: extras.example })));
    if (extras.exampleVi) rows.push(div(extras.exampleVi));
  }
  p.hidden = !rows.length;
  if (rows.length) p.append(VL.icon('sparkles', 16), div(...rows));
}

async function fillExisting() {
  const en = VL.key($('en').value);
  if (!en) return;
  const { words = [] } = await chrome.storage.local.get('words');
  const w = words.find((x) => VL.key(x.en) === en);
  if (w && !$('vi').value) {
    $('vi').value = w.vi;
    $('note').value = w.note || '';
    growNote();
    setMsg($('addMsg'), 'info', 'Từ này đã có — sửa nghĩa nếu muốn cập nhật.');
  }
}

/* ---------- phát âm ---------- */
const speak = VL.makeSpeaker((m) => chrome.runtime.sendMessage(m));
$('spk').append(VL.icon('speaker', 15));
$('spk').addEventListener('click', () => speak($('en').value, $('spk')));

let pronSeq = 0, pronTimer = null;
let pron = { ipa: '', reading: '' };
function paintPron() {
  const ipa = pron.ipa || extras.ipaAI || '';
  const reading = pron.reading || extras.reading || '';
  $('ipa').textContent = ipa;
  $('reading').textContent = reading ? `${ipa ? '· ' : ''}đọc: ${reading}` : '';
}
async function refreshPron() {
  const en = VL.clean($('en').value, 120);
  const my = ++pronSeq;
  pron = { ipa: '', reading: '' };
  $('pron').hidden = !en;
  $('ipa').textContent = en ? 'đang tra phiên âm…' : '';
  $('reading').textContent = '';
  if (!en) return;
  const r = await chrome.runtime.sendMessage({ type: 'getPron', en });
  if (my !== pronSeq) return;
  pron = { ipa: (r && r.ipa) || '', reading: (r && r.reading) || '' };
  paintPron();
}

$('en').addEventListener('input', () => {
  extras = {};
  renderAi();
  clearTimeout(pronTimer);
  pronTimer = setTimeout(refreshPron, 450);
});
$('en').addEventListener('change', fillExisting);
$('vi').addEventListener('input', () => { viFromAi = false; });

/* ---------- AI gợi ý ---------- */
$('aiBtn').addEventListener('click', async () => {
  const en = $('en').value.trim();
  if (!en) { setMsg($('addMsg'), 'error', 'Nhập từ tiếng Anh trước đã.'); return $('en').focus(); }
  $('aiBtn').disabled = true;
  setMsg($('addMsg'), 'ai', `${aiName()} đang tra từ…`, true);
  const r = await chrome.runtime.sendMessage({ type: 'aiFill', en });
  $('aiBtn').disabled = false;
  if (!r || !r.ok) return setMsg($('addMsg'), 'error', (r && r.error) || `Không gọi được ${aiName()}.`);
  if (!$('vi').value.trim() || viFromAi) { $('vi').value = r.vi; viFromAi = true; }
  extras = { pos: r.pos, ipaAI: r.ipaAI, reading: r.reading, example: r.example, exampleVi: r.exampleVi };
  renderAi();
  paintPron();
  setMsg($('addMsg'), 'ai', `Đã điền gợi ý từ ${aiName()} — kiểm tra lại rồi bấm Lưu.`);
});

async function prefill() {
  const { draftWord } = await chrome.storage.local.get('draftWord');
  if (draftWord) {
    $('en').value = draftWord;
    await chrome.storage.local.remove('draftWord');
    refreshPron();
    await fillExisting();
    $('vi').focus();
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && /^https?:/.test(tab.url || '')) {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => String(window.getSelection() || '').trim()
      });
      const sel = r && r.result;
      if (sel && sel.length <= 60) {
        $('en').value = sel.replace(/\s+/g, ' ');
        refreshPron();
        await fillExisting();
        $('vi').focus();
        return;
      }
    }
  } catch (e) { /* trang không cho chạy script */ }
  $('en').focus();
}

/* ---------- ô ghi chú nhiều dòng, tự giãn ---------- */
function growNote() {
  const t = $('note');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight + 2, 140) + 'px';
}
$('note').addEventListener('input', growNote);
$('addForm').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('addForm').requestSubmit(); }
});

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await chrome.runtime.sendMessage({
    type: 'addWord', en: $('en').value, vi: $('vi').value, note: $('note').value, ...extras
  });
  if (res && res.ok) {
    setMsg($('addMsg'), 'success', res.status === 'updated' ? 'Đã cập nhật.' : 'Đã lưu vào danh sách học.');
    $('en').value = $('vi').value = $('note').value = '';
    growNote();
    extras = {};
    renderAi();
    refreshPron();
    $('en').focus();
  } else {
    setMsg($('addMsg'), 'error', (res && res.error) || 'Không lưu được.');
  }
});

$('enabled').addEventListener('change', async (e) => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...VL.normSettings(settings), enabled: e.target.checked } });
  await chrome.runtime.sendMessage({ type: 'settingsChanged' });
});

$('quizNow').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'quizNow' });
  if (res && res.ok) setMsg($('addMsg'), 'success', 'Đã gửi câu hỏi — xem trang web đang mở (không hiện ở trang edge:// hay tab mới).');
  else setMsg($('addMsg'), 'error', 'Chưa có từ nào đang học để hỏi.');
});

$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((c, area) => { if (area === 'local') render(); });
render();
prefill();
