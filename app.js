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
      categories:       ['総合', '政治', '経済', '国際', '科学・文化', 'テクノロジー'],
      customCategories: [],
      maxItems:         15,
      focusKeywords:    '',
      excludeKeywords:  '',
      length:           'standard',
      tone:             'casual',
      speechRate:       1.0,
      customIntro:      '',
    });
  },
  saveSettings(cfg) { LS.setJSON('nr_settings', cfg); },

  getCachedBroadcast(date) { return LS.getJSON(`nr_broadcast_${date}`); },
  setCachedBroadcast(date, data) {
    LS.setJSON(`nr_broadcast_${date}`, data);
    let idx = LS.getJSON('nr_archive_index', []);
    idx = idx.filter(e => e.date !== date);
    idx.unshift({ date, news_count: (data.news_items || []).length });
    LS.setJSON('nr_archive_index', idx.slice(0, 30));
  },
  delCachedBroadcast(date) {
    LS.del(`nr_broadcast_${date}`);
    const idx = LS.getJSON('nr_archive_index', []).filter(e => e.date !== date);
    LS.setJSON('nr_archive_index', idx);
  },
};

// ─── CORS プロキシ & RSS ソース ────────────────────────────────────────────
const CORS_PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

const RSS_SOURCES = [
  { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', source: 'NHK', category: '総合' },
  { url: 'https://www3.nhk.or.jp/rss/news/cat1.xml', source: 'NHK', category: '政治' },
  { url: 'https://www3.nhk.or.jp/rss/news/cat3.xml', source: 'NHK', category: '経済' },
  { url: 'https://www3.nhk.or.jp/rss/news/cat5.xml', source: 'NHK', category: '国際' },
  { url: 'https://www3.nhk.or.jp/rss/news/cat7.xml', source: 'NHK', category: '科学・文化' },
  { url: 'https://gigazine.net/news/rss_2.0/', source: 'Gigazine', category: 'テクノロジー' },
  { url: 'https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml', source: 'ITmedia', category: 'テクノロジー' },
];

async function fetchViaProxy(url) {
  for (const makeProxy of CORS_PROXIES) {
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res   = await fetch(makeProxy(url), { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return await res.text();
    } catch { /* try next proxy */ }
  }
  throw new Error(`RSS取得失敗: ${url}`);
}

function parseRSS(xmlText, source, category) {
  const doc   = new DOMParser().parseFromString(xmlText, 'text/xml');
  const items = [...doc.querySelectorAll('item')];
  return items.map(item => {
    const linkEl  = item.querySelector('link');
    const guidEl  = item.querySelector('guid');
    const url     = linkEl?.textContent?.trim() || guidEl?.textContent?.trim() || '';
    const summary = (item.querySelector('description')?.textContent?.trim() || '')
                      .replace(/<[^>]*>/g, '').slice(0, 200);
    return {
      title:    item.querySelector('title')?.textContent?.trim() || '',
      summary,
      url,
      source,
      category,
      pub_date: item.querySelector('pubDate')?.textContent?.trim() || '',
    };
  }).filter(n => n.title);
}

async function fetchAllRSS() {
  const results = await Promise.allSettled(
    RSS_SOURCES.map(s => fetchViaProxy(s.url).then(xml => parseRSS(xml, s.source, s.category)))
  );
  const seen  = new Set();
  const items = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value) {
      if (!seen.has(item.title)) {
        seen.add(item.title);
        items.push(item);
      }
    }
  }
  return items;
}

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

  if (!S.apiKey) {
    setHomeState('error');
    $('home-error-msg').textContent = 'APIキーが設定されていません。設定画面から入力してください。';
    return;
  }

  setHomeState('generating');
  $('home-gen-msg').textContent = '今日のニュースを取得中...';

  try {
    const allItems = await fetchAllRSS();
    if (!allItems.length) throw new Error('ニュースを取得できませんでした。ネットワーク接続をご確認ください。');

    const cfg = S.settings;
    let items = allItems;

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
        const hi = items.filter(n =>  focus.some(kw => n.title.includes(kw) || (n.summary || '').includes(kw)));
        const lo = items.filter(n => !focus.some(kw => n.title.includes(kw) || (n.summary || '').includes(kw)));
        items = [...hi, ...lo];
      }
    }

    // カテゴリ均等配分：各カテゴリから順番に1件ずつ選ぶ
    const maxItems = cfg.maxItems || 15;
    const byCategory = {};
    for (const item of items) {
      (byCategory[item.category] = byCategory[item.category] || []).push(item);
    }
    const cats = Object.keys(byCategory);
    const balanced = [];
    let added = true;
    while (balanced.length < maxItems && added) {
      added = false;
      for (const cat of cats) {
        if (balanced.length >= maxItems) break;
        if (byCategory[cat].length) {
          balanced.push(byCategory[cat].shift());
          added = true;
        }
      }
    }
    items = balanced;
    if (!items.length) items = allItems.slice(0, 5);

    $('home-gen-msg').textContent = 'AIが放送原稿を作成中...';
    const script = await generateScript(items, cfg);

    const broadcast = { date: today, news_items: items, script, generated_at: new Date().toISOString() };
    S.setCachedBroadcast(today, broadcast);
    showPlayer(broadcast);
  } catch (e) {
    setHomeState('error');
    $('home-error-msg').textContent = e.message;
  }
}

