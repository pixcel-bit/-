// ─── localStorage ヘルパー ────────────────────────────────────────────────
const LS = {
  get:     (k, d = '')   => localStorage.getItem(k) ?? d,
  set:     (k, v)        => localStorage.setItem(k, v),
  getJSON: (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  setJSON: (k, v)        => localStorage.setItem(k, JSON.stringify(v)),
  del:     (k)           => localStorage.removeItem(k),
};

const S = {
  get apiKey()        { return LS.get('nr_api_key'); },
  set apiKey(v)       { LS.set('nr_api_key', v); },
  get hasOnboarded()  { return !!LS.get('nr_onboarded'); },
  markOnboarded()     { LS.set('nr_onboarded', '1'); },

  get settings() {
    return LS.getJSON('nr_settings', {
      categories:      ['総合'],
      maxItems:        15,
      focusKeywords:   '',
      excludeKeywords: '',
      length:          'standard',
      tone:            'casual',
      speechRate:      1.0,
      customIntro:     '',
    });
  },
  saveSettings(cfg) { LS.setJSON('nr_settings', cfg); },

  getCachedBroadcast(date) { return LS.getJSON(`nr_broadcast_${date}`); },
  setCachedBroadcast(date, data) { LS.setJSON(`nr_broadcast_${date}`, data); },
  delCachedBroadcast(date) { LS.del(`nr_broadcast_${date}`); },
};

function $(id) { return document.getElementById(id); }

// ─── 起動 ─────────────────────────────────────────────────────────────────
async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (!S.hasOnboarded) {
    showScreen('onboarding');
    return;
  }
  showScreen('main');
  populateSettings();
  await loadToday();
}

// ─── 画面切り替え ─────────────────────────────────────────────────────────
function showScreen(name) {
  $('screen-onboarding').style.display = name === 'onboarding' ? '' : 'none';
  $('screen-main').style.display       = name === 'main'       ? '' : 'none';
}

function switchTab(name) {
  ['home', 'chat', 'archive', 'settings'].forEach(t => {
    $(`tab-${t}`).style.display = t === name ? '' : 'none';
    document.querySelector(`.tab-btn[data-tab="${t}"]`).classList.toggle('active', t === name);
  });
  if (name === 'archive') loadArchive();
}

// ─── オンボーディング ─────────────────────────────────────────────────────
function onboardingSubmit() {
  const key = $('onboarding-key').value.trim();
  if (key) S.apiKey = key;
  S.markOnboarded();
  showScreen('main');
  populateSettings();
  loadToday();
}

// ─── 今日の放送 ───────────────────────────────────────────────────────────
async function loadToday() {
  setHomeState('loading');
  const today = todayStr();

  const cached = S.getCachedBroadcast(today);
  if (cached) { showPlayer(cached); return; }

  try {
    const newsData = await fetchJSON(`data/${today}-news.json`);
    await generateAndShowBroadcast(newsData, today, false);
  } catch {
    // 今日分がなければ昨日を表示
    try {
      const yesterday = offsetDate(-1);
      const cachedY = S.getCachedBroadcast(yesterday);
      if (cachedY) { showPlayer(cachedY, true); return; }
      const newsData = await fetchJSON(`data/${yesterday}-news.json`);
      await generateAndShowBroadcast(newsData, yesterday, true);
    } catch {
      setHomeState('empty');
    }
  }
}

async function regenerateToday() {
  stopMainSpeak();
  S.delCachedBroadcast(todayStr());
  await loadToday();
}

