/* Vocab Lock – content script: màn hình khóa hỏi từ + hộp lưu từ nhanh (giao diện kiểu Atlassian) */
(() => {
  if (window.top !== window) return;

  // Nếu extension vừa reload, bản cũ (mồ côi) vẫn còn trên trang -> báo nó tự tắt
  const TEARDOWN_EVT = 'vocab-lock-teardown-' + chrome.runtime.id;
  try { document.dispatchEvent(new CustomEvent(TEARDOWN_EVT)); } catch (e) {}

  // Sự kiện bị chặn khi đang khóa (chặn ở pha capture của window, trước script của trang)
  const BLOCKED = ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste', 'cut', 'copy',
    'wheel', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu',
    'pointerdown', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'dragstart', 'drop', 'focusin', 'submit'];
  // Sự kiện phát sinh bên trong UI của mình thì không cho lọt ra trang (tránh phím tắt của Facebook...)
  const STOP_INSIDE = ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste', 'cut', 'copy',
    'wheel', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu',
    'pointerdown', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'focusin', 'focusout'];

  /* Token màu theo Atlassian Design System (sáng + tối) */
  const CSS = `
:host{all:initial;
  --text:#172B4D;--text-subtle:#44546F;--text-subtlest:#626F86;--text-disabled:#091E424F;--text-inverse:#FFFFFF;
  --surface:#FFFFFF;--surface-sunken:#F7F8F9;--surface-overlay:#FFFFFF;--surface-hovered:#F1F2F4;
  --input:#FFFFFF;--input-hovered:#F7F8F9;
  --neutral:#091E420F;--neutral-hovered:#091E4224;--neutral-pressed:#091E424F;
  --brand:#0C66E4;--brand-hovered:#0055CC;--brand-pressed:#09326C;
  --border:#091E4224;--border-input:#8590A2;--border-focused:#388BFF;
  --success-text:#216E4E;--success-bg:#DCFFF1;--success-bold:#1F845A;--success-icon:#22A06B;
  --danger-text:#AE2E24;--danger-bg:#FFECEB;--danger-bold:#C9372C;--danger-icon:#C9372C;
  --info-text:#0055CC;--info-bg:#E9F2FF;--info-icon:#1D7AFC;
  --disc-text:#5E4DB2;--disc-bg:#F3F0FF;--disc-bg-hovered:#DFD8FD;--disc-icon:#8270DB;
  --blanket:#091E427D;
  --shadow-overlay:0 8px 12px #091E4226,0 0 1px #091E424F}
@media (prefers-color-scheme:dark){:host{
  --text:#B6C2CF;--text-subtle:#9FADBC;--text-subtlest:#8C9BAB;--text-disabled:#BFDBF847;--text-inverse:#1D2125;
  --surface:#22272B;--surface-sunken:#161A1D;--surface-overlay:#282E33;--surface-hovered:#2C333A;
  --input:#22272B;--input-hovered:#282E33;
  --neutral:#A1BDD914;--neutral-hovered:#A6C5E229;--neutral-pressed:#BFDBF847;
  --brand:#579DFF;--brand-hovered:#85B8FF;--brand-pressed:#CCE0FF;
  --border:#A6C5E229;--border-input:#738496;--border-focused:#85B8FF;
  --success-text:#7EE2B8;--success-bg:#164B35;--success-bold:#4BCE97;--success-icon:#2ABB7F;
  --danger-text:#FD9891;--danger-bg:#5D1F1A;--danger-bold:#F87168;--danger-icon:#E2483D;
  --info-text:#85B8FF;--info-bg:#09326C;--info-icon:#388BFF;
  --disc-text:#B8ACF6;--disc-bg:#352C63;--disc-bg-hovered:#44368B;--disc-icon:#8F7EE7;
  --blanket:#10121499;
  --shadow-overlay:0 0 0 1px #39424A,0 8px 12px #0304045C,0 0 1px 1px #03040480}}
*{box-sizing:border-box;font-family:"Atlassian Sans",ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Ubuntu,system-ui,"Helvetica Neue",sans-serif;
  -webkit-font-smoothing:antialiased}
[hidden]{display:none!important}
.ic{flex:none;display:block}
.blanket{position:fixed;inset:0;pointer-events:auto;display:flex;align-items:center;justify-content:center;padding:16px;
  background:var(--blanket);animation:fade .15s ease}
.modal{width:min(480px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--surface-overlay);color:var(--text);
  border-radius:8px;box-shadow:var(--shadow-overlay);display:flex;flex-direction:column;font-size:14px;line-height:20px;
  animation:rise .2s cubic-bezier(.15,1,.3,1)}
.mhead{display:flex;align-items:center;gap:8px;padding:24px 24px 2px}
.mtitle{margin:0;font-size:20px;line-height:24px;font-weight:600;color:var(--text)}
.lockinfo{margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-size:12px;line-height:16px;color:var(--text-subtlest)}
.mbody{padding:16px 24px 2px}
.mfoot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:20px 24px 24px}
.mfoot .left{margin-right:auto;font-size:12px;line-height:16px;color:var(--text-subtlest)}
.lz{display:inline-flex;align-items:center;font-size:11px;line-height:16px;font-weight:700;text-transform:uppercase;letter-spacing:.01em;
  padding:0 4px;border-radius:3px;background:var(--neutral);color:var(--text-subtle);white-space:nowrap}
.lz.info{background:var(--info-bg);color:var(--info-text)}
.lz.success{background:var(--success-bg);color:var(--success-text)}
.lz.discovery{background:var(--disc-bg);color:var(--disc-text)}
.wordcard{background:var(--surface-sunken);border-radius:6px;padding:20px 16px 16px;text-align:center;margin-bottom:16px}
.prompt{font-size:12px;line-height:16px;font-weight:600;color:var(--text-subtlest);text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px}
.word{font-size:28px;line-height:32px;font-weight:600;color:var(--text);word-break:break-word}
.word.vi{font-size:22px;line-height:28px}
.word.small{font-size:24px;line-height:28px}
.meta{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:6px;font-size:12px;line-height:16px;color:var(--text-subtle)}
.meta .note-text{white-space:pre-line;max-width:100%}
.pron{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:6px;min-height:28px;flex-wrap:wrap}
.ipa{font-family:"Segoe UI","Lucida Sans Unicode","DejaVu Sans","Arial Unicode MS",sans-serif;font-size:14px;color:var(--text-subtle)}
.ipa:empty::before{content:attr(data-empty);font-size:12px;color:var(--text-subtlest)}
.reading{font-size:12px;color:var(--text-subtlest)}
.spk{width:28px;height:28px;flex:none;border:0;border-radius:50%;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;
  background:var(--neutral);color:var(--text-subtle)}
.spk:hover{background:var(--neutral-hovered)}
.spk.playing{background:var(--brand);color:var(--text-inverse);animation:pulse .8s ease}
.spk:disabled{opacity:.4;cursor:default}
.sentence{font-size:18px;line-height:28px;color:var(--text);margin:4px 0}
.blank{display:inline-block;min-width:72px;border-bottom:2px solid var(--brand);margin:0 4px;height:22px;vertical-align:baseline}
.trans{font-size:12px;line-height:16px;color:var(--text-subtlest);font-style:italic;margin-top:6px}
.field{margin-bottom:4px}
.flabel{display:block;font-size:12px;line-height:16px;font-weight:600;color:var(--text-subtle);margin-bottom:4px}
.flabel .optional{font-weight:400;color:var(--text-subtlest)}
.tf{display:flex;align-items:center;min-height:40px;border:1px solid var(--border-input);border-radius:3px;background:var(--input);
  transition:background .2s,border-color .2s,box-shadow .2s}
.tf:hover{background:var(--input-hovered)}
.tf:focus-within{background:var(--input);border-color:var(--border-focused);box-shadow:inset 0 0 0 1px var(--border-focused)}
.tf.invalid{border-color:var(--danger-bold);box-shadow:inset 0 0 0 1px var(--danger-bold)}
.tf input,.tf textarea{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text);font-size:14px;line-height:20px;padding:8px 6px 8px 8px}
.tf textarea{resize:none;align-self:stretch;min-height:56px;max-height:160px;overflow-y:auto;font-family:inherit}
.tf input::placeholder,.tf textarea::placeholder{color:var(--text-subtlest)}
.tf .ibtn{margin-right:4px}
.helper{font-size:12px;line-height:16px;color:var(--text-subtlest);margin-top:4px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border:0;border-radius:3px;
  font-size:14px;font-weight:500;line-height:20px;cursor:pointer;white-space:nowrap;background:var(--neutral);color:var(--text-subtle);
  transition:background .1s}
.btn:hover{background:var(--neutral-hovered);color:var(--text)}
.btn:active{background:var(--neutral-pressed)}
.btn.primary{background:var(--brand);color:var(--text-inverse)}
.btn.primary:hover{background:var(--brand-hovered)}
.btn.primary:active{background:var(--brand-pressed)}
.btn.subtle{background:transparent}
.btn.subtle:hover{background:var(--neutral)}
.btn.discovery{background:var(--disc-bg);color:var(--disc-text)}
.btn.discovery:hover{background:var(--disc-bg-hovered)}
.btn:disabled{background:var(--neutral);color:var(--text-disabled);cursor:not-allowed}
.btn:focus-visible,.ibtn:focus-visible,.spk:focus-visible,.opt:focus-visible,.mic-big:focus-visible{outline:2px solid var(--border-focused);outline-offset:2px}
.ibtn{width:32px;height:32px;flex:none;border:0;border-radius:3px;background:transparent;color:var(--text-subtle);cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center}
.ibtn:hover{background:var(--neutral)}
.ibtn.rec{background:var(--danger-bg);color:var(--danger-text);animation:pulse-red 1.2s infinite}
.ibtn:disabled{color:var(--text-disabled);cursor:default}
.imsg{display:flex;align-items:flex-start;gap:6px;font-size:12px;line-height:16px;margin-top:6px;min-height:16px}
.imsg:empty{display:none}
.imsg .ic{margin-top:0}
.imsg.error{color:var(--danger-text)}
.imsg.success{color:var(--success-text)}
.imsg.info{color:var(--text-subtle)}
.imsg.ai{color:var(--disc-text)}
.hint{font-size:12px;line-height:16px;color:var(--text-subtlest);margin-top:6px}
.hint:empty{display:none}
.hint code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--neutral);color:var(--text);padding:2px 6px;border-radius:3px;
  font-size:13px;letter-spacing:1px}
.hint b{color:var(--text)}
.smsg{display:flex;gap:12px;padding:16px;border-radius:3px;background:var(--info-bg);margin-bottom:16px;text-align:left}
.smsg .ic{color:var(--info-icon)}
.smsg.success{background:var(--success-bg)}.smsg.success .ic{color:var(--success-icon)}
.smsg.discovery{background:var(--disc-bg)}.smsg.discovery .ic{color:var(--disc-icon)}
.smsg-title{font-weight:600;color:var(--text)}
.smsg-desc{color:var(--text);margin-top:2px}
.meaning{font-size:16px;line-height:24px;color:var(--text);margin-top:8px}
.example{font-size:12px;line-height:16px;color:var(--text-subtle);font-style:italic;margin-top:8px}
.example .vi{display:block;color:var(--text-subtlest)}
.stats{display:flex;justify-content:center;gap:16px;font-size:12px;line-height:16px;color:var(--text-subtlest);margin-top:12px}
.stats b{color:var(--text);font-weight:600}
.choices{display:grid;gap:8px}
.opt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:10px 12px;border:1px solid var(--border);border-radius:3px;
  background:var(--surface);color:var(--text);font-size:14px;line-height:20px;cursor:pointer;transition:background .1s,border-color .1s}
.opt:hover{background:var(--surface-hovered);border-color:var(--border-input)}
.opt .key{width:24px;height:24px;flex:none;border-radius:3px;background:var(--neutral);color:var(--text-subtle);font-size:12px;font-weight:600;
  display:inline-flex;align-items:center;justify-content:center}
.opt.wrong{border-color:var(--danger-bold);background:var(--danger-bg);color:var(--danger-text);cursor:not-allowed}
.opt.right{border-color:var(--success-bold);background:var(--success-bg);color:var(--success-text)}
.kbd-tip{font-size:12px;color:var(--text-subtlest)}
.speak{display:flex;flex-direction:column;align-items:center;gap:8px;padding:4px 0 4px}
.mic-big{width:64px;height:64px;border-radius:50%;border:0;cursor:pointer;background:var(--brand);color:var(--text-inverse);
  display:inline-flex;align-items:center;justify-content:center;transition:transform .15s,background .15s}
.mic-big:hover{background:var(--brand-hovered);transform:scale(1.04)}
.mic-big.rec{background:var(--danger-bold);animation:pulse-red 1.2s infinite}
.mic-big.busy{background:var(--neutral-hovered);color:var(--text-subtle);cursor:progress}
.mic-label{font-size:12px;line-height:16px;color:var(--text-subtle);text-align:center}
.spin{width:14px;height:14px;flex:none;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .7s linear infinite}
.shake{animation:shake .38s}
/* hộp lưu từ (inline dialog) */
.pop{position:fixed;top:16px;right:16px;width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;pointer-events:auto;
  background:var(--surface-overlay);color:var(--text);border-radius:8px;box-shadow:var(--shadow-overlay);font-size:14px;line-height:20px;
  animation:drop .18s cubic-bezier(.15,1,.3,1)}
.phead{display:flex;align-items:center;gap:8px;padding:16px 16px 4px}
.ptitle{font-size:16px;line-height:20px;font-weight:600;margin:0}
.phead .ibtn{margin-left:auto}
.pbody{display:flex;flex-direction:column;gap:12px;padding:8px 16px 0}
.pbody .pron{justify-content:flex-start;margin-top:-4px}
.pfoot{display:flex;align-items:center;gap:8px;padding:16px}
.pfoot .grow{margin-right:auto}
.aipanel{border-radius:3px;background:var(--disc-bg);padding:8px 12px;font-size:12px;line-height:16px;color:var(--text);display:flex;gap:8px}
.aipanel .ic{color:var(--disc-icon);margin-top:1px}
.aipanel .row{margin-top:2px}
.aipanel .lbl{color:var(--disc-text);font-weight:600}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes rise{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
@keyframes drop{from{transform:translateY(-8px);opacity:0}to{transform:none;opacity:1}}
@keyframes shake{20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(12,102,228,.45)}100%{box-shadow:0 0 0 10px rgba(12,102,228,0)}}
@keyframes pulse-red{0%{box-shadow:0 0 0 0 rgba(201,55,44,.45)}100%{box-shadow:0 0 0 12px rgba(201,55,44,0)}}`;

  let alive = true;
  let host = null, root = null;
  let lock = null;      // trạng thái màn hình khóa
  let saveBox = null;
  let settings = VL.normSettings();
  let caps = { llm: false, llmName: 'AI', deepgram: false, mic: false };
  const aiName = () => caps.llmName || 'AI';
  let tickTimer = null, rootObserver = null, syncTimer = null;
  let savedOverflow = null;

  /* ---------- tiện ích DOM ---------- */

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const I = (name, size = 16) => VL.icon(name, size);
  const spinner = () => h('span', { class: 'spin', 'aria-hidden': 'true' });

  function btn(label, { kind = '', icon, onclick, type = 'button', title } = {}) {
    return h('button', { class: `btn ${kind}`, type, title, onclick }, icon ? I(icon) : null, label ? h('span', {}, label) : null);
  }
  const lozenge = (text, kind = '') => h('span', { class: `lz ${kind}` }, text);

  const MSG_ICONS = { error: 'error', success: 'success', info: 'info', ai: 'sparkles' };
  function setMsg(el, kind, text, { loading = false } = {}) {
    el.className = `imsg ${kind || ''}`;
    el.textContent = '';
    if (!text) return;
    el.append(loading ? spinner() : I(MSG_ICONS[kind] || 'info', 16), h('span', {}, text));
  }

  function sectionMsg(kind, title, desc, iconName) {
    return h('div', { class: `smsg ${kind}` },
      I(iconName || (kind === 'discovery' ? 'sparkles' : kind === 'success' ? 'success' : 'info'), 20),
      h('div', {}, h('div', { class: 'smsg-title' }, title), desc ? h('div', { class: 'smsg-desc' }, desc) : null));
  }

  async function send(m) {
    try {
      return await chrome.runtime.sendMessage(m);
    } catch (e) {
      if (/context invalidated/i.test(String(e))) teardown();
      return null;
    }
  }

  const speak = VL.makeSpeaker(send);

  /** Dòng phát âm: [loa] /phiên âm/ · đọc: … */
  function pronRow(getText, { readingText } = {}) {
    const ipa = h('span', { class: 'ipa', 'data-empty': '' });
    const reading = h('span', { class: 'reading' });
    const b = h('button', {
      class: 'spk', type: 'button', title: 'Nghe phát âm (nhấn lần nữa để nghe chậm)', 'aria-label': 'Nghe phát âm',
      onclick: () => speak(getText(), b)
    }, I('speaker', 15));
    const row = h('div', { class: 'pron' }, b, ipa, reading);
    let seq = 0;
    let state = { ipa: '', reading: readingText || '', fallbackIpa: '' };
    const paint = () => {
      const shown = state.ipa || state.fallbackIpa;
      if (shown || !ipa.getAttribute('data-empty')) ipa.textContent = shown;
      reading.textContent = state.reading ? `${shown ? '· ' : ''}đọc: ${state.reading}` : '';
    };
    /** Gán phiên âm/cách đọc do AI gợi ý (dùng khi từ điển không có) */
    const setAi = ({ ipa: aiIpa, reading: r }) => {
      state.fallbackIpa = aiIpa || '';
      state.reading = r || state.reading;
      paint();
    };
    const refresh = async () => {
      const text = VL.clean(getText(), 120);
      const my = ++seq;
      state = { ipa: '', reading: readingText || '', fallbackIpa: '' };
      ipa.textContent = '';
      ipa.setAttribute('data-empty', text ? 'đang tra phiên âm…' : '');
      b.disabled = !text;
      if (!text) return paint();
      const r = await send({ type: 'getPron', en: text });
      if (my !== seq) return;
      ipa.setAttribute('data-empty', '');
      state.ipa = (r && r.ipa) || '';
      state.reading = (r && r.reading) || state.reading;
      paint();
    };
    refresh();
    return { row, refresh, setAi, play: () => speak(getText(), b) };
  }

  /** Thu âm qua Deepgram: start -> (tự dừng sau maxMs hoặc bấm lại) -> kết quả */
  function makeRecorder({ lang, maxMs, onState, onResult }) {
    let state = 'idle', timer = null;
    const set = (s) => { state = s; onState(s); };
    async function start() {
      if (state !== 'idle') return;
      set('starting');
      const r = await send({ type: 'recStart', maxMs: maxMs + 1500 });
      if (state !== 'starting') return;
      if (!r || !r.ok) { set('idle'); onResult({ ok: false, error: (r && r.error) || 'unknown' }); return; }
      set('recording');
      timer = setTimeout(stop, maxMs);
    }
    async function stop() {
      if (state !== 'recording') return;
      clearTimeout(timer);
      set('processing');
      const r = await send({ type: 'recStop', lang });
      if (state !== 'processing') return;
      set('idle');
      onResult(r || { ok: false, error: 'unknown' });
    }
    return {
      toggle: () => (state === 'idle' ? start() : state === 'recording' ? stop() : null),
      cancel() {
        clearTimeout(timer);
        if (state === 'recording' || state === 'starting') send({ type: 'recCancel' });
        state = 'cancelled';
      }
    };
  }

  function recError(code) {
    return {
      'no-key': 'Chưa cấu hình Deepgram trong Cài đặt.',
      'mic-denied': 'Chưa cấp quyền micro — vào Cài đặt › AI & giọng nói để cấp quyền.',
      'mic-error': 'Không mở được micro.',
      empty: 'Không thu được âm thanh, thử lại nhé.',
      auth: 'Key Deepgram không hợp lệ.',
      network: 'Không kết nối được Deepgram.'
    }[code] || 'Nhận diện giọng nói bị lỗi, thử lại nhé.';
  }

  /** Nút micro nhỏ trong ô nhập: nói -> điền chữ vào ô -> tự gửi */
  function micButton(lang, input, onDone) {
    const b = h('button', { class: 'ibtn', type: 'button', title: lang === 'vi' ? 'Nói nghĩa tiếng Việt' : 'Nói từ tiếng Anh', 'aria-label': 'Trả lời bằng giọng nói' }, I('mic', 16));
    const rc = makeRecorder({
      lang, maxMs: 5000,
      onState: (s) => {
        b.className = 'ibtn' + (s === 'recording' ? ' rec' : '');
        b.disabled = s === 'processing' || s === 'starting';
        b.textContent = '';
        b.append(s === 'processing' || s === 'starting' ? spinner() : I(s === 'recording' ? 'stop' : 'mic', 16));
        if (lock && lock.el.msg && s === 'recording') setMsg(lock.el.msg, 'info', 'Đang nghe… nói xong bấm nút đỏ (tự dừng sau 5 giây).');
        if (lock && lock.el.msg && s === 'processing') setMsg(lock.el.msg, 'info', 'Đang nhận diện giọng nói…', { loading: true });
      },
      onResult: (r) => {
        if (!r.ok) return lock && setMsg(lock.el.msg, 'error', recError(r.error));
        const text = (r.transcript || '').trim();
        if (!text) return lock && setMsg(lock.el.msg, 'error', 'Không nghe rõ, thử lại nhé.');
        input.value = text.replace(/[.!?]+$/, '');
        if (lock) setMsg(lock.el.msg, '', '');
        onDone();
      }
    });
    b.addEventListener('click', rc.toggle);
    return { el: b, rc };
  }

  function ensureHost() {
    if (!host) {
      host = document.createElement('vocab-lock-ui');
      const st = host.style; // dùng CSSOM để không bị CSP của trang chặn
      for (const [p, v] of [['all', 'initial'], ['position', 'fixed'], ['inset', '0'], ['z-index', '2147483647'],
        ['pointer-events', 'none'], ['display', 'block']]) st.setProperty(p, v, 'important');
      root = host.attachShadow({ mode: 'open' });
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        root.adoptedStyleSheets = [sheet];
      } catch (e) {
        const s = document.createElement('style');
        s.textContent = CSS;
        root.appendChild(s);
      }
      root.addEventListener('keydown', onRootKey);
      for (const t of STOP_INSIDE) root.addEventListener(t, (e) => e.stopPropagation());
    }
    if (document.documentElement && !host.isConnected) document.documentElement.appendChild(host);
  }

  function onRootKey(e) {
    if (lock && lock.phase === 'ask' && lock.mode === 'choice' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = 'abcd'.indexOf(e.key.toLowerCase()) >= 0 ? 'abcd'.indexOf(e.key.toLowerCase()) : '1234'.indexOf(e.key);
      if (i >= 0 && lock.el.opts && lock.el.opts[i]) { e.preventDefault(); lock.el.opts[i].click(); }
    }
    if (saveBox && e.key === 'Escape') closeSaveBox();
  }

  /* ---------- màn hình khóa ---------- */

  function guard(e) {
    if (!lock) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (host && path.includes(host)) return; // sự kiện trong UI của mình -> cho qua
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
    if (e.type === 'focusin') setTimeout(focusLock, 0);
  }

  function focusLock() {
    if (!lock) return;
    const t = lock.phase === 'done' ? lock.el.primary
      : lock.el.input || (lock.el.opts && lock.el.opts.find((o) => !o.disabled)) || lock.el.micBig;
    if (t && root.activeElement !== t) t.focus({ preventScroll: true });
  }

  /* Video / nhạc: tạm dừng khi khóa, trả lời xong thì tự phát tiếp đúng những cái đang phát lúc trước */
  const pausedByUs = new Set();

  function pauseMedia(initial) {
    // Thoát toàn màn hình để màn hình hỏi không bị video che mất
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (settings.pauseMedia === false) return;
    for (const m of document.querySelectorAll('video, audio')) {
      try {
        if (m.paused) continue;
        // Chỉ nhớ media đang phát lúc bắt đầu khóa; video tự phát (autoplay) trong lúc khóa thì chỉ dừng, không phát lại
        if (initial) pausedByUs.add(m);
        m.pause();
      } catch (e) { /* bỏ qua */ }
    }
  }

  function resumeMedia() {
    const list = [...pausedByUs];
    pausedByUs.clear();
    if (!list.length) return;
    setTimeout(() => {
      for (const m of list) {
        // Bỏ qua nếu phần tử đã bị gỡ khỏi trang, đã phát lại hoặc đã hết
        if (!m.isConnected || !m.paused || m.ended) continue;
        try {
          const p = m.play();
          if (p && p.catch) p.catch(() => {});
        } catch (e) { /* bỏ qua */ }
      }
    }, 250);
  }

  function engage() {
    const de = document.documentElement;
    if (de && savedOverflow === null) {
      savedOverflow = [de.style.getPropertyValue('overflow'), de.style.getPropertyPriority('overflow')];
      de.style.setProperty('overflow', 'hidden', 'important');
    }
    pauseMedia(true);
    try {
      const a = document.activeElement;
      if (a && a !== host && a !== document.body && a.blur) a.blur();
    } catch (e) {}
    clearInterval(tickTimer);
    tickTimer = setInterval(() => { pauseMedia(); ensureHost(); }, 700);
  }

  function disengage(resume = true) {
    clearInterval(tickTimer);
    tickTimer = null;
    const de = document.documentElement;
    if (de && savedOverflow !== null) {
      if (savedOverflow[0]) de.style.setProperty('overflow', savedOverflow[0], savedOverflow[1]);
      else de.style.removeProperty('overflow');
    }
    savedOverflow = null;
    if (resume) resumeMedia();
  }

  /** Dòng phụ dưới từ: loại từ + ghi chú. Lúc đang hỏi thì ẩn ghi chú (thường chứa câu ví dụ kèm nghĩa → lộ đáp án) */
  function metaLine(w, { withNote = true } = {}) {
    const note = withNote ? w.note : '';
    if (!w.pos && !note) return null;
    return h('div', { class: 'meta' }, w.pos ? lozenge(w.pos) : null, note ? h('span', { class: 'note-text' }, note) : null);
  }

  function splitCloze(sentence, answer) {
    const i = sentence.toLowerCase().indexOf(answer.toLowerCase());
    if (i < 0) return [sentence, ''];
    return [sentence.slice(0, i), sentence.slice(i + answer.length)];
  }

  function showLock(pq, w) {
    let mode = pq.mode || 'meaning';
    if ((mode === 'cloze' && !(pq.cloze && pq.cloze.sentence)) || (mode === 'choice' && !Array.isArray(pq.choices))) mode = 'meaning';
    const sig = `${pq.wordId}|${mode}|${pq.startedAt}`;
    if (lock && lock.sig === sig) {
      lock.attempts = Math.max(lock.attempts, pq.attempts || 0);
      if (lock.phase === 'ask') { renderHint(); updateLeft(); }
      return;
    }
    hideLock(false); // đổi sang câu hỏi khác: giữ trạng thái tạm dừng, chưa phát lại
    ensureHost();

    lock = { sig, wordId: w.id, word: w, pq, mode, phase: 'ask', attempts: pq.attempts || 0, el: {} };
    const head = h('header', { class: 'mhead' },
      h('h1', { class: 'mtitle' }, 'Ôn từ vựng'),
      lozenge(VL.MODE_LABELS[mode] || mode, 'info'),
      mode === 'cloze' && pq.cloze && pq.cloze.ai ? lozenge('AI', 'discovery') : null,
      h('span', { class: 'lockinfo', title: 'Trả lời đúng để mở khóa trình duyệt' }, I('lock', 12), 'Đang khóa'));
    const body = h('div', { class: 'mbody' });
    const foot = h('footer', { class: 'mfoot' });
    const modal = h('form', {
      class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Vocab Lock – ôn từ vựng', novalidate: true,
      onsubmit: (e) => { e.preventDefault(); submitAnswer(); }
    }, head, body, foot);
    modal.addEventListener('mouseenter', () => { if (lock) lock.hover = true; });
    modal.addEventListener('mouseleave', () => { if (lock) lock.hover = false; });
    const overlay = h('div', { class: 'blanket' }, modal);
    root.appendChild(overlay);
    Object.assign(lock.el, { overlay, modal, body, foot });

    buildAsk();
    engage();
    setTimeout(focusLock, 40);
    // Chỉ tab đang xem mới tự đọc (không đọc ở kiểu câu hỏi mà âm thanh làm lộ đáp án)
    if (settings.autoSpeak && document.visibilityState === 'visible' && lock.el.pron) setTimeout(() => lock && lock.el.pron && lock.el.pron.play(), 300);
  }

  function buildAsk() {
    const { body, foot } = lock.el;
    const w = lock.word, mode = lock.mode;
    body.textContent = '';
    foot.textContent = '';
    const msg = h('div', { class: 'imsg', 'aria-live': 'polite' });
    const hint = h('div', { class: 'hint' });
    const left = h('span', { class: 'left' });
    Object.assign(lock.el, { msg, hint, left, input: null, opts: null, micBig: null, pron: null, trans: null });

    if (mode === 'meaning' || mode === 'reverse' || mode === 'cloze') {
      let card, label, placeholder, lang;
      if (mode === 'meaning') {
        const pron = pronRow(() => w.en);
        lock.el.pron = pron;
        card = h('div', { class: 'wordcard' },
          h('div', { class: 'prompt' }, 'Nghĩa tiếng Việt của từ này là gì?'),
          h('div', { class: 'word' }, w.en), pron.row, metaLine(w, { withNote: false }));
        label = 'Nghĩa tiếng Việt'; placeholder = 'Gõ nghĩa tiếng Việt…'; lang = 'vi';
      } else if (mode === 'reverse') {
        card = h('div', { class: 'wordcard' },
          h('div', { class: 'prompt' }, 'Từ tiếng Anh nào có nghĩa là'),
          h('div', { class: 'word vi' }, w.vi),
          w.pos ? h('div', { class: 'meta' }, lozenge(w.pos)) : null);
        label = 'Từ tiếng Anh'; placeholder = 'Gõ từ tiếng Anh…'; lang = 'en';
      } else {
        const c = lock.pq.cloze;
        const [a, b] = splitCloze(c.sentence, c.answer);
        const trans = h('div', { class: 'trans' });
        lock.el.trans = trans;
        card = h('div', { class: 'wordcard' },
          h('div', { class: 'prompt' }, 'Điền từ còn thiếu vào chỗ trống'),
          h('div', { class: 'sentence' }, a, h('span', { class: 'blank', 'aria-label': 'chỗ trống' }), b),
          h('div', { class: 'meta' }, 'Nghĩa của từ cần điền:', h('b', {}, VL.meanings(w.vi)[0] || w.vi)),
          trans);
        label = 'Từ còn thiếu'; placeholder = 'Gõ từ tiếng Anh…'; lang = 'en';
      }
      const input = h('input', { type: 'text', placeholder, autocomplete: 'off', spellcheck: 'false', 'aria-label': label });
      input.addEventListener('input', () => lock && lock.el.tf.classList.remove('invalid'));
      const tf = h('div', { class: 'tf' }, input);
      if (settings.voiceAnswer && caps.deepgram) {
        const mic = micButton(lang, input, () => submitAnswer());
        tf.append(mic.el);
        lock.el.rc = mic.rc;
      }
      body.append(card, h('div', { class: 'field' }, h('label', { class: 'flabel' }, label), tf, msg, hint));
      lock.el.input = input;
      lock.el.tf = tf;
      lock.el.submit = btn('Trả lời', { kind: 'primary', type: 'submit' });
      foot.append(left, lock.el.submit);
    } else if (mode === 'choice') {
      const pron = pronRow(() => w.en);
      lock.el.pron = pron;
      const card = h('div', { class: 'wordcard' },
        h('div', { class: 'prompt' }, 'Chọn nghĩa đúng của từ'),
        h('div', { class: 'word' }, w.en), pron.row, w.pos ? h('div', { class: 'meta' }, lozenge(w.pos)) : null);
      const list = h('div', { class: 'choices', role: 'group', 'aria-label': 'Các đáp án' });
      lock.pq.choices.forEach((c, i) => {
        const b = h('button', { type: 'button', class: 'opt' }, h('span', { class: 'key' }, 'ABCD'[i]), h('span', {}, c.text));
        b.addEventListener('click', () => pickChoice(b, c));
        list.append(b);
      });
      lock.el.opts = [...list.children];
      body.append(card, list, msg);
      foot.append(left, h('span', { class: 'kbd-tip' }, 'Phím tắt: A · B · C · D'));
    } else if (mode === 'speak') {
      const pron = pronRow(() => w.en);
      lock.el.pron = pron;
      const card = h('div', { class: 'wordcard' },
        h('div', { class: 'prompt' }, 'Đọc to từ này'),
        h('div', { class: 'word' }, w.en), pron.row,
        h('div', { class: 'meta' }, VL.meanings(w.vi)[0] || ''));
      const micBig = h('button', { type: 'button', class: 'mic-big', 'aria-label': 'Bấm để nói' }, I('mic', 26));
      const micLabel = h('div', { class: 'mic-label' }, 'Bấm micro rồi đọc to từ ở trên');
      const rc = makeRecorder({
        lang: 'en', maxMs: 3500,
        onState: (s) => {
          micBig.className = 'mic-big' + (s === 'recording' ? ' rec' : s === 'processing' || s === 'starting' ? ' busy' : '');
          micBig.textContent = '';
          micBig.append(s === 'processing' || s === 'starting' ? spinner() : I(s === 'recording' ? 'stop' : 'mic', 26));
          micLabel.textContent = {
            starting: 'Đang mở micro…', recording: 'Đang nghe… bấm lại để dừng (tự dừng sau 3 giây)',
            processing: 'Đang nhận diện…', idle: 'Bấm micro rồi đọc to từ ở trên'
          }[s] || '';
        },
        onResult: handleSpeakResult
      });
      micBig.addEventListener('click', rc.toggle);
      Object.assign(lock.el, { micBig, rc });
      body.append(card, h('div', { class: 'speak' }, micBig, micLabel), msg, hint);
      foot.append(left, btn('Gõ nghĩa thay vì nói', { kind: 'subtle', onclick: switchToMeaning }));
    }
    renderHint();
    updateLeft();
  }

  function updateLeft() {
    if (lock && lock.el.left) lock.el.left.textContent = lock.attempts ? `Đã sai ${lock.attempts} lần` : '';
  }

  function renderHint() {
    if (!lock || !lock.el.hint) return;
    const n = lock.attempts, el = lock.el.hint, w = lock.word, mode = lock.mode;
    el.textContent = '';
    if (mode === 'choice') return;
    if (mode === 'speak') {
      if (n >= 2) el.append('Mẹo: bấm nút loa để nghe mẫu, nhấn 2 lần để nghe chậm.');
      return;
    }
    const target = mode === 'meaning' ? (VL.meanings(w.vi)[0] || w.vi) : mode === 'reverse' ? w.en : lock.pq.cloze.answer;
    if (mode === 'cloze' && n >= 1 && lock.el.trans && lock.pq.cloze.vi) lock.el.trans.textContent = `“${lock.pq.cloze.vi}”`;
    if (n >= 6) el.append('Đáp án là ', h('b', {}, target), ' — gõ lại để mở khóa nhé.');
    else if (n >= 3) el.append('Gợi ý: ', h('code', {}, VL.mask(target)));
    else if (n > 0) el.append(`Sai thêm ${3 - n} lần nữa sẽ có gợi ý.`);
  }

  function shake() {
    const m = lock.el.modal;
    m.classList.remove('shake');
    void m.offsetWidth;
    m.classList.add('shake');
  }

  function setBusy(b) {
    lock.busy = b;
    if (lock.el.submit) lock.el.submit.disabled = b;
    if (lock.el.input) lock.el.input.readOnly = b;
  }

  async function submitAnswer() {
    if (!lock || lock.phase !== 'ask' || lock.busy || !lock.el.input) return;
    const val = lock.el.input.value;
    if (!val.trim()) return focusLock();
    const w = lock.word, mode = lock.mode;
    let ok = false;
    if (mode === 'meaning') ok = VL.check(val, w.vi, settings.ignoreAccents);
    else if (mode === 'reverse') ok = VL.checkEn(val, [w.en]);
    else if (mode === 'cloze') ok = VL.checkEn(val, [lock.pq.cloze.answer, w.en]);
    if (ok) return correct();

    // Không khớp chữ -> nhờ AI xem có đúng ý không
    if (mode === 'meaning' && caps.llm && settings.aiGrade) {
      setBusy(true);
      setMsg(lock.el.msg, 'ai', `${aiName()} đang xem câu trả lời của bạn…`, { loading: true });
      const r = await send({ type: 'aiGrade', wordId: w.id, answer: val });
      if (!lock || lock.phase !== 'ask') return;
      setBusy(false);
      if (r && r.ok && r.correct) return correct({ ai: true, reason: r.reason, answer: VL.clean(val, 80) });
      return wrong(r && r.ok ? r.reason : `(Không chấm được bằng AI: ${(r && r.error) || 'lỗi'})`);
    }
    wrong();
  }

  function wrong(extra) {
    lock.attempts++;
    setMsg(lock.el.msg, 'error', `Chưa đúng rồi.${extra ? ' ' + extra : ' Thử lại nhé!'}`);
    if (lock.el.tf) lock.el.tf.classList.add('invalid');
    shake();
    if (lock.el.input) lock.el.input.select();
    renderHint();
    updateLeft();
    send({ type: 'quizWrong', wordId: lock.wordId });
  }

  function pickChoice(b, c) {
    if (!lock || lock.phase !== 'ask' || b.disabled) return;
    if (c.correct) {
      b.classList.add('right');
      return correct();
    }
    b.classList.add('wrong');
    b.disabled = true;
    lock.attempts++;
    setMsg(lock.el.msg, 'error', 'Chưa đúng, chọn lại nhé.');
    shake();
    updateLeft();
    send({ type: 'quizWrong', wordId: lock.wordId });
    setTimeout(focusLock, 0);
  }

  function handleSpeakResult(r) {
    if (!lock || lock.phase !== 'ask') return;
    if (!r.ok) return setMsg(lock.el.msg, 'error', recError(r.error)); // lỗi kỹ thuật không tính là sai
    const heard = (r.transcript || '').trim();
    const target = VL.normEn(lock.word.en);
    const said = VL.normEn(heard);
    if (said && ` ${said} `.includes(` ${target} `)) {
      const toks = target.split(' ');
      const confs = (r.words || []).filter((x) => toks.includes(VL.normEn(x.word))).map((x) => x.confidence || 0);
      const conf = confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 100) : 0;
      return correct({ speak: { heard, conf } });
    }
    lock.attempts++;
    setMsg(lock.el.msg, 'error', heard ? `Nghe được “${heard}” — chưa khớp, đọc lại nhé.` : 'Không nghe rõ, đọc lại to hơn nhé.');
    shake();
    renderHint();
    updateLeft();
    send({ type: 'quizWrong', wordId: lock.wordId });
  }

  function switchToMeaning() {
    if (!lock) return;
    if (lock.el.rc) lock.el.rc.cancel();
    send({ type: 'quizSwitch', wordId: lock.wordId });
  }

  async function correct(extra) {
    if (!lock || lock.busy) return;
    lock.busy = true;
    if (lock.el.rc) lock.el.rc.cancel();
    const res = await send({ type: 'quizCorrect', wordId: lock.wordId });
    if (!lock) return;
    lock.busy = false;
    showSuccess((res && res.word) || lock.word, !!(res && res.autoLearned), extra || {});
  }

  function showSuccess(w, autoLearned, extra) {
    lock.phase = 'done';
    const { body, foot } = lock.el;
    body.textContent = '';
    foot.textContent = '';

    if (extra.ai) body.append(sectionMsg('discovery', `${aiName()} chấp nhận câu trả lời`, extra.reason || null));
    else if (extra.speak) {
      body.append(sectionMsg('success', 'Phát âm chuẩn rồi!',
        `Deepgram nghe được “${extra.speak.heard}”${extra.speak.conf ? ` · độ rõ ${extra.speak.conf}%` : ''}.`));
    } else body.append(sectionMsg('success', 'Chính xác!', autoLearned
      ? `Đúng ${w.streak} lần liên tiếp — đã tự đánh dấu là thuộc 🎉` : null));

    const pron = pronRow(() => w.en);
    const card = h('div', { class: 'wordcard' },
      h('div', { class: 'word small' }, w.en), pron.row, metaLine(w),
      h('div', { class: 'meaning' }, w.vi),
      w.example ? h('div', { class: 'example' }, w.example, w.exampleVi ? h('span', { class: 'vi' }, w.exampleVi) : null) : null,
      h('div', { class: 'stats' },
        h('span', {}, 'Đúng ', h('b', {}, String(w.correct || 0))),
        h('span', {}, 'Sai ', h('b', {}, String(w.wrong || 0))),
        h('span', {}, 'Liên tiếp ', h('b', {}, String(w.streak || 0)))));
    body.append(card);

    if (extra.ai && extra.answer) {
      const msg = h('div', { class: 'imsg' });
      const add = btn(`Thêm “${extra.answer}” vào nghĩa`, { kind: 'discovery', icon: 'plus' });
      add.addEventListener('click', async () => {
        add.disabled = true;
        const r = await send({ type: 'addMeaning', wordId: w.id, meaning: extra.answer });
        if (r && r.ok) { add.remove(); setMsg(msg, 'success', 'Đã thêm vào danh sách nghĩa.'); }
        else { add.disabled = false; setMsg(msg, 'error', 'Không thêm được.'); }
      });
      body.append(h('div', {}, add, msg));
    }

    const cont = btn('Tiếp tục', { kind: 'primary', onclick: () => finish(false) });
    const learned = autoLearned ? null : btn('Đã thuộc, không hỏi lại', { kind: 'subtle', onclick: () => finish(true) });
    foot.append(h('span', { class: 'left' }), learned, cont);
    lock.el.primary = cont;

    // Tự mở khóa sau 10 giây (tạm dừng khi đang rê chuột trên hộp thoại)
    let left = 10;
    const label = cont.querySelector('span');
    label.textContent = `Tiếp tục (${left})`;
    lock.countdown = setInterval(() => {
      if (!lock || lock.hover) return;
      left--;
      if (left <= 0) finish(false);
      else label.textContent = `Tiếp tục (${left})`;
    }, 1000);
    setTimeout(focusLock, 30);
  }

  async function finish(markLearned) {
    if (!lock || lock.finishing) return;
    lock.finishing = true;
    clearInterval(lock.countdown);
    const id = lock.wordId;
    hideLock();
    await send({ type: 'quizFinish', wordId: id, markLearned });
  }

  function hideLock(resume = true) {
    if (!lock) return;
    clearInterval(lock.countdown);
    if (lock.el.rc) lock.el.rc.cancel();
    lock.el.overlay.remove();
    lock = null;
    disengage(resume);
  }

  /* ---------- hộp lưu từ nhanh ---------- */

  function closeSaveBox() {
    if (saveBox) saveBox.remove();
    saveBox = null;
  }

  /** Lấy câu chứa từ đang bôi đen (gửi cho AI để dịch đúng ngữ cảnh) */
  function selectionContext(text) {
    try {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !text) return '';
      let el = sel.getRangeAt(0).commonAncestorContainer;
      if (el.nodeType === 3) el = el.parentElement;
      let ctx = '';
      for (let i = 0; i < 5 && el; i++, el = el.parentElement) {
        ctx = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (ctx.length > text.length + 15) break;
      }
      const i = ctx.toLowerCase().indexOf(text.toLowerCase());
      if (i < 0) return VL.clean(ctx, 300);
      const before = ctx.slice(0, i);
      const s = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '));
      const start = s < 0 ? 0 : s + 2;
      const rest = ctx.slice(i + text.length);
      const e = rest.search(/[.!?](\s|$)/);
      const end = e < 0 ? ctx.length : i + text.length + e + 1;
      let out = ctx.slice(start, end).trim();
      if (out.length > 300) out = ctx.slice(Math.max(0, i - 140), i + text.length + 140);
      return VL.clean(out, 300);
    } catch (e) {
      return '';
    }
  }

  function field(label, input, { optional, helper } = {}) {
    return h('div', {},
      h('label', { class: 'flabel' }, label, optional ? h('span', { class: 'optional' }, ' (không bắt buộc)') : null),
      h('div', { class: 'tf' }, input),
      helper ? h('div', { class: 'helper' }, helper) : null);
  }

  async function openSaveBox(text) {
    if (lock) return;
    text = VL.clean(text || String(window.getSelection() || ''), 120);
    const context = selectionContext(text);
    ensureHost();
    closeSaveBox();

    const d = await VL.getAll();
    settings = d.settings;
    caps = d.caps;
    const existing = text ? d.words.find((w) => VL.key(w.en) === VL.key(text)) : null;

    const en = h('input', { type: 'text', placeholder: 'vd: ubiquitous', value: text, autocomplete: 'off', spellcheck: 'false' });
    const vi = h('input', { type: 'text', placeholder: 'vd: phổ biến, có mặt khắp nơi', autocomplete: 'off' });
    const note = h('textarea', { rows: '2', placeholder: 'Ghi chú riêng của bạn (Enter để xuống dòng)' });
    const msg = h('div', { class: 'imsg', 'aria-live': 'polite' });
    const aiPanel = h('div', { class: 'aipanel', hidden: true });
    let extras = {};
    let viFromAi = false;

    if (existing) {
      vi.value = existing.vi;
      note.value = existing.note || '';
      for (const f of VL.EXTRA_FIELDS) if (existing[f]) extras[f] = existing[f];
      setMsg(msg, 'info', existing.learned
        ? 'Từ này bạn đã thuộc — lưu lại sẽ đưa nó về danh sách đang học.'
        : 'Từ này đã có — sửa nghĩa nếu muốn cập nhật.');
    }

    const pron = pronRow(() => en.value, { readingText: extras.reading });

    function renderAi() {
      aiPanel.textContent = '';
      const rows = [];
      if (extras.pos || extras.reading) {
        rows.push(h('div', { class: 'row' },
          extras.pos ? h('span', { class: 'lbl' }, `${extras.pos}`) : null,
          extras.pos && extras.reading ? ' · ' : null,
          extras.reading ? `đọc: ${extras.reading}` : null));
      }
      if (extras.example) {
        rows.push(h('div', { class: 'row' }, h('i', {}, extras.example)));
        if (extras.exampleVi) rows.push(h('div', { class: 'row' }, extras.exampleVi));
      }
      aiPanel.hidden = !rows.length;
      if (rows.length) aiPanel.append(I('sparkles', 16), h('div', {}, ...rows));
    }
    renderAi();

    let aiBtn = null;
    async function runAi() {
      if (!en.value.trim()) { setMsg(msg, 'error', 'Nhập từ tiếng Anh trước đã.'); en.focus(); return; }
      aiBtn.disabled = true;
      setMsg(msg, 'ai', `${aiName()} đang tra từ…`, { loading: true });
      const r = await send({ type: 'aiFill', en: en.value, context });
      if (!saveBox) return;
      aiBtn.disabled = false;
      if (!r || !r.ok) return setMsg(msg, 'error', (r && r.error) || `Không gọi được ${aiName()}.`);
      if (!vi.value.trim() || viFromAi) { vi.value = r.vi; viFromAi = true; }
      extras = { ...extras, pos: r.pos, ipaAI: r.ipaAI, reading: r.reading, example: r.example, exampleVi: r.exampleVi };
      renderAi();
      pron.setAi({ ipa: r.ipaAI, reading: r.reading });
      setMsg(msg, 'ai', `Đã điền gợi ý từ ${aiName()} — kiểm tra lại rồi bấm Lưu.`);
      vi.focus();
    }

    vi.addEventListener('input', () => { viFromAi = false; });
    let pronTimer = null;
    en.addEventListener('input', () => {
      extras = {};
      renderAi();
      clearTimeout(pronTimer);
      pronTimer = setTimeout(pron.refresh, 500);
    });

    const save = async (e) => {
      e.preventDefault();
      if (!en.value.trim() || !vi.value.trim()) {
        setMsg(msg, 'error', 'Nhập cả từ tiếng Anh và nghĩa tiếng Việt nhé.');
        (en.value.trim() ? vi : en).focus();
        return;
      }
      const res = await send({ type: 'addWord', en: en.value, vi: vi.value, note: note.value, ...extras, context });
      if (res && res.ok) {
        setMsg(msg, 'success', res.status === 'updated' ? 'Đã cập nhật.' : 'Đã lưu vào danh sách học.');
        setTimeout(closeSaveBox, 900);
      } else {
        setMsg(msg, 'error', (res && res.error) || 'Không lưu được, thử lại nhé.');
      }
    };

    if (caps.llm) aiBtn = btn('Gợi ý bằng AI', { kind: 'discovery', icon: 'sparkles', onclick: runAi });

    const box = h('form', { class: 'pop', role: 'dialog', 'aria-label': 'Lưu từ vào Vocab Lock', onsubmit: save },
      h('div', { class: 'phead' },
        h('h2', { class: 'ptitle' }, existing ? 'Cập nhật từ' : 'Lưu từ mới'),
        h('button', { class: 'ibtn', type: 'button', title: 'Đóng (Esc)', 'aria-label': 'Đóng', onclick: closeSaveBox }, I('close', 16))),
      h('div', { class: 'pbody' },
        field('Từ tiếng Anh', en), pron.row,
        field('Nghĩa tiếng Việt', vi, { helper: 'Nhiều nghĩa thì cách nhau bằng dấu phẩy.' }),
        field('Ghi chú', note, { optional: true }),
        aiPanel, msg),
      h('div', { class: 'pfoot' },
        aiBtn ? h('span', { class: 'grow' }, aiBtn) : h('span', { class: 'grow' }),
        btn('Hủy', { kind: 'subtle', onclick: closeSaveBox }),
        btn('Lưu', { kind: 'primary', type: 'submit' })));
    // Ô ghi chú tự giãn theo nội dung; Ctrl/⌘ + Enter để lưu nhanh
    const grow = () => { note.style.height = 'auto'; note.style.height = Math.min(note.scrollHeight, 160) + 'px'; };
    note.addEventListener('input', grow);
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); box.requestSubmit(); } });
    root.appendChild(box);
    saveBox = box;
    grow();
    setTimeout(() => (text ? vi : en).focus(), 30);

    if (aiBtn && settings.aiAutoFill && text && !existing) runAi();
  }

  /* ---------- đồng bộ trạng thái với storage ---------- */

  async function sync() {
    if (!alive) return;
    let d;
    try { d = await VL.getAll(); } catch (e) { return teardown(); }
    settings = d.settings;
    caps = d.caps;
    const pq = d.pendingQuiz;
    if (!pq) return hideLock();
    const w = d.words.find((x) => x.id === pq.wordId);
    if (!w) {
      hideLock();
      send({ type: 'quizSkip' });
      return;
    }
    if (lock && lock.phase === 'done' && lock.wordId === w.id) return; // đang ở màn "đúng rồi"
    closeSaveBox();
    showLock(pq, w);
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 40);
  }

  function onStorage(changes, area) {
    if (area !== 'local') return;
    if (changes.pendingQuiz || changes.words || changes.settings || changes.aiCaps) scheduleSync();
  }

  function onMsg(msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.type === 'openSaveBox') {
      openSaveBox(msg.text);
      sendResponse({ ok: true });
    }
  }

  function teardown() {
    if (!alive) return;
    alive = false;
    hideLock();
    closeSaveBox();
    for (const t of BLOCKED) window.removeEventListener(t, guard, true);
    document.removeEventListener(TEARDOWN_EVT, teardown);
    try { chrome.storage.onChanged.removeListener(onStorage); } catch (e) {}
    try { chrome.runtime.onMessage.removeListener(onMsg); } catch (e) {}
    if (rootObserver) rootObserver.disconnect();
    clearTimeout(syncTimer);
    if (host) host.remove();
  }

  for (const t of BLOCKED) window.addEventListener(t, guard, { capture: true, passive: false });
  document.addEventListener(TEARDOWN_EVT, teardown);
  chrome.storage.onChanged.addListener(onStorage);
  chrome.runtime.onMessage.addListener(onMsg);

  function whenRoot(cb) {
    if (document.documentElement) return cb();
    const o = new MutationObserver(() => {
      if (document.documentElement) { o.disconnect(); cb(); }
    });
    o.observe(document, { childList: true });
  }

  whenRoot(() => {
    sync();
    rootObserver = new MutationObserver(() => {
      if ((lock || saveBox) && host && !host.isConnected) ensureHost();
    });
    rootObserver.observe(document.documentElement, { childList: true });
  });
})();
