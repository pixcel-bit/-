// ─── 設定（localStorage に永続保存） ───────────────────────────────────────
const S = {
  get apiKey()   { return localStorage.getItem('nr_api_key')   || ''; },
  get speechRate(){ return parseFloat(localStorage.getItem('nr_rate') || '1.0'); },
  set apiKey(v)  { localStorage.setItem('nr_api_key', v); },
  set speechRate(v){ localStorage.setItem('nr_rate', String(v)); },
  get hasSeenOnboarding() { return !!localStorage.getItem('nr_onboarded'); },
  markOnboarded() { localStorage.setItem('nr_onboarded', '1'); },
};

// ─── 起動 ─────────────────────────────────────────────────────────────────
async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  if (!S.hasSeenOnboarding) {
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
  ['home','chat','archive','settings'].forEach(t => {
    $(`tab-${t}`).style.display = t === name ? '' : 'none';
    document.querySelector(`.tab-btn[data-tab="${t}"]`).classList.toggle('active', t === name);
  });
  if (name === 'archive') loadArchive();
  if (name === 'settings') loadBroadcastConfig();
}

function $(id) { return document.getElementById(id); }

// ─── オンボーディング ─────────────────────────────────────────────────────
function onboardingSubmit() {
  const key = $('onboarding-key').value.trim();
  if (key) S.apiKey = key;
  S.markOnboarded();
  showScreen('main');
  populateSettings();
  loadToday();
}

// ─── 今日の放送（data/YYYY-MM-DD.json を読む） ────────────────────────────
async function loadToday() {
  setHomeState('loading');
  const today = todayStr();
  try {
    const data = await fetchJSON(`data/${today}.json`);
    showPlayer(data);
  } catch (e) {
    // 今日分がなければ昨日を表示 + "準備中" バナー
    try {
      const yesterday = offsetDate(-1);
      const data = await fetchJSON(`data/${yesterday}.json`);
      showPlayer(data, true); // true = show "today generating" notice
    } catch {
      setHomeState('empty');
    }
  }
}

async function refreshToday() {
  setHomeState('loading');
  // キャッシュをバイパスして再取得
  try {
    const data = await fetchJSON(`data/${todayStr()}.json?t=${Date.now()}`);
    showPlayer(data);
  } catch {
    await loadToday();
  }
}

function setHomeState(state) {
  ['loading','generating','error','player','empty'].forEach(s => {
    const el = $(`home-${s}`);
    if (el) el.style.display = s === state ? '' : 'none';
  });
}

function showPlayer(data, isYesterday = false) {
  setHomeState('player');

  const d = new Date(data.date + 'T00:00:00');
  $('player-date').textContent = d.toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  }) + (isYesterday ? '　（昨日）' : '');
  $('player-count').textContent = `${data.news_count}件のニュース`;
  $('home-script').textContent  = data.script || '';

  if (isYesterday) {
    const notice = document.createElement('div');
    notice.className = 'status-card';
    notice.style.marginTop = '8px';
    notice.innerHTML = '<p class="sub">📡 今日のニュースは準備中です。6時以降に自動生成されます。</p>';
    $('home-player').prepend(notice);
  }

  const audio = $('main-audio');
  if (data.audio_file) {
    // GitHub Pages の場合はリポジトリルートからの相対パスで取得
    audio.src = data.audio_file;
    audio.load();
    bindAudioEvents(audio, 'main-seek', 'main-current', 'main-duration', 'play-btn');
  }

  const list = $('home-news-list');
  list.innerHTML = '';
  (data.news_items || []).forEach(item => {
    const li = document.createElement('li');
    li.className = 'news-item';
    li.innerHTML = `
      <div class="news-item-meta">
        <span class="news-cat">${item.category}</span>
        <span class="news-src">${item.source}</span>
      </div>
      <div class="news-title"><a href="${item.url}" target="_blank" rel="noopener">${item.title}</a></div>
      <div class="news-summary">${item.summary}</div>`;
    list.appendChild(li);
  });
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
      const d = new Date(b.date + 'T00:00:00');
      const li = document.createElement('li');
      li.className = 'archive-item';
      li.innerHTML = `
        <div>
          <div class="archive-date">${d.toLocaleDateString('ja-JP', {year:'numeric',month:'long',day:'numeric',weekday:'short'})}</div>
          <div class="archive-meta">${b.news_count}件 · 音声あり</div>
        </div>
        <span class="archive-play">▶</span>`;
      li.onclick = () => { switchTab('home'); loadDateBroadcast(b.date); };
      list.appendChild(li);
    });
  } catch (e) {
    list.innerHTML = `<li class="list-loading">読み込み失敗: ${e.message}</li>`;
  }
}

