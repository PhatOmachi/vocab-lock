/* Vocab Lock – service worker: lịch hỏi, lưu từ, thống kê, phát âm, mô hình AI & Deepgram */
importScripts('common.js');

const ALARM = 'vocab-lock-tick';

// Có thể đổi khi test
let DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
let DEEPGRAM_BASE = 'https://api.deepgram.com/v1/';

// Chạy tuần tự các thao tác ghi để nhiều tab gửi cùng lúc không ghi đè nhau
let chain = Promise.resolve();
const serial = (fn) => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
};

function ensureAlarm() {
  chrome.alarms.get(ALARM, (a) => {
    if (!a) chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  });
}
ensureAlarm();

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'vl-save', title: 'Lưu "%s" vào Vocab Lock', contexts: ['selection'] });
  });
  // Chạy trong hàng đợi chung để không ghi đè từ vừa được thêm cùng lúc
  await serial(async () => {
    const d = await chrome.storage.local.get(['settings', 'words', 'nextQuizAt']);
    const patch = { settings: VL.normSettings(d.settings) };
    if (!Array.isArray(d.words)) patch.words = [];
    await chrome.storage.local.set(patch);
    if (!d.nextQuizAt) await scheduleNext();
  });
  await refreshCaps();
  ensureAlarm();
  injectIntoOpenTabs();
  backfillPron();
});

chrome.runtime.onStartup.addListener(async () => {
  ensureAlarm();
  backfillPron();
  // Câu hỏi đang chờ vẫn giữ nguyên sau khi tắt/mở lại Edge
  const { pendingQuiz } = await chrome.storage.local.get('pendingQuiz');
  if (!pendingQuiz) await scheduleNext();
});

/** Gắn content script vào các tab đã mở sẵn lúc cài / cập nhật extension */
async function injectIntoOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const t of tabs) {
      chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['common.js', 'content.js'] }).catch(() => {});
    }
  } catch (e) { /* bỏ qua */ }
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return VL.normSettings(settings);
}

async function scheduleNext() {
  const s = await getSettings();
  const min = Math.max(1, Number(s.minMinutes) || 10);
  const max = Math.max(min, Number(s.maxMinutes) || min);
  const mins = min + Math.random() * (max - min);
  const nextQuizAt = Date.now() + mins * 60000;
  await chrome.storage.local.set({ nextQuizAt });
  return nextQuizAt;
}

/* ===================== Cấu hình AI (chỉ nằm trên máy này, không xuất ra file) ===================== */

