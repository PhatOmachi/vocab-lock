/* Trang ẩn của extension: phát audio phát âm + thu âm micro gửi Deepgram */
let audio = null;
let rec = null, stream = null, chunks = [], stopped = null, safetyTimer = null;

function cleanupRec() {
  clearTimeout(safetyTimer);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  rec = null;
}

function pickMime() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

async function recStart(maxMs) {
  if (rec) cleanupRec();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    return { ok: false, error: /NotAllowed|Permission|Security/i.test(e.name + e.message) ? 'mic-denied' : 'mic-error', detail: String(e) };
  }
  chunks = [];
  const mime = pickMime();
  rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  stopped = new Promise((r) => { rec.onstop = r; });
  rec.start();
  // An toàn: tự dừng nếu content script không gọi dừng
  safetyTimer = setTimeout(() => { if (rec && rec.state === 'recording') rec.stop(); }, maxMs || 8000);
  return { ok: true };
}

async function transcribe(blob, { key, model, lang, base }) {
  const type = (blob.type || 'audio/webm').split(';')[0];
  const call = (mdl) => fetch(`${base}listen?model=${encodeURIComponent(mdl)}&language=${encodeURIComponent(lang)}&smart_format=true`, {
    method: 'POST',
    headers: { Authorization: 'Token ' + key, 'Content-Type': type },
    body: blob
  });
  let res;
  try {
    res = await call(model);
    // Model/ngôn ngữ chưa hỗ trợ -> thử model cũ hơn
    if (res.status === 400 && model !== 'nova-2') res = await call('nova-2');
  } catch (e) {
    return { ok: false, error: 'network' };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'auth' };
  if (!res.ok) return { ok: false, error: 'http', detail: `${res.status} ${(await res.text()).slice(0, 200)}` };
  const j = await res.json();
  const alt = (((j.results || {}).channels || [])[0] || {}).alternatives?.[0] || {};
  return {
    ok: true,
    transcript: alt.transcript || '',
    confidence: alt.confidence || 0,
    words: (alt.words || []).map((w) => ({ word: w.word, confidence: w.confidence }))
  };
}

async function recStop(opts) {
  if (!rec) return { ok: false, error: 'not-recording' };
  if (rec.state === 'recording') rec.stop();
  await stopped;
  const type = (rec && rec.mimeType) || 'audio/webm';
  const blob = new Blob(chunks, { type });
  cleanupRec();
  if (blob.size < 800) return { ok: false, error: 'empty' };
  return transcribe(blob, opts);
}

chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
  if (!m || m.target !== 'vl-offscreen') return false;

  if (m.type === 'play') {
    try { if (audio) audio.pause(); } catch (e) {}
    audio = new Audio(m.url);
    audio.preservesPitch = true;
    audio.playbackRate = m.rate || 1;
    audio.play().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (m.type === 'recStart') {
    recStart(m.maxMs).then(sendResponse);
    return true;
  }
  if (m.type === 'recStop') {
    recStop(m).then(sendResponse, (e) => sendResponse({ ok: false, error: 'unknown', detail: String(e) }));
    return true;
  }
  if (m.type === 'recCancel') {
    try { if (rec && rec.state === 'recording') rec.stop(); } catch (e) {}
    cleanupRec();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