async function loadDateBroadcast(dateStr) {
  setHomeState('loading');
  try {
    const data = await fetchJSON(`data/${dateStr}.json`);
    showPlayer(data);
  } catch (e) {
    setHomeState('error');
    $('home-error-msg').textContent = e.message;
  }
}

// ─── チャット（Claude API をブラウザから直接呼び出し） ───────────────────
const RADIO_PROMPT = `
あなたはプロのラジオパーソナリティです。
ユーザーのリクエストに応じて、ニュース原稿を作成してください。
以下のニュース情報を参考に、3〜5分で読める自然な話し言葉のラジオ原稿を書いてください。
です・ます調で、難しい用語は噛み砕いて説明してください。
出力は原稿テキストのみ（見出し・説明文不要）。
`;

let isSpeaking = false;
let currentSpeakBtn = null;

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
  const hint = messages.querySelector('.chat-hint');
  if (hint) hint.remove();

  // ユーザーバブル
  messages.appendChild(makeBubble('user', text));
  scrollChat();

  // タイピング
  const typing = makeBubble('typing');
  messages.appendChild(typing);
  scrollChat();

  try {
    // 今日のニュースを文脈として渡す（あれば）
    let newsContext = '';
    try {
      const today = await fetchJSON(`data/${todayStr()}.json`);
      newsContext = today.news_items.map(n => `【${n.category}】${n.title}: ${n.summary}`).join('\n');
    } catch { /* ニュースなくても続行 */ }

    const userMessage = newsContext
      ? `今日のニュース情報:\n${newsContext}\n\nユーザーのリクエスト: ${text}`
      : `ユーザーのリクエスト: ${text}（ニュースデータが取得できませんでした。一般的な内容で応答してください）`;

    const script = await callClaude(RADIO_PROMPT, userMessage);
    typing.remove();
    appendAIBubble(messages, script);
    scrollChat();
  } catch (e) {
    typing.remove();
    messages.appendChild(makeBubble('error', `⚠️ ${e.message}`));
    scrollChat();
  } finally {
    sendBtn.disabled = false;
  }
}