function normBase(u) {
  u = String(u || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/\S+$/i.test(u) ? u : '';
}

function normLlm(c) {
  c = c || {};
  const format = VL.LLM_FORMATS[c.format] ? c.format : 'openai';
  let model = VL.clean(c.model, 200);
  if (format === 'gemini') model = model.replace(/^models\//, '');
  return {
    preset: VL.LLM_PRESETS[c.preset] ? c.preset : 'custom',
    format,
    baseUrl: normBase(c.baseUrl),
    apiKey: VL.clean(c.apiKey, 400),
    model
  };
}

/** Máy chủ chạy trên máy mình (Ollama, LM Studio...) thì không bắt buộc key */
function needsKey(c) {
  const p = VL.LLM_PRESETS[c.preset];
  if (p && p.noKey && c.baseUrl === p.baseUrl) return false;
  try {
    const host = new URL(c.baseUrl).hostname;
    return !/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)$|\.local$/.test(host);
  } catch (e) {
    return true;
  }
}
const llmReady = (c) => !!(c.baseUrl && c.model && (c.apiKey || !needsKey(c)));

async function getSecrets() {
  const { secrets } = await chrome.storage.local.get('secrets');
  const s = { deepgramKey: '', deepgramModel: 'nova-3', ...(secrets || {}) };
  // Chuyển key Gemini của bản 2.0 sang cấu hình mới
  if (!s.llm && s.geminiKey) {
    s.llm = { preset: 'gemini', format: 'gemini', baseUrl: VL.LLM_PRESETS.gemini.baseUrl, apiKey: s.geminiKey, model: s.geminiModel || '' };
  }
  s.llm = normLlm(s.llm);
  return s;
}

async function saveSecrets(patch) {
  const { secrets = {} } = await chrome.storage.local.get('secrets');
  const next = { ...secrets, ...patch };
  delete next.geminiKey;
  delete next.geminiModel;
  await chrome.storage.local.set({ secrets: next });
}

/** aiCaps = cờ công khai cho content script biết tính năng nào dùng được (không chứa key) */
async function refreshCaps(patch = {}) {
  const s = await getSecrets();
  const { aiCaps = {} } = await chrome.storage.local.get('aiCaps');
  const caps = {
    mic: false, ...aiCaps, ...patch,
    llm: llmReady(s.llm), llmName: llmReady(s.llm) ? VL.llmName(s.llm) : 'AI', deepgram: !!s.deepgramKey
  };
  delete caps.gemini;
  await chrome.storage.local.set({ aiCaps: caps });
  return caps;
}

async function fetchT(url, opts = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

class AIError extends Error {
  constructor(code, msg) { super(msg || code); this.code = code; }
}

function httpErr(c, status, body) {
  const who = VL.llmName(c);
  if (status === 401 || status === 403 || (status === 400 && /api[ _-]?key/i.test(body))) {
    return new AIError('auth', `API key của ${who} không hợp lệ (hoặc tài khoản chưa có quyền).`);
  }
  if (status === 404) return new AIError('notfound', `${who}: không tìm thấy — kiểm tra lại Base URL hoặc tên model.`);
  if (status === 402) return new AIError('quota', `${who}: tài khoản hết tiền / hết hạn mức.`);
  if (status === 429) return new AIError('quota', `${who} báo hết lượt hoặc gọi quá nhiều, thử lại sau ít phút.`);
  let detail = '';
  try {
    const j = JSON.parse(body);
    detail = (j.error && (j.error.message || (typeof j.error === 'string' ? j.error : ''))) || j.message || '';
  } catch (e) { /* bỏ qua */ }
  return new AIError('http', `${who} lỗi ${status}${detail ? `: ${String(detail).slice(0, 160)}` : ''}.`);
}

function authHeaders(c) {
  if (c.format === 'gemini') return c.apiKey ? { 'x-goog-api-key': c.apiKey } : {};
  if (c.format === 'anthropic') {
    return { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  }
  return c.apiKey ? { Authorization: 'Bearer ' + c.apiKey } : {};
}

async function callApi(c, path, opts, ms) {
  let res;
  try {
    res = await fetchT(c.baseUrl + path, { ...opts, headers: { ...authHeaders(c), ...(opts.headers || {}) } }, ms);
  } catch (e) {
    throw new AIError('network', e.name === 'AbortError'
      ? `${VL.llmName(c)} phản hồi quá lâu.`
      : `Không kết nối được tới ${c.baseUrl}. Kiểm tra URL / mạng (máy chủ chạy trên máy thì đã bật chưa).`);
  }
  return { res, text: await res.text() };
}

const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Đoạn đầu phản hồi (đã làm gọn) để hiện trong thông báo lỗi */
const snippet = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);

function parseResp(text) {
  const t = String(text || '').replace(/^﻿/, '').trim();
  try {
    return JSON.parse(t);
  } catch (e) {
    throw new AIError('parse', t
      ? `Máy chủ AI trả về dữ liệu không đọc được. Phản hồi bắt đầu bằng: “${snippet(t)}”`
      : 'Máy chủ AI trả về phản hồi rỗng.');
  }
}

const isSSE = (t) => !/^\s*[{[]/.test(t) && /^(data|event):/m.test(String(t || '').slice(0, 2000));

/** Lấy chữ từ 1 object phản hồi, chấp nhận nhiều kiểu (OpenAI, OpenAI stream, Responses API, Anthropic, Gemini) */
function textFromObj(j) {
  if (!j || typeof j !== 'object') return '';
  const parts = (arr) => (Array.isArray(arr) ? arr.map((p) => (typeof p === 'string' ? p : p.text || '')).join('') : '');
  const ch = (j.choices || [])[0];
  if (ch) {
    const m = ch.message || ch.delta || {};
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) return parts(m.content);
    if (typeof ch.text === 'string') return ch.text;
    return '';
  }
  if (Array.isArray(j.content)) return parts(j.content.filter((b) => !b.type || b.type === 'text'));      // Anthropic
  if (j.delta && typeof j.delta.text === 'string') return j.delta.text;                                    // Anthropic stream
  if (Array.isArray(j.candidates)) return parts(((j.candidates[0] || {}).content || {}).parts);           // Gemini
  if (typeof j.output_text === 'string') return j.output_text;                                             // Responses API
  if (j.message && typeof j.message.content === 'string') return j.message.content;                        // Ollama /api/chat
  if (typeof j.response === 'string') return j.response;                                                   // Ollama /api/generate
  return '';
}

/** Đọc phản hồi model: JSON thường hoặc stream SSE (data: {...}) */
function extractText(text) {
  const t = String(text || '').replace(/^﻿/, '').trim();
  if (isSSE(t)) {
    let out = '';
    for (const line of t.split(/\r?\n/)) {
      const m = line.match(/^data:\s?(.*)$/);
      if (!m || !m[1] || m[1].trim() === '[DONE]') continue;
      try { out += textFromObj(JSON.parse(m[1])); } catch (e) { /* bỏ dòng hỏng */ }
    }
    if (out) return out;
    throw new AIError('parse', `Không đọc được phản hồi dạng stream từ máy chủ AI: “${snippet(t)}”`);
  }
  const j = parseResp(t);
  if (j && j.error) {
    const msg = typeof j.error === 'string' ? j.error : j.error.message || JSON.stringify(j.error);
    throw new AIError('http', `Máy chủ AI báo lỗi: ${String(msg).slice(0, 160)}`);
  }
  const out = textFromObj(j);
  if (!out) throw new AIError('parse', `Máy chủ AI không trả về nội dung. Phản hồi: “${snippet(t)}”`);
  return out;
}

async function listModels(c) {
  const { res, text } = await callApi(c, c.format === 'gemini' ? '/models?pageSize=200' : '/models', {}, 12000);
  if (!res.ok) throw httpErr(c, res.status, text);
  const data = parseResp(text);
  if (c.format === 'gemini') {
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .filter((m) => !/embed|tts|image|live|audio|robotics|aqa|vision/i.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }));
  }
  const arr = Array.isArray(data) ? data : (data.data || data.models || []);
  return arr
    .map((m) => ({ id: m.id || m.name || m.model, label: m.display_name || m.name || m.id }))
    .filter((m) => m.id && !/embed|whisper|tts|dall-e|moderation|transcri|realtime|image|rerank/i.test(m.id));
}

/** Chọn model mặc định cho Gemini: bản Flash mới nhất (nhanh, rẻ, đủ khôn cho việc này) */
function pickDefaultModel(models) {
  const ver = (n) => {
    const m = n.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  };
  const score = (m) => {
    const n = m.id.toLowerCase();
    let s = ver(n) * 10;
    if (/flash/.test(n)) s += 5;
    if (/lite/.test(n)) s -= 3;
    if (/preview|exp/.test(n)) s -= 1;
    if (/pro/.test(n)) s -= 4;
    return s;
  };
  const sorted = [...models].sort((a, b) => score(b) - score(a));
  return sorted[0] ? sorted[0].id : '';
}

const SYSTEM = 'You help a Vietnamese learner of English. Always reply with ONE valid JSON object and nothing else.';

/** Gửi 1 prompt, trả về chữ model trả lời — hỗ trợ 3 định dạng API */
async function llmCall(c, prompt, timeout) {
  if (c.format === 'gemini') {
    const path = `/models/${encodeURIComponent(c.model)}:generateContent`;
    let { res, text } = await callApi(c, path, post({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3 }
    }), timeout);
    if (res.status === 400 && !/api[ _-]?key/i.test(text)) {
      ({ res, text } = await callApi(c, path, post({ contents: [{ role: 'user', parts: [{ text: `${SYSTEM}\n\n${prompt}` }] }] }), timeout));
    }
    if (!res.ok) throw httpErr(c, res.status, text);
    return extractText(text);
  }

  if (c.format === 'anthropic') {
    const body = { model: c.model, max_tokens: 1024, system: SYSTEM, temperature: 0.3, messages: [{ role: 'user', content: prompt }] };
    let { res, text } = await callApi(c, '/messages', post(body), timeout);
    if (res.status === 400 && /temperature/i.test(text)) {
      delete body.temperature;
      ({ res, text } = await callApi(c, '/messages', post(body), timeout));
    }
    if (!res.ok) throw httpErr(c, res.status, text);
    return extractText(text);
  }

  // OpenAI-compatible: OpenAI, OpenRouter, Groq, DeepSeek, Ollama, LM Studio, vLLM...
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }];
  // stream:false để router/proxy (9router, LiteLLM…) trả về JSON thường; nếu vẫn stream thì extractText đọc được
  let { res, text } = await callApi(c, '/chat/completions',
    post({ model: c.model, messages, stream: false, temperature: 0.3, response_format: { type: 'json_object' } }), timeout);
  // Một số model / nhà cung cấp không nhận temperature hoặc response_format -> gửi bản tối giản
  if (res.status === 400 || res.status === 422) {
    ({ res, text } = await callApi(c, '/chat/completions', post({ model: c.model, messages, stream: false }), timeout));
  }
  if (!res.ok) throw httpErr(c, res.status, text);
  return extractText(text);
}