async function regenerateToday() {
  stopMainSpeak();
  S.delCachedBroadcast(todayStr());
  await loadToday();
}

async function generateScript(items, cfg) {
  const lengthMap = { short: '約3分（400字程度）', standard: '約5分（800字程度）', long: '約10分（1600字程度）' };
  const toneMap   = { casual: 'カジュアルで親しみやすい', professional: '落ち着いたプロフェッショナルな', cheerful: '元気で明るい朝らしい' };

  const intro      = cfg.customIntro ? `冒頭に必ず次の文を入れてください: 「${cfg.customIntro}」\n\n` : '';
  const customCats = (cfg.customCategories || []).filter(Boolean);
  const customLine = customCats.length ? `- カスタムテーマ（以下のトピックを優先して取り上げてください）: ${customCats.join('、')}\n` : '';

  const system = `あなたはプロのラジオパーソナリティです。
以下のニュース情報をもとに、${lengthMap[cfg.length] || lengthMap.standard}のラジオ放送原稿を作成してください。
トーンは${toneMap[cfg.tone] || toneMap.casual}口調です。
${intro}ルール:
${customLine}- です・ます調で自然な話し言葉
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

  mainSpeed = parseFloat(S.settings.speechRate || 1.0);
  document.querySelectorAll('.speed-row .speed-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.textContent) === mainSpeed);
  });

  const script = broadcast.script || '';
  mainChunks   = script.match(/[^。！？\n]+[。！？\n]?/g) || (script ? [script] : []);
  mainChunkIdx = 0;
  mainSpeaking = false;

  $('play-btn').textContent          = '▶';
  $('tts-progress-fill').style.width = '0%';
  $('main-chunk-info').textContent   = 'タップして再生';
  $('main-duration').textContent     = `全${mainChunks.length}文`;

  const list = $('home-news-list');
  list.innerHTML = '';
  (broadcast.news_items || []).forEach((item, idx) => {
    const li  = document.createElement('li');
    li.className = 'news-item';
    li.innerHTML = `
      <div class="news-item-meta">
        <span class="news-cat">${escHtml(item.category || '')}</span>
        <span class="news-src">${escHtml(item.source || '')}</span>
      </div>
      <div class="news-title">${escHtml(item.title || '')}</div>
      <div class="news-summary">${escHtml(item.summary || '')}</div>
      <div class="news-item-actions">
        <button class="news-btn" onclick="jumpToNewsAndPlay(${idx})">▶ ここから再生</button>
        <button class="news-btn" onclick="showDeepDiveModal(${idx})">🔍 深掘り</button>
      </div>
      ${item.url ? `<a class="news-source-link" href="${escHtml(item.url)}" target="_blank" rel="noopener">元記事を読む →</a>` : ''}`;
    li.dataset.newsIndex = idx;
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
  if (mainSpeaking) { window.speechSynthesis.cancel(); speakMainChunk(); }
  const cfg = S.settings; cfg.speechRate = rate; S.saveSettings(cfg);
}

// ─── ニュース位置マッピング & ジャンプ再生 ────────────────────────────────────
function buildNewsIndexMap(numNews, numChunks) {
  const map = {};
  const chunksPerNews = numNews > 0 ? Math.floor(numChunks / numNews) : 0;
  for (let i = 0; i < numNews; i++) {
    map[i] = Math.max(0, i * chunksPerNews);
  }
  return map;
}

function jumpToNewsAndPlay(newsIdx) {
  const broadcast = LS.getJSON(`nr_broadcast_${todayStr()}`);
  if (!broadcast || !broadcast.news_items) return;

  if (!mainChunks || mainChunks.length === 0) return;
  const map = buildNewsIndexMap(broadcast.news_items.length, mainChunks.length);
  const startChunk = map[newsIdx];

  stopMainSpeak();
  mainChunkIdx = startChunk;
  startMainSpeak();
}

// ─── 深掘りモーダル & ロジック ────────────────────────────────────────────────
function showDeepDiveModal(newsIdx) {
  const broadcast = LS.getJSON(`nr_broadcast_${todayStr()}`);
  if (!broadcast || !broadcast.news_items || !broadcast.news_items[newsIdx]) return;

  const item = broadcast.news_items[newsIdx];
  const title = item.title || '';

  let modal = document.getElementById('deep-dive-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'deep-dive-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>「${escHtml(title)}」を深掘り</h3>
        <textarea id="deep-dive-input" placeholder="どう掘り下げたいですか？例：背景や原因、今後の影響、詳しい解説など..." rows="4"></textarea>
        <div class="modal-buttons">
          <button class="btn-secondary" onclick="closeDeepDiveModal()">キャンセル</button>
          <button class="btn-primary" onclick="executeDeepDive()">読み上げ</button>
        </div>
      </div>
    `;
    modal.onclick = (e) => {
      if (e.target === modal) closeDeepDiveModal();
    };
    document.body.appendChild(modal);
  } else {
    modal.querySelector('h3').textContent = `「${escHtml(title)}」を深掘り`;
  }

  modal.dataset.newsIndex = newsIdx;
  modal.style.display = 'flex';
  modal.querySelector('#deep-dive-input').focus();
}