function makeBubble(type, text = '') {
  const div = document.createElement('div');
  if (type === 'user') {
    div.className = 'bubble-user';
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

function appendAIBubble(container, script) {
  const id = `sp-${Date.now()}`;
  const div = document.createElement('div');
  div.className = 'bubble-ai';
  div.innerHTML = `
    <div class="bubble-ai-inner">カスタムニュースを生成しました</div>
    <div class="chat-player">
      <div class="chat-player-controls">
        <button class="play-btn-sm" id="${id}" onclick="toggleSpeak('${id}', this._script)">▶ 読み上げ</button>
        <span class="tts-note">端末の音声で再生</span>
      </div>
    </div>
    <details class="chat-script-detail">
      <summary>原稿を読む</summary>
      <div class="script-text">${script}</div>
    </details>`;
  container.appendChild(div);

  // スクリプトをボタンに紐付け
  const btn = div.querySelector(`#${id}`);
  btn._script = script;
  btn.onclick = () => toggleSpeak(btn);
}

function toggleSpeak(btn) {
  if (isSpeaking && currentSpeakBtn === btn) {
    window.speechSynthesis.cancel();
    isSpeaking = false;
    btn.textContent = '▶ 読み上げ';
    currentSpeakBtn = null;
    return;
  }

  if (isSpeaking) {
    window.speechSynthesis.cancel();
    if (currentSpeakBtn) currentSpeakBtn.textContent = '▶ 読み上げ';
  }

  const script = btn._script;
  if (!script || !window.speechSynthesis) {
    showToast('このブラウザは読み上げに対応していません');
    return;
  }

  isSpeaking = true;
  currentSpeakBtn = btn;
  btn.textContent = '⏸ 停止';

  // 長文を文単位で分割して安定して読み上げる
  const chunks = script.match(/[^。！？\n]+[。！？\n]?/g) || [script];
  let i = 0;

  function speakNext() {
    if (!isSpeaking || i >= chunks.length) {
      isSpeaking = false;
      if (currentSpeakBtn === btn) {
        btn.textContent = '▶ 読み上げ';
        currentSpeakBtn = null;
      }
      return;
    }
    const utt = new SpeechSynthesisUtterance(chunks[i]);
    utt.lang = 'ja-JP';
    utt.rate = S.speechRate;
    utt.onend = () => { i++; speakNext(); };
    utt.onerror = () => { i++; speakNext(); };
    window.speechSynthesis.speak(utt);
  }

  speakNext();
}

function scrollChat() {
  const m = $('chat-messages');
  m.scrollTop = m.scrollHeight;
}

// ─── Claude API 直接呼び出し ─────────────────────────────────────────────
async function callClaude(systemPrompt, userMessage) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': S.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `APIエラー (${res.status})`);
  }

  const data = await res.json();
  return data.content[0].text;
}

// ─── 端末設定（localStorage） ────────────────────────────────────────────
function populateSettings() {
  $('setting-key').value      = S.apiKey;
  $('setting-rate').value     = String(S.speechRate);
  $('setting-gh-token').value = localStorage.getItem('nr_gh_token') || '';
}

function saveLocalSettings() {
  S.apiKey     = $('setting-key').value.trim();
  S.speechRate = parseFloat($('setting-rate').value);
  localStorage.setItem('nr_gh_token', $('setting-gh-token').value.trim());
  showToast('端末設定を保存しました ✓');
}

// ─── 放送設定（data/config.json → GitHub API で保存） ────────────────────

// URL から GitHub の owner/repo を取得
function getGitHubInfo() {
  const host = window.location.hostname;
  if (!host.endsWith('.github.io')) return null;
  const owner = host.replace('.github.io', '');
  const parts  = window.location.pathname.split('/').filter(Boolean);
  const repo   = parts[0] || owner;
  return { owner, repo };
}

// data/config.json を読んで設定画面に反映
async function loadBroadcastConfig() {
  try {
    const cfg = await fetchJSON(`data/config.json?t=${Date.now()}`);
    applyConfigToForm(cfg);
  } catch {
    // 読み込み失敗時はデフォルト値のまま
  }
}

function applyConfigToForm(cfg) {
  $('cfg-enabled').checked = cfg.schedule?.enabled !== false;

  // 曜日
  document.querySelectorAll('.day-checks input[type=checkbox]').forEach(cb => {
    cb.checked = (cfg.schedule?.days || []).includes(cb.value);
  });

  // カテゴリ
  document.querySelectorAll('.cat-checks input[type=checkbox]').forEach(cb => {
    cb.checked = (cfg.news?.categories || []).includes(cb.value);
  });

  // 件数
  const max = cfg.news?.max_items ?? 15;
  $('cfg-max-items').value = max;
  $('cfg-max-items-val').textContent = max + '件';

  // キーワード
  $('cfg-focus').value   = (cfg.news?.focus_keywords   || []).join(', ');
  $('cfg-exclude').value = (cfg.news?.exclude_keywords || []).join(', ');

  // スタイル
  $('cfg-length').value = cfg.style?.length || 'standard';
  $('cfg-tone').value   = cfg.style?.tone   || 'casual';
  $('cfg-intro').value  = cfg.style?.custom_intro || '';
}