function parseJsonLoose(s) {
  s = String(s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(s); } catch (e) { /* thử cắt phần JSON */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* bỏ qua */ }
  }
  throw new AIError('parse', 'Model trả lời không đúng định dạng JSON — thử model khác.');
}

async function llm(prompt, { timeout = 20000 } = {}) {
  const s = await getSecrets();
  if (!llmReady(s.llm)) throw new AIError('no-key', 'Chưa cấu hình mô hình AI.');
  return parseJsonLoose(await llmCall(s.llm, prompt, timeout));
}

async function testLlm(c) {
  const out = parseJsonLoose(await llmCall(c, 'Return ONLY this JSON object: {"ok": true}', 25000));
  if (!out || typeof out !== 'object') throw new AIError('parse', 'Model trả lời không đúng định dạng JSON — thử model khác.');
  return true;
}

const q = (s) => JSON.stringify(String(s || ''));

async function aiFill(en, context) {
  const r = await llm(
`You are an English–Vietnamese learner's dictionary.
Word or phrase: ${q(en)}
Sentence where the learner saw it (may be empty): ${q(context)}
Return ONLY a JSON object:
{"vi": "...", "pos": "...", "ipa": "...", "reading": "...", "example": "...", "example_vi": "..."}
Rules:
- vi: 1 to 3 short Vietnamese meanings separated by ", ". Put the meaning used in the sentence first. No explanations.
- pos: part of speech in English abbreviation: n, v, adj, adv, prep, conj, pron, phr, idiom.
- ipa: General American IPA between slashes.
- reading: approximate pronunciation written with Vietnamese syllables joined by "-", stressed syllable in UPPERCASE. Example: ubiquitous -> "diu-BÍCH-quơ-tợt".
- example: one short, natural English sentence using it (do not copy the given sentence).
- example_vi: Vietnamese translation of example.`);
  return {
    vi: VL.clean(r.vi), pos: VL.clean(r.pos, 20), ipaAI: VL.clean(r.ipa, 80), reading: VL.clean(r.reading, 80),
    example: VL.clean(r.example), exampleVi: VL.clean(r.example_vi)
  };
}

