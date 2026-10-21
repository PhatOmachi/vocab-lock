/* Vocab Lock – hàm dùng chung cho popup, trang quản lý, content script và service worker */
var VL = (() => {
  const DEFAULT_MODES = {
    meaning: true,   // EN -> nghĩa tiếng Việt (miễn phí)
    reverse: false,  // nghĩa tiếng Việt -> EN (miễn phí)
    choice: false,   // trắc nghiệm 4 đáp án (miễn phí, cần >= 4 từ)
    cloze: false,    // điền từ vào câu (dùng câu ví dụ đã lưu, hoặc AI tạo câu mới)
    speak: false     // đọc to từ, Deepgram nhận diện (cần Deepgram + micro)
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    minMinutes: 10,
    maxMinutes: 30,
    ignoreAccents: true,
    autoLearnStreak: 0,
    accent: 'us',
    autoSpeak: false,
    pauseMedia: true,     // tạm dừng video/nhạc khi hỏi, trả lời xong tự phát tiếp
    modes: { ...DEFAULT_MODES },
    aiAutoFill: true,    // AI: tự điền nghĩa khi mở hộp lưu từ
    aiGrade: true,       // AI: chấm mềm khi câu trả lời không khớp chữ
    voiceAnswer: false   // Deepgram: hiện nút micro để trả lời bằng giọng nói
  };

  /** Nhà cung cấp AI có sẵn — chỉ để điền nhanh, Base URL / model sửa tự do được */
  const LLM_FORMATS = {
    openai: 'OpenAI-compatible (/chat/completions)',
    gemini: 'Google Gemini (generateContent)',
    anthropic: 'Anthropic (/messages)'
  };
  const LLM_PRESETS = {
    gemini: { label: 'Google Gemini', format: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…' },
    openai: { label: 'OpenAI', format: 'openai', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…' },
    anthropic: { label: 'Anthropic Claude', format: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…' },
    openrouter: { label: 'OpenRouter', format: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', keyHint: 'sk-or-…' },
    groq: { label: 'Groq', format: 'openai', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', keyHint: 'gsk_…' },
    deepseek: { label: 'DeepSeek', format: 'openai', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys', keyHint: 'sk-…' },
    ollama: { label: 'Ollama (chạy trên máy)', format: 'openai', baseUrl: 'http://localhost:11434/v1', noKey: true },
    lmstudio: { label: 'LM Studio (chạy trên máy)', format: 'openai', baseUrl: 'http://localhost:1234/v1', noKey: true },
    custom: { label: 'Tuỳ chỉnh (tự nhập URL)', format: 'openai', baseUrl: '' }
  };

  /** Tên hiển thị của nhà cung cấp: tên preset nếu dùng URL mặc định, không thì lấy tên miền */
  function llmName(cfg) {
    if (!cfg || !cfg.baseUrl) return 'AI';
    const p = LLM_PRESETS[cfg.preset];
    if (p && p.baseUrl && p.baseUrl === cfg.baseUrl) return p.label.replace(/\s*\(.*\)$/, '');
    try { return new URL(cfg.baseUrl).hostname.replace(/^(www|api)\./, ''); } catch (e) { return 'AI'; }
  }

  const MODE_LABELS = {
    meaning: 'Nghĩa của từ',
    reverse: 'Đoán từ',
    choice: 'Trắc nghiệm',
    cloze: 'Điền vào chỗ trống',
    speak: 'Luyện phát âm'
  };

  function normSettings(s) {
    s = s || {};
    return { ...DEFAULT_SETTINGS, ...s, modes: { ...DEFAULT_MODES, ...(s.modes || {}) } };
  }

  const stripAccents = (s) =>
    String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

  /** Chuẩn hoá để tìm kiếm: chữ thường, bỏ dấu, gộp khoảng trắng */
  function fold(s) {
    return stripAccents(String(s || '').normalize('NFC').toLowerCase()).replace(/\s+/g, ' ').trim();
  }

  /** Chuẩn hoá để chấm đáp án */
  function norm(s, ignoreAccents) {
    let t = String(s || '').normalize('NFC').toLowerCase();
    t = t.replace(/[.,!?;:"'“”‘’…()[\]{}<>~`]/g, ' ');
    if (ignoreAccents) t = stripAccents(t);
    return t.replace(/\s+/g, ' ').trim();
  }

  /** "quả táo, trái táo; (n) táo" -> ["quả táo", "trái táo", "(n) táo"] */
  function meanings(vi) {
    return String(vi || '').split(/[,;\/|\n]+/).map((s) => s.trim()).filter(Boolean);
  }

  /** Đúng nếu khớp 1 trong các nghĩa. Phần trong ngoặc () là tuỳ chọn. */
  function check(answer, vi, ignoreAccents) {
    const a = norm(answer, ignoreAccents);
    if (!a) return false;
    const cands = new Set();
    for (const m of [String(vi || ''), ...meanings(vi)]) {
      cands.add(norm(m, ignoreAccents));
      cands.add(norm(m.replace(/\([^)]*\)/g, ' '), ignoreAccents));
    }
    cands.delete('');
    return cands.has(a);
  }

  /** So khớp từ tiếng Anh (không phân biệt hoa thường, gạch nối, "to " ở đầu động từ) */
  function normEn(s) {
    return String(s || '').toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/\s+/g, ' ').trim().replace(/^to /, '');
  }
  function checkEn(answer, targets) {
    const a = normEn(answer);
    return !!a && targets.some((t) => normEn(t) === a);
  }

  /** Tìm từ trong câu (kể cả dạng chia: s, ed, ing...) -> trả về đúng chữ trong câu */
  function findInSentence(sentence, en) {
    const esc = String(en).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    if (!esc) return null;
    const m = String(sentence || '').match(new RegExp(`\\b(${esc}[a-z]*)\\b`, 'i'));
    return m ? m[1] : null;
  }

  /** "quả táo" -> "q _ _   t _ _" */
  function mask(s) {
    return String(s).trim().split(/\s+/)
      .map((w) => [...w].map((c, i) => (i === 0 ? c : '_')).join(' '))
      .join('   ');
  }

  const clean = (s, max = 300) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
  /** Như clean nhưng giữ xuống dòng (dùng cho ghi chú): gộp khoảng trắng trong từng dòng, tối đa 1 dòng trống liên tiếp */
  const cleanText = (s, max = 1000) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.replace(/[ \t\f\v\u00a0]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
  const key = (en) => clean(en).toLowerCase();
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ipaCustom: phiên âm bạn tự nhập (ưu tiên hơn từ điển); ipaAI: phiên âm AI gợi ý (dự phòng khi từ điển không có)
  const EXTRA_FIELDS = ['pos', 'example', 'exampleVi', 'reading', 'ipaAI', 'ipaCustom', 'context'];

  function newWord(w) {
    const now = Date.now();
    const o = {
      id: uid(), en: clean(w.en, 120), vi: clean(w.vi), note: cleanText(w.note),
      learned: false, correct: 0, wrong: 0, streak: 0, lastAsked: 0,
      createdAt: now, updatedAt: now
    };
    for (const f of EXTRA_FIELDS) o[f] = clean(w[f], f === 'context' ? 400 : 300);
    return o;
  }

  /* ---------- Đọc dữ liệu dạng bảng: dán từ Excel / Google Sheets, cột cách nhau bằng | hoặc Tab, hoặc file CSV ---------- */
  const TABLE_COLS = ['en', 'vi', 'pos', 'ipaCustom', 'reading', 'example', 'exampleVi', 'note'];
  const COL_LABELS = {
    en: 'Từ', vi: 'Nghĩa', pos: 'Loại từ', ipaCustom: 'Phiên âm', reading: 'Cách đọc',
    example: 'Câu ví dụ', exampleVi: 'Dịch câu ví dụ', note: 'Ghi chú'
  };
  const HEADER_ALIASES = {
    en: ['tu', 'tu tieng anh', 'tu vung', 'word', 'en', 'english', 'tieng anh', 'term'],
    vi: ['nghia', 'nghia tieng viet', 'meaning', 'vi', 'tieng viet', 'definition'],
    pos: ['loai tu', 'tu loai', 'pos', 'type', 'part of speech'],
    ipaCustom: ['phien am', 'ipa', 'pronunciation'],
    reading: ['cach doc', 'doc', 'reading'],
    example: ['vi du', 'cau vi du', 'example', 'example sentence'],
    exampleVi: ['dich vi du', 'dich cau vi du', 'example vi', 'translation', 'dich'],
    note: ['ghi chu', 'note', 'notes']
  };

  /** Dòng tiêu đề → vị trí từng cột (cho phép cột theo thứ tự bất kỳ) */
  function headerMap(cells) {
    const map = {};
    cells.forEach((c, i) => {
      const f = fold(c).replace(/[_*:]/g, ' ').replace(/\s+/g, ' ').trim();
      for (const [k, al] of Object.entries(HEADER_ALIASES)) {
        if (al.includes(f) && !(k in map)) { map[k] = i; break; }
      }
    });
    return Object.keys(map).length >= 2 && 'en' in map ? map : null;
  }

  /** Tách bảng có hỗ trợ ô trong ngoặc kép (ô chứa dấu phẩy / xuống dòng), kiểu CSV / Excel */
  function parseDelimited(text, delim) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
        } else cell += ch;
        continue;
      }
      if (ch === '"' && cell.trim() === '') { quoted = true; cell = ''; continue; }
      if (ch === delim) { row.push(cell); cell = ''; continue; }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
        continue;
      }
      cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /**
   * Đọc danh sách từ từ chữ dán vào hoặc file.
   * - Dạng ngắn mỗi dòng: "word - nghĩa" / "word = nghĩa" / "word: nghĩa" / chỉ "word" (để AI điền nghĩa)
   * - Dạng đầy đủ: cột cách nhau bằng | hoặc Tab, theo thứ tự TABLE_COLS hoặc theo dòng tiêu đề
   * - opts.csv: file CSV (cột cách nhau bằng dấu phẩy hoặc chấm phẩy)
   */
  function parseWordTable(text, opts = {}) {
    text = String(text || '').replace(/^﻿/, '');
    const firstLine = (text.split(/\r?\n/).find((l) => l.trim()) || '');
    let delim = null;
    if (/\t/.test(firstLine) || (!opts.csv && /\t/.test(text))) delim = '\t';
    else if (opts.csv) delim = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
    else if (/\|/.test(text)) delim = '|';
    const rows = delim ? parseDelimited(text, delim) : text.split(/\r?\n/).map((l) => [l]);

    let map = null, start = 0;
    const first = rows.findIndex((r) => r.some((c) => c.trim()));
    if (delim && first >= 0) {
      map = headerMap(rows[first]);
      if (map) start = first + 1;
    }
    const header = !!map;
    if (!map) map = Object.fromEntries(TABLE_COLS.map((k, i) => [k, i]));

    const items = [], errors = [];
    for (let i = start; i < rows.length; i++) {
      const cells = rows[i];
      if (!cells.some((c) => c.trim())) continue;
      let it;
      if (cells.length === 1) {
        const line = cells[0].trim();
        const m = line.match(/^(.+?)\s*(?:=|:|\s[-–—]\s)\s*(.+)$/);
        it = m ? { en: m[1], vi: m[2] } : { en: line };
      } else {
        it = {};
        for (const [k, idx] of Object.entries(map)) {
          const v = String(cells[idx] == null ? '' : cells[idx]).trim().replace(/\\n/g, '\n');
          if (v) it[k] = v;
        }
      }
      it.en = clean(it.en, 120);
      if (!it.en || it.en.length > 80) { errors.push(i + 1); continue; }
      if (it.vi) it.vi = clean(it.vi);
      items.push(it);
    }
    return { items, errors, header };
  }

  /** Ô CSV: bọc ngoặc kép khi cần */
  const csvCell = (v) => {
    v = String(v == null ? '' : v);
    return /[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };

  async function getAll() {
    const d = await chrome.storage.local.get(['words', 'settings', 'nextQuizAt', 'pendingQuiz', 'aiCaps']);
    return {
      words: Array.isArray(d.words) ? d.words : [],
      settings: normSettings(d.settings),
      nextQuizAt: d.nextQuizAt || 0,
      pendingQuiz: d.pendingQuiz || null,
      caps: { llm: false, llmName: 'AI', deepgram: false, mic: false, ...(d.aiCaps || {}) }
    };
  }

  /** Lấy phiên âm + link audio theo giọng đang chọn từ bản ghi trong pronCache */
  function pronFor(p, accent) {
    if (!p || !p.found) return { ipa: '', audio: '' };
    return accent === 'uk'
      ? { ipa: p.ipaUK || p.ipaUS || '', audio: p.audioUK || p.audioUS || '' }
      : { ipa: p.ipaUS || p.ipaUK || '', audio: p.audioUS || p.audioUK || '' };
  }

  /** Nút loa: nhấn 1 lần đọc bình thường, nhấn lại trong 3 giây thì đọc chậm */
  function makeSpeaker(sendFn) {
    let last = { en: '', at: 0, slow: false };
    return async (en, btn) => {
      en = clean(en, 120);
      if (!en) return null;
      const now = Date.now();
      const slow = last.en === en && now - last.at < 3000 && !last.slow;
      last = { en, at: now, slow };
      if (btn) {
        btn.classList.add('playing');
        btn.title = slow ? 'Đang đọc chậm…' : 'Nghe phát âm (nhấn lần nữa để nghe chậm)';
      }
      const r = await sendFn({ type: 'speak', en, slow });
      if (btn) setTimeout(() => btn.classList.remove('playing'), 800);
      return r;
    };
  }

  /* ---------- Bộ icon nét mảnh (16–24px), vẽ bằng DOM để không dính Trusted Types ---------- */
  const ICONS = {
    speaker: ['M11 5 6 9H2v6h4l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'],
    mic: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'],
    stop: ['M7 7h10v10H7z'],
    sparkles: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M19 3v4', 'M21 5h-4', 'M5 17v4', 'M7 19H3'],
    check: ['M20 6 9 17l-5-5'],
    close: ['M18 6 6 18', 'M6 6l12 12'],
    info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
    error: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 8v4', 'M12 16h.01'],
    success: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'm9 12 2 2 4-4'],
    lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
    edit: ['M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z'],
    trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
    undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-15-6.7L3 13'],
    search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm21 21-4.3-4.3'],
    download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
    upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
    sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
    book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
    key: ['M15.5 7.5 19 4', 'M21 2l-2 2', 'm18 5 3 3', 'M11.4 11.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zM11.4 11.6 15.5 7.5'],
    plus: ['M12 5v14', 'M5 12h14'],
    sync: ['M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M3 21v-5h5', 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5'],
    eye: ['M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    play: ['M7 4l13 8-13 8z'],
    clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
    pause: ['M8 5v14', 'M16 5v14'],
    chevron: ['m6 9 6 6 6-6']
  };

  function icon(name, size = 16) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    const attrs = {
      viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
      'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ic'
    };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    for (const d of ICONS[name] || []) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }
  const speakerIcon = (size) => icon('speaker', size);

  return {
    DEFAULT_SETTINGS, DEFAULT_MODES, MODE_LABELS, EXTRA_FIELDS, LLM_FORMATS, LLM_PRESETS, llmName, normSettings,
    fold, norm, meanings, check, normEn, checkEn, findInSentence, mask, clean, cleanText, key, uid, newWord, getAll,
    pronFor, makeSpeaker, icon, speakerIcon, TABLE_COLS, COL_LABELS, parseWordTable, csvCell
  };
})();