function closeDeepDiveModal() {
  const modal = document.getElementById('deep-dive-modal');
  if (modal) modal.style.display = 'none';
}

async function executeDeepDive() {
  const modal = document.getElementById('deep-dive-modal');
  if (!modal) return;
  const newsIdx = parseInt(modal.dataset.newsIndex);
  const instruction = modal.querySelector('#deep-dive-input').value.trim();
  if (!instruction) {
    showToast('掘り下げの内容を入力してください');
    return;
  }
  closeDeepDiveModal();
  await performDeepDive(newsIdx, instruction);
}

async function performDeepDive(newsIdx, instruction) {
  const broadcast = LS.getJSON(`nr_broadcast_${todayStr()}`);
  if (!broadcast || !broadcast.news_items || !broadcast.news_items[newsIdx]) return;

  const item = broadcast.news_items[newsIdx];
  if (!S.apiKey) {
    showToast('APIキーが設定されていません');
    return;
  }

  showToast('深掘り内容を生成中...');

  try {
    const system = 'あなたはニュース解説の専門家です。ユーザーのリクエストに応じて、詳しく分かりやすく説明してください。';
    const userMsg = `以下のニュースについて、掘り下げてください。\n\nニュース：【${item.category}】${item.title}\n概要：${item.summary || ''}\n\nユーザーの指示：${instruction}\n\nルール：\n- です・ます調で自然な話し言葉\n- 難しい用語は噛み砕いて説明\n- 出力は読み上げ可能なテキストのみ\n- 文末は「。」で終わらせる`;

    const deepDiveText = await callClaude(system, userMsg);
    addDeepDiveResult(newsIdx, instruction, deepDiveText);
  } catch (e) {
    showToast(`エラー: ${e.message}`);
  }
}

function addDeepDiveResult(newsIdx, instruction, text) {
  let resultsContainer = document.getElementById('deep-dive-results');
  if (!resultsContainer) {
    resultsContainer = document.createElement('div');
    resultsContainer.id = 'deep-dive-results';
    resultsContainer.className = 'deep-dive-results';
    const playerEl = document.querySelector('#home-player details:last-of-type');
    if (playerEl) {
      playerEl.parentNode.insertBefore(resultsContainer, playerEl.nextSibling);
    }
  }

  const resultDiv = document.createElement('div');
  resultDiv.className = 'deep-dive-result';
  resultDiv.innerHTML = `
    <div class="deep-dive-header">
      <h4>掘り下げ: ${escHtml(instruction)}</h4>
      <button class="deep-dive-read" onclick="readDeepDiveText(this)">▶ 読み上げ</button>
    </div>
    <div class="deep-dive-text">${escHtml(text)}</div>
  `;

  resultDiv.dataset.text = text;
  resultsContainer.appendChild(resultDiv);
  showToast('深掘り完了！');
}