async function generateAndShowBroadcast(newsData, date, isYesterday) {
  if (!S.apiKey) {
    setHomeState('error');
    $('home-error-msg').textContent = 'APIキーが設定されていません。設定画面から入力してください。';
    return;
  }

  setHomeState('generating');

  try {
    const cfg = S.settings;

    let items = newsData.news_items || [];

    // カテゴリフィルタ
    if (cfg.categories && cfg.categories.length > 0) {
      const filtered = items.filter(n => cfg.categories.includes(n.category));
      if (filtered.length > 0) items = filtered;
    }

    // 除外キーワード
    if (cfg.excludeKeywords) {
      const excl = cfg.excludeKeywords.split(',').map(s => s.trim()).filter(Boolean);
      if (excl.length) items = items.filter(n => !excl.some(kw => n.title.includes(kw) || (n.summary || '').includes(kw)));
    }

    // 優先キーワード（先頭へ）
    if (cfg.focusKeywords) {
      const focus = cfg.focusKeywords.split(',').map(s => s.trim()).filter(Boolean);
      if (focus.length) {
        const hi  = items.filter(n =>  focus.some(kw => n.title.includes(kw) || (n.summary || '').includes(kw)));
        const lo  = items.filter(n => !focus.some(kw => n.title.includes(kw) || (n.summary || '').includes(kw)));
        items = [...hi, ...lo];
      }
    }

    items = items.slice(0, cfg.maxItems || 15);
    if (!items.length) items = (newsData.news_items || []).slice(0, 5);

    $('home-gen-msg').textContent = 'AIが放送原稿を作成中...';

    const script = await generateScript(items, cfg);

    const broadcast = { date, news_items: items, script, generated_at: new Date().toISOString() };
    S.setCachedBroadcast(date, broadcast);
    showPlayer(broadcast, isYesterday);
  } catch (e) {
    setHomeState('error');
    $('home-error-msg').textContent = e.message;
  }
}

async function generateScript(items, cfg) {
  const lengthMap = { short: '約3分（400字程度）', standard: '約5分（800字程度）', long: '約10分（1600字程度）' };
  const toneMap   = { casual: 'カジュアルで親しみやすい', professional: '落ち着いたプロフェッショナルな', cheerful: '元気で明るい朝らしい' };

  const intro = cfg.customIntro ? `冒頭に必ず次の文を入れてください: 「${cfg.customIntro}」\n\n` : '';

  const system = `あなたはプロのラジオパーソナリティです。
以下のニュース情報をもとに、${lengthMap[cfg.length] || lengthMap.standard}のラジオ放送原稿を作成してください。
トーンは${toneMap[cfg.tone] || toneMap.casual}口調です。
${intro}ルール:
- です・ます調で自然な話し言葉
- 難しい用語は噛み砕いて説明
- 出力は原稿テキストのみ（見出し・箇条書き・記号・マークダウン不要）
- 数字は日本語の読みに合わせて表記（例: 2025年→二〇二五年、1兆円→一兆円）
- 英語略語は初出時にカナ読みを添える（例: AI（エーアイ）、GDP（ジーディーピー））
- 文末は必ず「。」で終わらせ、読み上げ時に自然な間が取れるようにする`;

  const newsText = items.map((n, i) => `${i + 1}. 【${n.category}】${n.title}\n${n.summary || ''}`).join('\n\n');

  return callClaude(system, `今日のニュース一覧:\n${newsText}`);
}

function setHomeState(state) {
  ['loading', 'generating', 'error', 'player', 'empty'].forEach(s => {
    const el = $(`home-${s}`);
    if (el) el.style.display = s === state ? '' : 'none';
  });
}

// ─── メインプレイヤー（speechSynthesis） ──────────────────────────────────
let mainChunks   = [];
let mainChunkIdx = 0;
let mainSpeaking = false;
let mainSpeed    = 1.0;

function showPlayer(broadcast, isYesterday = false) {
  setHomeState('player');

  const d = new Date(broadcast.date + 'T00:00:00');
  $('player-date').textContent  = d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }) + (isYesterday ? '　（昨日）' : '');
  $('player-count').textContent = `${(broadcast.news_items || []).length}件のニュース`;
  $('home-script').textContent  = broadcast.script || '';

  // 速度ボタン状態を設定
  mainSpeed = parseFloat(S.settings.speechRate || 1.0);
  document.querySelectorAll('.speed-row .speed-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.textContent) === mainSpeed);
  });

  // 原稿をチャンクに分割
  const script = broadcast.script || '';
  mainChunks   = script.match(/[^。！？\n]+[。！？\n]?/g) || (script ? [script] : []);
  mainChunkIdx = 0;
  mainSpeaking = false;

  $('play-btn').textContent          = '▶';
  $('tts-progress-fill').style.width = '0%';
  $('main-chunk-info').textContent   = 'タップして再生';
  $('main-duration').textContent     = `全${mainChunks.length}文`;

  // ニュース一覧
  const list = $('home-news-list');
  list.innerHTML = '';
  (broadcast.news_items || []).forEach(item => {
    const li  = document.createElement('li');
    li.className = 'news-item';
    li.innerHTML = `
      <div class="news-item-meta">
        <span class="news-cat">${escHtml(item.category || '')}</span>
        <span class="news-src">${escHtml(item.source || '')}</span>
      </div>
      <div class="news-title"><a href="${escHtml(item.url || '#')}" target="_blank" rel="noopener">${escHtml(item.title || '')}</a></div>
      <div class="news-summary">${escHtml(item.summary || '')}</div>`;
    list.appendChild(li);
  });
}