const gradeCache = new Map();
async function aiGrade(w, answer) {
  const ck = w.id + '|' + VL.norm(answer, false) + '|' + w.vi;
  if (gradeCache.has(ck)) return gradeCache.get(ck);
  const r = await llm(
`A Vietnamese learner was asked for the Vietnamese meaning of the English ${w.pos ? `${w.pos} ` : ''}${q(w.en)}.
Saved meaning(s): ${q(w.vi)}.
Learner's answer: ${q(answer)}.
Decide if the answer expresses the same meaning. Synonyms, paraphrases, small typos and missing Vietnamese diacritics are OK. A different meaning, the opposite, or something too vague is NOT OK.
Return ONLY JSON: {"correct": true or false, "reason": "..."}
"reason" is ONE short Vietnamese sentence. If incorrect, the reason must NOT reveal the correct meaning.`, { timeout: 15000 });
  const out = { correct: r.correct === true || r.correct === 'true', reason: VL.clean(r.reason, 200) };
  gradeCache.set(ck, out);
  return out;
}

async function aiCloze(w) {
  const r = await llm(
`Write one natural English sentence (8 to 16 words) that uses ${q(w.en)} with the meaning ${q(w.vi)}.
Return ONLY JSON: {"sentence": "...", "answer": "...", "vi": "..."}
"answer" is the exact form of the word/phrase as it appears in the sentence; "vi" is the Vietnamese translation of the sentence.`, { timeout: 15000 });
  const sentence = VL.clean(r.sentence);
  const answer = VL.clean(r.answer, 120);
  if (!sentence || !answer || !sentence.toLowerCase().includes(answer.toLowerCase())) return null;
  return { sentence, answer, vi: VL.clean(r.vi), ai: true };
}

/* ---------------- Deepgram (thu âm qua offscreen) ---------------- */

async function testDeepgram(key) {
  let res;
  try {
    res = await fetchT(DEEPGRAM_BASE + 'projects', { headers: { Authorization: 'Token ' + key } }, 12000);
  } catch (e) {
    throw new AIError('network', 'Không kết nối được tới Deepgram.');
  }
  if (res.status === 401 || res.status === 403) throw new AIError('auth', 'Key Deepgram không hợp lệ.');
  if (!res.ok) throw new AIError('http', `Deepgram lỗi ${res.status}.`);
  return true;
}

/* ===================== Chọn từ & kiểu câu hỏi ===================== */

/* ---------- Chọn từ kiểu "xáo bài theo vòng" ----------
   Mỗi vòng hỏi đủ mọi từ đang học, mỗi từ đúng 1 lần, rồi mới xáo lại vòng mới.
   Từ hay sai được xếp lên đầu vòng nhiều hơn, nhưng không bị hỏi lặp lại trong cùng vòng,
   và không bao giờ hỏi 1 từ 2 lần liền (trừ khi chỉ còn đúng 1 từ). */

/** Độ khó 0.5–3: tỉ lệ đúng càng thấp càng khó; đang đúng liên tiếp thì giảm bớt */
function difficulty(w) {
  const c = w.correct || 0, x = w.wrong || 0;
  if (!w.lastAsked && !c && !x) return 1.5; // từ mới
  const acc = (c + 1) / (c + x + 2);        // tỉ lệ đúng đã làm mượt
  const d = Math.min(3, Math.max(0.5, (1 - acc) * 3 + 0.5));
  return d / (1 + Math.min(w.streak || 0, 5) * 0.2);
}