function readDeepDiveText(btn) {
  const resultDiv = btn.closest('.deep-dive-result');
  const text = resultDiv.dataset.text;
  if (!text) return;

  const chunks = text.match(/[^。！？\n]+[。！？\n]?/g) || [text];
  const cfg = S.settings;
  const rate = parseFloat(cfg.speechRate || 1.0);
  const voice = resolveVoice(cfg.voiceName);
  let idx = 0;

  stopMainSpeak();
  btn.textContent = '⏸ 停止中';

  (function speakNext() {
    if (idx >= chunks.length) {
      btn.textContent = '▶ 読み上げ';
      return;
    }
    const utt = new SpeechSynthesisUtterance(chunks[idx]);
    utt.lang = 'ja-JP';
    utt.rate = rate;
    if (voice) utt.voice = voice;
    utt.onend = () => { idx++; setTimeout(speakNext, 150); };
    utt.onerror = () => { idx++; setTimeout(speakNext, 150); };
    window.speechSynthesis.speak(utt);
  })();
}

// ─── 履歴 ────────────────────────────────────────────────────────────────
function loadArchive() {
  const list  = $('archive-list');
  const index = LS.getJSON('nr_archive_index', []);
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
}
function loadDateBroadcast(date) {
  setHomeState('loading');
  stopMainSpeak();

  const cached = S.getCachedBroadcast(date);
  if (cached) { showPlayer(cached); return; }

  setHomeState('error');
  $('home-error-msg').textContent = 'この日の放送データがありません（端末のキャッシュが削除された可能性があります）';
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

let chatSpeaking   = false;
let currentChatBtn = null;

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
    const cached = S.getCachedBroadcast(todayStr());
    if (cached) {
      newsContext = cached.news_items.map(n => `【${n.category}】${n.title}: ${n.summary || ''}`).join('\n');
    }

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
  renderCustomCategories();
}

function saveSettings() {
  const key = $('setting-key').value.trim();
  if (key) S.apiKey = key;

  S.saveSettings({
    categories:       [...document.querySelectorAll('.cat-checks input:checked')].map(cb => cb.value),
    customCategories: (S.settings.customCategories || []),
    maxItems:         parseInt($('setting-max').value, 10),
    focusKeywords:    $('setting-focus').value.trim(),
    excludeKeywords:  $('setting-exclude').value.trim(),
    length:           $('setting-length').value,
    tone:             $('setting-tone').value,
    speechRate:       parseFloat($('setting-rate').value),
    customIntro:      $('setting-intro').value.trim(),
    voiceName:        $('setting-voice').value,
  });

  showToast('設定を保存しました ✓');
}

// ─── Claude API 直接呼び出し ─────────────────────────────────────────────
async function callClaude(system, userMsg) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':                              'application/json',
      'x-api-key':                                 S.apiKey,
      'anthropic-version':                         '2023-06-01',
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

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── カスタムカテゴリ ─────────────────────────────────────────────────────
function renderCustomCategories() {
  const container = $('custom-cat-list');
  if (!container) return;
  const custom = S.settings.customCategories || [];
  container.innerHTML = '';
  custom.forEach(name => {
    const tag = document.createElement('span');
    tag.className = 'cat-tag';
    tag.innerHTML = `${escHtml(name)}<button class="cat-tag-remove" onclick="removeCustomCategory('${escHtml(name).replace(/'/g, "\\'")}')">✕</button>`;
    container.appendChild(tag);
  });
}

function addCustomCategory() {
  const input = $('new-cat-input');
  const name  = input.value.trim();
  if (!name) return;
  const cfg    = S.settings;
  const custom = cfg.customCategories || [];
  if (!custom.includes(name)) {
    custom.push(name);
    cfg.customCategories = custom;
    S.saveSettings(cfg);
  }
  input.value = '';
  renderCustomCategories();
}

function removeCustomCategory(name) {
  const cfg = S.settings;
  cfg.customCategories = (cfg.customCategories || []).filter(c => c !== name);
  S.saveSettings(cfg);
  renderCustomCategories();
}

// ─── 音声リスト ───────────────────────────────────────────────────────────
function populateVoiceSelector() {
  const sel = $('setting-voice');
  if (!sel) return;
  const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('ja'));
  if (!voices.length) return;

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

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener('voiceschanged', populateVoiceSelector);
  populateVoiceSelector();
}

// ─── 起動 ─────────────────────────────────────────────────────────────────
init();