function toggleMainSpeak() {
  if (mainSpeaking) {
    stopMainSpeak();
  } else {
    if (mainChunkIdx >= mainChunks.length) mainChunkIdx = 0;
    startMainSpeak();
  }
}

function startMainSpeak() {
  if (!window.speechSynthesis || mainChunks.length === 0) {
    showToast('このブラウザは読み上げに対応していません');
    return;
  }
  mainSpeaking = true;
  $('play-btn').textContent = '⏸';
  speakMainChunk();
}

function speakMainChunk() {
  if (!mainSpeaking || mainChunkIdx >= mainChunks.length) {
    mainSpeaking = false;
    $('play-btn').textContent          = '▶';
    $('main-chunk-info').textContent   = mainChunkIdx >= mainChunks.length ? '再生完了' : 'タップして再生';
    $('tts-progress-fill').style.width = mainChunkIdx >= mainChunks.length ? '100%' : '0%';
    if (mainChunkIdx >= mainChunks.length) mainChunkIdx = 0;
    return;
  }

  const pct = mainChunks.length ? (mainChunkIdx / mainChunks.length) * 100 : 0;
  $('tts-progress-fill').style.width = pct + '%';
  $('main-chunk-info').textContent   = `${mainChunkIdx + 1} / ${mainChunks.length}`;

  const utt   = new SpeechSynthesisUtterance(mainChunks[mainChunkIdx]);
  utt.lang    = 'ja-JP';
  utt.rate    = mainSpeed;
  const voice = resolveVoice(S.settings.voiceName);
  if (voice) utt.voice = voice;
  const next  = () => { if (mainSpeaking) { mainChunkIdx++; setTimeout(speakMainChunk, 150); } };
  utt.onend   = next;
  utt.onerror = next;
  window.speechSynthesis.speak(utt);
}

function stopMainSpeak() {
  mainSpeaking = false;
  window.speechSynthesis.cancel();
  const btn = $('play-btn');
  if (btn) btn.textContent = '▶';
}

function setMainSpeed(rate, btn) {
  mainSpeed = rate;
  btn.closest('.speed-row').querySelectorAll('.speed-btn')
     .forEach(b => b.classList.toggle('active', b === btn));
  // 再生中なら即反映
  if (mainSpeaking) { window.speechSynthesis.cancel(); speakMainChunk(); }
  // 設定保存
  const cfg = S.settings; cfg.speechRate = rate; S.saveSettings(cfg);
}

// ─── 履歴 ────────────────────────────────────────────────────────────────
async function loadArchive() {
  const list = $('archive-list');
  list.innerHTML = '<li class="list-loading">読み込み中...</li>';
  try {
    const index = await fetchJSON(`data/index.json?t=${Date.now()}`);
    if (!index.length) { list.innerHTML = '<li class="list-loading">まだ放送がありません</li>'; return; }
    list.innerHTML = '';
    index.forEach(b => {
      const d      = new Date(b.date + 'T00:00:00');
      const cached = S.getCachedBroadcast(b.date);
      const li     = document.createElement('li');
      li.className  = 'archive-item';
      li.innerHTML  = `
        <div>
          <div class="archive-date">${d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}</div>
          <div class="archive-meta">${b.news_count}件${cached ? ' · 生成済み' : ''}</div>
        </div>
        <span class="archive-play">▶</span>`;
      li.onclick = () => { switchTab('home'); loadDateBroadcast(b.date); };
      list.appendChild(li);
    });
  } catch (e) {
    list.innerHTML = `<li class="list-loading">読み込み失敗: ${escHtml(e.message)}</li>`;
  }
}

async function loadDateBroadcast(date) {
  setHomeState('loading');
  stopMainSpeak();

  const cached = S.getCachedBroadcast(date);
  if (cached) { showPlayer(cached); return; }

  try {
    const newsData = await fetchJSON(`data/${date}-news.json`);
    await generateAndShowBroadcast(newsData, date, false);
  } catch (e) {
    setHomeState('error');
    $('home-error-msg').textContent = e.message;
  }
}