/** Xáo có trọng số: từ khó có xu hướng đứng đầu, nhưng vẫn ngẫu nhiên (trọng số được làm dịu để vòng nào cũng khác nhau) */
function weightedOrder(list) {
  return list
    .map((w) => ({ id: w.id, k: Math.pow(Math.random(), 1 / (0.6 + difficulty(w) * 0.35)) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.id);
}

/** Trả về thứ tự từ sẽ hỏi trong vòng hiện tại + hàm ghi nhận từ đã hỏi */
async function quizQueue(words) {
  const active = words.filter((w) => !w.learned);
  if (!active.length) return { order: [], commit: async () => {} };
  const byId = new Map(active.map((w) => [w.id, w]));
  const { quizBag = [], lastQuizWord = null } = await chrome.storage.local.get(['quizBag', 'lastQuizWord']);
  // Bỏ từ đã thuộc / đã xóa khỏi vòng
  let bag = quizBag.filter((id) => byId.has(id));
  if (!bag.length) {
    // Hết vòng -> xáo vòng mới gồm mọi từ đang học; tránh mở đầu bằng đúng từ vừa hỏi
    bag = weightedOrder(active);
    if (bag.length > 1 && bag[0] === lastQuizWord) bag.push(bag.shift());
  } else {
    // Từ mới thêm giữa vòng (chưa hỏi lần nào) -> chen vào vòng hiện tại
    const inBag = new Set(bag);
    for (const w of active) {
      if (!w.lastAsked && !inBag.has(w.id) && w.id !== lastQuizWord) {
        bag.splice(Math.floor(Math.random() * (bag.length + 1)), 0, w.id);
      }
    }
  }
  return {
    order: bag.map((id) => byId.get(id)),
    // Dùng khi thử 1 kiểu câu hỏi cụ thể: ưu tiên từ trong vòng, rồi tới các từ khác
    all: [...bag.map((id) => byId.get(id)), ...shuffle(active.filter((w) => !bag.includes(w.id)))],
    commit: (id) => chrome.storage.local.set({ quizBag: bag.filter((x) => x !== id), lastQuizWord: id })
  };
}

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function buildChoices(w, words) {
  const mine = new Set(VL.meanings(w.vi).map(VL.fold));
  const seen = new Set();
  const others = [];
  for (const x of shuffle(words.filter((x) => x.id !== w.id))) {
    const m = VL.meanings(x.vi)[0];
    const f = VL.fold(m);
    if (!m || mine.has(f) || seen.has(f)) continue;
    seen.add(f);
    others.push(m);
    if (others.length === 3) break;
  }
  if (others.length < 3) return null;
  return shuffle([{ text: VL.meanings(w.vi)[0] || w.vi, correct: true }, ...others.map((t) => ({ text: t, correct: false }))]);
}

function clozeFromSaved(w) {
  for (const s of [w.example, w.context]) {
    const ans = VL.findInSentence(s, w.en);
    if (ans) return { sentence: VL.clean(s), answer: ans, vi: s === w.example ? w.exampleVi || '' : '', ai: false };
  }
  return null;
}

async function feasibleModes(w, words, settings, caps) {
  const out = [];
  const m = settings.modes;
  if (m.meaning) out.push('meaning');
  if (m.reverse) out.push('reverse');
  if (m.choice && buildChoices(w, words)) out.push('choice');
  if (m.cloze && (caps.llm || clozeFromSaved(w))) out.push('cloze');
  if (m.speak && caps.deepgram && caps.mic) out.push('speak');
  return out;
}

async function prepareMode(mode, w, words) {
  if (mode === 'choice') {
    const choices = buildChoices(w, words);
    return choices ? { mode, choices } : null;
  }
  if (mode === 'cloze') {
    const { aiCaps = {} } = await chrome.storage.local.get('aiCaps');
    let cloze = null;
    // Ưu tiên câu do AI tạo mới (đa dạng), lỗi thì dùng câu ví dụ / câu gốc trên Facebook
    if (aiCaps.llm) {
      try { cloze = await aiCloze(w); } catch (e) { cloze = null; }
    }
    if (!cloze) cloze = clozeFromSaved(w);
    return cloze ? { mode, cloze } : null;
  }
  return { mode };
}

async function startQuiz(forcedMode) {
  const { words = [], pendingQuiz } = await chrome.storage.local.get(['words', 'pendingQuiz']);
  if (pendingQuiz) return { ok: true, already: true };
  const queue = await quizQueue(words);
  if (!queue.order.length) {
    await scheduleNext();
    return { ok: false, reason: 'empty' };
  }
  const settings = await getSettings();
  const caps = await refreshCaps();

  let w = queue.order[0];
  let prepared = null;
  if (forcedMode) {
    // Thử 1 kiểu cụ thể: lấy từ đầu tiên trong vòng dùng được kiểu đó
    const tmp = { ...settings, modes: { ...VL.DEFAULT_MODES, meaning: false, [forcedMode]: true } };
    w = null;
    for (const cand of queue.all) {
      if (!(await feasibleModes(cand, words, tmp, caps)).length) continue;
      prepared = await prepareMode(forcedMode, cand, words);
      if (prepared) { w = cand; break; }
    }
    if (!w) return { ok: false, reason: 'mode-unavailable' };
  } else {
    const modes = shuffle(await feasibleModes(w, words, settings, caps));
    for (const m of modes) {
      prepared = await prepareMode(m, w, words);
      if (prepared) break;
    }
    if (!prepared) prepared = { mode: 'meaning' };
  }

  await queue.commit(w.id);
  const fresh = (await chrome.storage.local.get('words')).words || words;
  const i = fresh.findIndex((x) => x.id === w.id);
  if (i >= 0) fresh[i] = { ...fresh[i], lastAsked: Date.now() };
  await chrome.storage.local.set({
    words: fresh,
    pendingQuiz: { wordId: w.id, startedAt: Date.now(), attempts: 0, ...prepared }
  });
  return { ok: true, mode: prepared.mode };
}

async function tick() {
  const d = await VL.getAll();
  if (d.pendingQuiz || !d.settings.enabled) return;
  if (!d.nextQuizAt) return scheduleNext();
  if (Date.now() >= d.nextQuizAt) await startQuiz();
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) serial(tick);
});

/* ===================== Lưu từ ===================== */

async function updateWord(id, fn) {
  const { words = [] } = await chrome.storage.local.get('words');
  const i = words.findIndex((w) => w.id === id);
  if (i < 0) return null;
  const w = { ...words[i] };
  fn(w);
  w.updatedAt = Date.now();
  words[i] = w;
  await chrome.storage.local.set({ words });
  return w;
}

async function addWords(items) {
  const { words = [] } = await chrome.storage.local.get('words');
  const idx = new Map(words.map((w, i) => [VL.key(w.en), i]));
  let added = 0, updated = 0, invalid = 0;
  for (const it of items) {
    const en = VL.clean(it.en, 120), vi = VL.clean(it.vi), note = VL.cleanText(it.note);
    if (!en || !vi) { invalid++; continue; }
    const k = VL.key(en);
    if (idx.has(k)) {
      const i = idx.get(k);
      const w = { ...words[i], en, vi, note: it.note !== undefined ? note : (words[i].note || ''), learned: false, updatedAt: Date.now() };
      for (const f of VL.EXTRA_FIELDS) if (it[f]) w[f] = VL.clean(it[f], f === 'context' ? 400 : 300);
      words[i] = w;
      updated++;
    } else {
      idx.set(k, words.length);
      words.push(VL.newWord({ ...it, en, vi, note }));
      added++;
    }
  }
  if (added || updated) await chrome.storage.local.set({ words });
  if (added) backfillPron();
  return { ok: true, added, updated, invalid };
}

/* ===================== Phát âm & phiên âm ===================== */