function readConfigFromForm() {
  const days = [...document.querySelectorAll('.day-checks input:checked')].map(cb => cb.value);
  const cats = [...document.querySelectorAll('.cat-checks input:checked')].map(cb => cb.value);
  const toArr = str => str.split(',').map(s => s.trim()).filter(Boolean);

  return {
    schedule: {
      enabled: $('cfg-enabled').checked,
      days,
    },
    news: {
      categories:       cats,
      max_items:        parseInt($('cfg-max-items').value, 10),
      focus_keywords:   toArr($('cfg-focus').value),
      exclude_keywords: toArr($('cfg-exclude').value),
    },
    style: {
      length:       $('cfg-length').value,
      tone:         $('cfg-tone').value,
      custom_intro: $('cfg-intro').value.trim(),
    },
  };
}

async function saveBroadcastSettings() {
  const token = localStorage.getItem('nr_gh_token') || '';
  if (!token) {
    showToast('GitHub トークンを入力してください');
    return;
  }

  const ghInfo = getGitHubInfo();
  if (!ghInfo) {
    showToast('GitHub Pages 上でのみ保存できます');
    return;
  }

  const btn    = $('save-broadcast-btn');
  const status = $('save-broadcast-status');
  btn.disabled = true;
  status.textContent = '保存中...';

  try {
    const config = readConfigFromForm();
    await pushConfigToGitHub(config, ghInfo, token);
    status.textContent = '✓ 保存しました。次回の自動生成から反映されます。';
    showToast('放送設定を保存しました ✓');
  } catch (e) {
    status.textContent = `⚠️ ${e.message}`;
    showToast('保存に失敗しました');
  } finally {
    btn.disabled = false;
  }
}

async function pushConfigToGitHub(config, { owner, repo }, token) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/data/config.json`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // 現在のファイルの SHA を取得
  const getRes = await fetch(apiUrl, { headers });
  if (!getRes.ok) {
    const err = await getRes.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API エラー (${getRes.status})`);
  }
  const { sha } = await getRes.json();

  // ファイルを更新
  const content = encodeBase64Utf8(JSON.stringify(config, null, 2) + '\n');
  const putRes  = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '⚙️ 放送設定を更新', content, sha }),
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(err.message || `保存失敗 (${putRes.status})`);
  }
}

function encodeBase64Utf8(str) {
  const bytes  = new TextEncoder().encode(str);
  const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
  return btoa(binary);
}

// ─── 音声プレイヤー（MP3用） ──────────────────────────────────────────────
function bindAudioEvents(audio, seekId, curId, durId, btnId) {
  const seek = $(seekId), cur = $(curId), dur = $(durId), btn = $(btnId);
  if (!audio || !seek) return;

  audio.addEventListener('loadedmetadata', () => {
    seek.max = audio.duration;
    dur.textContent = fmt(audio.duration);
  });
  audio.addEventListener('timeupdate', () => {
    seek.value = audio.currentTime;
    cur.textContent = fmt(audio.currentTime);
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    seek.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--border) ${pct}%)`;
  });
  audio.addEventListener('ended', () => { if (btn) btn.textContent = '▶'; });
}

function togglePlay(audioId, btnId) {
  const audio = $(audioId), btn = $(btnId);
  if (!audio) return;
  if (audio.paused) {
    document.querySelectorAll('audio').forEach(a => { if (a !== audio && !a.paused) a.pause(); });
    audio.play();
    if (btn) btn.textContent = '⏸';
  } else {
    audio.pause();
    if (btn) btn.textContent = '▶';
  }
}

function seekAudio(audioId, seekId) {
  const a = $(audioId), s = $(seekId);
  if (a && s) a.currentTime = parseFloat(s.value);
}

function setSpeed(audioId, rate, btn) {
  const a = $(audioId);
  if (a) a.playbackRate = rate;
  btn.closest('.speed-row').querySelectorAll('.speed-btn')
     .forEach(b => b.classList.toggle('active', b === btn));
}

function fmt(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

// ─── ユーティリティ ───────────────────────────────────────────────────────
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

// ─── 起動 ─────────────────────────────────────────────────────────────────
init();