// ─── チャット ─────────────────────────────────────────────────────────────
const CHAT_SYSTEM = `あなたはプロのラジオパーソナリティです。
ユーザーのリクエストに応じて、ニュース原稿を作成してください。
提供されたニュース情報を参考に、3〜5分で読める自然な話し言葉のラジオ原稿を書いてください。
ルール:
- です・ます調で自然な話し言葉
- 難しい用語は噛み砕いて説明
- 出力は原稿テキストのみ（見出し・説明文・記号・マークダウン不要）
- 数字は日本語の読みに合わせて表記（例: 2025年→二〇二五年、1兆円→一兆円）
- 英語略語は初出時にカナ読みを添える（例: AI（エーアイ））
- 文末は必ず「。」で終わらせる`;

let chatSpeaking    = false;
let currentChatBtn  = null;

function fillExample(btn) {
  $('chat-input').value = btn.textContent;
  autoResize($('chat-input'));
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

async function sendChat() {
  const input   = $('chat-input');
  const sendBtn = document.querySelector('.send-btn');
  const text    = input.value.trim();
  if (!text) return;

  if (!S.apiKey) {
    showToast('設定画面で Anthropic API キーを入力してください');
    switchTab('settings');
    return;
  }

  input.value = '';
  autoResize(input);
  sendBtn.disabled = true;

  const messages = $('chat-messages');
  messages.querySelector('.chat-hint')?.remove();

  messages.appendChild(makeBubble('user', text));
  scrollChat();

  const typing = makeBubble('typing');
  messages.appendChild(typing);
  scrollChat();

  try {
    let newsContext = '';
    try {
      const today  = todayStr();
      const cached = S.getCachedBroadcast(today);
      if (cached) {
        newsContext = cached.news_items.map(n => `【${n.category}】${n.title}: ${n.summary || ''}`).join('\n');
      } else {
        const nd = await fetchJSON(`data/${today}-news.json`);
        newsContext = nd.news_items.map(n => `【${n.category}】${n.title}: ${n.summary || ''}`).join('\n');
      }
    } catch { /* ニュースなくても続行 */ }

    const userMsg = newsContext
      ? `今日のニュース情報:\n${newsContext}\n\nユーザーのリクエスト: ${text}`
      : `ユーザーのリクエスト: ${text}（ニュースデータが取得できませんでした。一般的な内容で応答してください）`;

    const script = await callClaude(CHAT_SYSTEM, userMsg);
    typing.remove();
    appendChatAIBubble(messages, script);
    scrollChat();
  } catch (e) {
    typing.remove();
    messages.appendChild(makeBubble('error', `⚠️ ${escHtml(e.message)}`));
    scrollChat();
  } finally {
    sendBtn.disabled = false;
  }
}

function makeBubble(type, text = '') {
  const div = document.createElement('div');
  if (type === 'user') {
    div.className   = 'bubble-user';
    div.textContent = text;
  } else if (type === 'typing') {
    div.className = 'bubble-typing';
    div.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  } else if (type === 'error') {
    div.className = 'bubble-ai';
    div.innerHTML = `<div class="bubble-ai-inner">${text}</div>`;
  }
  return div;
}

function appendChatAIBubble(container, script) {
  const div = document.createElement('div');
  div.className = 'bubble-ai';
  div.innerHTML = `
    <div class="bubble-ai-inner">カスタムニュースを生成しました</div>
    <div class="chat-player">
      <div class="chat-player-controls">
        <button class="play-btn-sm">▶ 読み上げ</button>
        <span class="tts-note">端末の音声で再生</span>
      </div>
    </div>
    <details class="chat-script-detail">
      <summary>原稿を読む</summary>
      <div class="script-text">${escHtml(script)}</div>
    </details>`;
  container.appendChild(div);
  div.querySelector('.play-btn-sm').addEventListener('click', function () {
    toggleChatSpeak(this, script);
  });
}

function toggleChatSpeak(btn, script) {
  if (chatSpeaking && currentChatBtn === btn) {
    window.speechSynthesis.cancel();
    chatSpeaking = false;
    btn.textContent = '▶ 読み上げ';
    currentChatBtn = null;
    return;
  }

  if (chatSpeaking) {
    window.speechSynthesis.cancel();
    if (currentChatBtn) currentChatBtn.textContent = '▶ 読み上げ';
  }

  if (!window.speechSynthesis) { showToast('このブラウザは読み上げに対応していません'); return; }

  chatSpeaking   = true;
  currentChatBtn = btn;
  btn.textContent = '⏸ 停止';

  const chunks = script.match(/[^。！？\n]+[。！？\n]?/g) || [script];
  const cfg    = S.settings;
  const rate   = parseFloat(cfg.speechRate || 1.0);
  const voice  = resolveVoice(cfg.voiceName);
  let i = 0;

  (function speakNext() {
    if (!chatSpeaking || i >= chunks.length) {
      chatSpeaking = false;
      if (currentChatBtn === btn) { btn.textContent = '▶ 読み上げ'; currentChatBtn = null; }
      return;
    }
    const utt   = new SpeechSynthesisUtterance(chunks[i]);
    utt.lang    = 'ja-JP';
    utt.rate    = rate;
    if (voice) utt.voice = voice;
    utt.onend   = () => { i++; setTimeout(speakNext, 150); };
    utt.onerror = () => { i++; setTimeout(speakNext, 150); };
    window.speechSynthesis.speak(utt);
  })();
}

function scrollChat() {
  const m = $('chat-messages');
  m.scrollTop = m.scrollHeight;
}

// ─── 設定 ─────────────────────────────────────────────────────────────────
function populateSettings() {
  const cfg = S.settings;
  $('setting-key').value = S.apiKey;

  document.querySelectorAll('.cat-checks input[type=checkbox]').forEach(cb => {
    cb.checked = (cfg.categories || []).includes(cb.value);
  });

  const max = cfg.maxItems ?? 15;
  $('setting-max').value           = max;
  $('setting-max-val').textContent = max + '件';

  $('setting-focus').value   = cfg.focusKeywords   || '';
  $('setting-exclude').value = cfg.excludeKeywords || '';
  $('setting-length').value  = cfg.length          || 'standard';
  $('setting-tone').value    = cfg.tone            || 'casual';
  $('setting-rate').value    = String(cfg.speechRate ?? 1.0);
  $('setting-intro').value   = cfg.customIntro     || '';
  populateVoiceSelector();
  if (cfg.voiceName) $('setting-voice').value = cfg.voiceName;
}

function saveSettings() {
  const key = $('setting-key').value.trim();
  if (key) S.apiKey = key;

  S.saveSettings({
    categories:      [...document.querySelectorAll('.cat-checks input:checked')].map(cb => cb.value),
    maxItems:        parseInt($('setting-max').value, 10),
    focusKeywords:   $('setting-focus').value.trim(),
    excludeKeywords: $('setting-exclude').value.trim(),
    length:          $('setting-length').value,
    tone:            $('setting-tone').value,
    speechRate:      parseFloat($('setting-rate').value),
    customIntro:     $('setting-intro').value.trim(),
    voiceName:       $('setting-voice').value,
  });

  showToast('設定を保存しました ✓');
}

// ─── Claude API 直接呼び出し ─────────────────────────────────────────────
async function callClaude(system, userMsg) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':                          'application/json',
      'x-api-key':                             S.apiKey,
      'anthropic-version':                     '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5',
      max_tokens: 2048,
      system,
      messages:   [{ role: 'user', content: userMsg }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `APIエラー (${res.status})`);
  }

  const data = await res.json();
  return data.content[0].text;
}

// ─── ユーティリティ ───────────────────────────────────────────────────────
function resolveVoice(name) {
  if (!name) return null;
  return speechSynthesis.getVoices().find(v => v.name === name) || null;
}

function toggleVis(id) {
  const el = $(id);
  el.type = el.type === 'password' ? 'text' : 'password';
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function todayStr() { return new Date().toLocaleDateString('sv'); }

function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('sv');
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── 音声リスト ───────────────────────────────────────────────────────────
function populateVoiceSelector() {
  const sel = $('setting-voice');
  if (!sel) return;
  const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('ja'));
  if (!voices.length) return;

  // 既存オプションを保持しつつ重複追加を防ぐ
  sel.innerHTML = '<option value="">システムデフォルト</option>';
  voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value       = v.name;
    opt.textContent = v.name + (v.localService ? '' : ' 〔オンライン〕');
    sel.appendChild(opt);
  });

  const saved = S.settings.voiceName || '';
  if (saved) sel.value = saved;
}

// Chrome系はvoiceschangedイベント待ち、Safari系は同期で取得可
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener('voiceschanged', populateVoiceSelector);
  populateVoiceSelector();
}

// ─── 起動 ─────────────────────────────────────────────────────────────────
init();