const PRON_RETRY_MS = 7 * 24 * 3600 * 1000;
const pronInflight = new Map();
let pronWrite = Promise.resolve();

const wrapIpa = (t) => {
  t = String(t || '').trim();
  if (!t) return '';
  return /^[/[]/.test(t) ? t : `/${t}/`;
};

async function fetchPron(k) {
  let res;
  try {
    res = await fetchT(DICT_API + encodeURIComponent(k), {}, 10000);
  } catch (e) {
    return null;
  }
  if (res.status === 404) return { found: false, fetchedAt: Date.now() };
  if (!res.ok) return null;
  let data;
  try { data = await res.json(); } catch (e) { return null; }
  if (!Array.isArray(data) || !data.length) return { found: false, fetchedAt: Date.now() };

  const phonetics = data.flatMap((e) => (Array.isArray(e.phonetics) ? e.phonetics : []));
  const fallback = (data.find((e) => e.phonetic) || {}).phonetic || (phonetics.find((p) => p.text) || {}).text || '';
  const pick = (re) => phonetics.find((p) => p.audio && re.test(p.audio));
  const us = pick(/-us\.mp3(\?|$)/i);
  const uk = pick(/-uk\.mp3(\?|$)/i);
  const any = phonetics.find((p) => p.audio);
  const fix = (u) => (u && u.startsWith('//') ? 'https:' + u : u || '');
  return {
    found: true,
    fetchedAt: Date.now(),
    ipaUS: wrapIpa((us && us.text) || fallback),
    ipaUK: wrapIpa((uk && uk.text) || fallback),
    audioUS: fix((us || any || {}).audio),
    audioUK: fix((uk || any || {}).audio)
  };
}

async function lookupPron(en) {
  const k = VL.key(en);
  if (!k) return null;
  const { pronCache = {} } = await chrome.storage.local.get('pronCache');
  const c = pronCache[k];
  if (c && (c.found || Date.now() - c.fetchedAt < PRON_RETRY_MS)) return c;
  if (pronInflight.has(k)) return pronInflight.get(k);

  const p = fetchPron(k).then(async (r) => {
    if (!r) return c || null;
    pronWrite = pronWrite.then(async () => {
      const { pronCache: pc = {} } = await chrome.storage.local.get('pronCache');
      pc[k] = r;
      await chrome.storage.local.set({ pronCache: pc });
    }).catch(() => {});
    await pronWrite;
    return r;
  }).finally(() => pronInflight.delete(k));
  pronInflight.set(k, p);
  return p;
}

let backfilling = false, backfillAgain = false;
async function backfillPron() {
  if (backfilling) { backfillAgain = true; return; }
  backfilling = true;
  try {
    const tried = new Set();
    do {
      backfillAgain = false;
      const { words = [], pronCache = {} } = await chrome.storage.local.get(['words', 'pronCache']);
      const todo = [...new Set(words.map((w) => VL.key(w.en)))]
        .filter((k) => k && !pronCache[k] && !tried.has(k)).slice(0, 300);
      for (const k of todo) {
        tried.add(k);
        await lookupPron(k);
        await new Promise((r) => setTimeout(r, 250));
      }
    } while (backfillAgain);
  } finally {
    backfilling = false;
  }
}

// Offscreen document: phát audio + thu âm micro (không bị CSP/permission của Facebook chặn)
let creatingOffscreen = null;
async function ensureOffscreen() {
  if (chrome.runtime.getContexts) {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (ctx.length) return;
  }
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK', 'USER_MEDIA'],
      justification: 'Phát âm từ vựng và thu âm luyện nói'
    }).catch((e) => {
      if (!/single offscreen|already/i.test(String(e))) throw e;
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function toOffscreen(msg) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'vl-offscreen', ...msg });
}

async function playAudio(url, rate) {
  try {
    const r = await toOffscreen({ type: 'play', url, rate });
    return !!(r && r.ok);
  } catch (e) {
    return false;
  }
}

let voiceCache = null;
async function pickVoice(lang) {
  if (!voiceCache) voiceCache = await new Promise((r) => chrome.tts.getVoices((v) => r(v || [])));
  const cands = voiceCache.filter((v) => (v.lang || '').toLowerCase() === lang.toLowerCase());
  const best = cands.find((v) => /natural|online|neural/i.test(v.voiceName || '')) || cands[0];
  return best && best.voiceName;
}

async function ttsSpeak(text, accent, slow) {
  if (!chrome.tts) return false;
  const lang = accent === 'uk' ? 'en-GB' : 'en-US';
  const opts = { lang, rate: slow ? 0.6 : 0.95 };
  try {
    const voiceName = await pickVoice(lang);
    if (voiceName) opts.voiceName = voiceName;
  } catch (e) { /* bỏ qua */ }
  return new Promise((resolve) => {
    chrome.tts.speak(text, opts, () => resolve(!chrome.runtime.lastError));
  });
}

/* ===================== Xử lý tin nhắn ===================== */

/** Ghép cấu hình từ form. Để trống API key = dùng lại key đã lưu (nếu vẫn cùng Base URL) */
async function formLlm(m) {
  const s = await getSecrets();
  const c = normLlm({ preset: m.preset, format: m.format, baseUrl: m.baseUrl, model: m.model, apiKey: m.key });
  if (!c.apiKey && s.llm.apiKey && s.llm.baseUrl === c.baseUrl) c.apiKey = s.llm.apiKey;
  return c;
}

const fail = (e) => ({ ok: false, error: (e && e.message) || String(e), code: (e && e.code) || 'error' });

const handlers = {
  async addWord(m) {
    const item = { en: m.en, vi: m.vi, note: m.note };
    for (const f of VL.EXTRA_FIELDS) if (m[f]) item[f] = m[f];
    const r = await addWords([item]);
    if (r.invalid) return { ok: false, error: 'Cần nhập cả từ tiếng Anh và nghĩa tiếng Việt.' };
    return { ok: true, status: r.updated ? 'updated' : 'added' };
  },

  addWords: (m) => addWords(Array.isArray(m.items) ? m.items : []),

  async addMeaning(m) {
    const meaning = VL.clean(m.meaning, 80);
    if (!meaning) return { ok: false };
    const w = await updateWord(m.wordId, (w) => {
      if (!VL.check(meaning, w.vi, false)) w.vi = VL.clean(`${w.vi}, ${meaning}`);
    });
    return { ok: !!w, word: w };
  },

  async quizWrong(m) {
    await updateWord(m.wordId, (w) => { w.wrong = (w.wrong || 0) + 1; w.streak = 0; });
    const { pendingQuiz } = await chrome.storage.local.get('pendingQuiz');
    if (pendingQuiz && pendingQuiz.wordId === m.wordId) {
      await chrome.storage.local.set({ pendingQuiz: { ...pendingQuiz, attempts: (pendingQuiz.attempts || 0) + 1 } });
    }
    return { ok: true };
  },

  async quizCorrect(m) {
    const s = await getSettings();
    let autoLearned = false;
    const word = await updateWord(m.wordId, (w) => {
      w.correct = (w.correct || 0) + 1;
      w.streak = (w.streak || 0) + 1;
      if (s.autoLearnStreak > 0 && w.streak >= s.autoLearnStreak) { w.learned = true; autoLearned = true; }
    });
    return { ok: true, word, autoLearned };
  },

  async quizFinish(m) {
    if (m.markLearned) await updateWord(m.wordId, (w) => { w.learned = true; });
    const { pendingQuiz } = await chrome.storage.local.get('pendingQuiz');
    if (pendingQuiz && pendingQuiz.wordId === m.wordId) await chrome.storage.local.set({ pendingQuiz: null });
    await scheduleNext();
    return { ok: true };
  },

  /** Đổi sang gõ nghĩa (vd micro hỏng) — vẫn phải trả lời mới mở khóa */
  async quizSwitch(m) {
    const { pendingQuiz } = await chrome.storage.local.get('pendingQuiz');
    if (pendingQuiz && pendingQuiz.wordId === m.wordId) {
      await chrome.storage.local.set({ pendingQuiz: { wordId: pendingQuiz.wordId, startedAt: pendingQuiz.startedAt, attempts: 0, mode: 'meaning' } });
    }
    return { ok: true };
  },

  async quizSkip() {
    await chrome.storage.local.set({ pendingQuiz: null });
    await scheduleNext();
    return { ok: true };
  },

  quizNow: (m) => startQuiz(m.mode),

  async settingsChanged() {
    const { pendingQuiz } = await chrome.storage.local.get('pendingQuiz');
    if (!pendingQuiz) await scheduleNext();
    return { ok: true };
  },

  /* ---- phát âm ---- */
  async getPron(m) {
    const s = await getSettings();
    const p = await lookupPron(m.en);
    let { ipa, audio } = VL.pronFor(p, s.accent);
    const { words = [] } = await chrome.storage.local.get('words');
    const w = words.find((x) => VL.key(x.en) === VL.key(m.en));
    // Ưu tiên phiên âm bạn tự nhập > từ điển > AI gợi ý
    if (w && w.ipaCustom) ipa = w.ipaCustom;
    else if (!ipa && w && w.ipaAI) ipa = w.ipaAI;
    return { ok: true, ipa, reading: (w && w.reading) || '', hasAudio: !!audio, found: !!(p && p.found) };
  },

  async speak(m) {
    const en = VL.clean(m.en, 120);
    if (!en) return { ok: false };
    const s = await getSettings();
    const { audio } = VL.pronFor(await lookupPron(en), s.accent);
    if (audio && (await playAudio(audio, m.slow ? 0.7 : 1))) return { ok: true, via: 'audio', slow: !!m.slow };
    const ok = await ttsSpeak(en, s.accent, m.slow);
    return { ok, via: ok ? 'tts' : 'none', slow: !!m.slow };
  },

  async backfillPron() {
    backfillPron();
    return { ok: true };
  },

  /* ---- AI: cấu hình ---- */
  getCaps: () => refreshCaps(),

  async getAiConfig() {
    const s = await getSecrets();
    const mask = (k) => (k ? `${k.slice(0, 4)}••••${k.slice(-4)}` : '');
    const c = s.llm;
    return {
      ok: true,
      llm: { preset: c.preset, format: c.format, baseUrl: c.baseUrl, model: c.model, hasKey: !!c.apiKey, masked: mask(c.apiKey),
        ready: llmReady(c), needsKey: c.baseUrl ? needsKey(c) : true, name: VL.llmName(c) },
      deepgram: { set: !!s.deepgramKey, masked: mask(s.deepgramKey), model: s.deepgramModel }
    };
  },

  /** Liệt kê model của nhà cung cấp đang nhập trong form (để gợi ý) */
  async listLlmModels(m) {
    try {
      const c = await formLlm(m);
      if (!c.baseUrl) throw new AIError('config', 'Base URL không hợp lệ (phải bắt đầu bằng http:// hoặc https://).');
      if (needsKey(c) && !c.apiKey) throw new AIError('no-key', 'Nhập API key trước đã.');
      const models = await listModels(c);
      return { ok: true, models, suggested: c.format === 'gemini' ? pickDefaultModel(models) : '' };
    } catch (e) {
      return fail(e);
    }
  },

  /** Lưu cấu hình AI sau khi gọi thử thành công */
  async saveLlm(m) {
    try {
      const c = await formLlm(m);
      if (!c.baseUrl) throw new AIError('config', 'Base URL không hợp lệ (phải bắt đầu bằng http:// hoặc https://).');
      if (needsKey(c) && !c.apiKey) throw new AIError('no-key', 'Nhập API key trước đã.');
      let models = null;
      if (!c.model) {
        models = await listModels(c);
        if (c.format === 'gemini') c.model = pickDefaultModel(models);
        if (!c.model) return { ok: false, code: 'need-model', error: 'Chọn hoặc gõ tên model rồi bấm lưu lại.', models };
      }
      await testLlm(c);
      await saveSecrets({ llm: c });
      await refreshCaps();
      return { ok: true, model: c.model, name: VL.llmName(c), models };
    } catch (e) {
      return fail(e);
    }
  },

  async clearLlm() {
    await saveSecrets({ llm: null });
    await refreshCaps();
    return { ok: true };
  },

  async saveDeepgram(m) {
    const s = await getSecrets();
    const key = m.key !== undefined ? VL.clean(m.key, 200) : s.deepgramKey;
    const model = VL.clean(m.model || s.deepgramModel || 'nova-3', 40);
    if (!key) {
      await saveSecrets({ deepgramKey: '' });
      await refreshCaps();
      return { ok: true, cleared: true };
    }
    try {
      await testDeepgram(key);
      await saveSecrets({ deepgramKey: key, deepgramModel: model });
      await refreshCaps();
      return { ok: true, model };
    } catch (e) {
      return fail(e);
    }
  },

  setMic: (m) => refreshCaps({ mic: !!m.granted }),

  /* ---- AI: dùng ---- */
  async aiFill(m) {
    try {
      return { ok: true, ...(await aiFill(VL.clean(m.en, 120), VL.clean(m.context, 400))) };
    } catch (e) {
      return fail(e);
    }
  },

  async aiGrade(m) {
    const { words = [] } = await chrome.storage.local.get('words');
    const w = words.find((x) => x.id === m.wordId);
    if (!w) return { ok: false, error: 'Không tìm thấy từ.' };
    try {
      return { ok: true, ...(await aiGrade(w, VL.clean(m.answer, 200))) };
    } catch (e) {
      return fail(e);
    }
  },

  async recStart(m) {
    const s = await getSecrets();
    if (!s.deepgramKey) return { ok: false, error: 'no-key' };
    try {
      const r = await toOffscreen({ type: 'recStart', maxMs: m.maxMs || 8000 });
      if (r && r.error === 'mic-denied') await refreshCaps({ mic: false });
      return r || { ok: false, error: 'unknown' };
    } catch (e) {
      return { ok: false, error: 'unknown', detail: String(e) };
    }
  },

  async recStop(m) {
    const s = await getSecrets();
    try {
      return (await toOffscreen({
        type: 'recStop', key: s.deepgramKey, model: s.deepgramModel || 'nova-3',
        lang: m.lang === 'vi' ? 'vi' : 'en', base: DEEPGRAM_BASE
      })) || { ok: false, error: 'unknown' };
    } catch (e) {
      return { ok: false, error: 'unknown', detail: String(e) };
    }
  },

  async recCancel() {
    try { await toOffscreen({ type: 'recCancel' }); } catch (e) {}
    return { ok: true };
  }
};

// Việc chỉ đọc / gọi mạng thì chạy song song, không chặn việc chấm bài
const PARALLEL = new Set(['getPron', 'speak', 'backfillPron', 'getCaps', 'getAiConfig', 'listLlmModels', 'saveLlm', 'clearLlm', 'saveDeepgram',
  'aiFill', 'aiGrade', 'recStart', 'recStop', 'recCancel']);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'vl-offscreen') return false;
  const fn = handlers[msg.type];
  if (!fn) return false;
  const run = () => fn(msg, sender);
  (PARALLEL.has(msg.type) ? run() : serial(run))
    .then(sendResponse, (e) => sendResponse(fail(e)));
  return true;
});

/* ===================== Lưu từ từ menu chuột phải / phím tắt ===================== */

async function openSaveBox(tabId, text) {
  const msg = { type: 'openSaveBox', text };
  try {
    await chrome.tabs.sendMessage(tabId, msg);
    return;
  } catch (e) { /* tab chưa có content script */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['common.js', 'content.js'] });
    await chrome.tabs.sendMessage(tabId, msg);
    return;
  } catch (e) { /* trang không cho chạy script */ }
  try {
    if (text) await chrome.storage.local.set({ draftWord: VL.clean(text, 120) });
    await chrome.action.openPopup();
  } catch (e) { /* bỏ qua */ }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'vl-save' && tab && tab.id >= 0) openSaveBox(tab.id, info.selectionText);
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== 'save-selection') return;
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id >= 0) openSaveBox(tab.id, null);
});
