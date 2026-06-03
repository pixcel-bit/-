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
      categories:       ['主要', '社会', '政治', '経済', '国際', 'スポーツ', '科学・文化', 'テクノロジー', 'AI', 'SaaS', 'ビジネス'],
      customCategories: [],
      excludedSources:  [],
      maxItems:         15,
      focusKeywords:    '',
      excludeKeywords:  '',
      length:           'standard',
      tone:             'casual',
      speechRate:       1.0,
      customIntro:      '',
      aiProfile:        null,
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
  { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', source: 'NHK', category: '主要' },
  { url: 'https://www3.nhk.or.jp/rss/news/cat1.xml', source: 'NHK', category: '社会' },
  { url: 'https://www3.nhk.or.jp/rss/news/cat2.xml', source: 'NHK', category: '政治' },
  { url: 'https://www3.nhk.or.jp/rss/news/cat3.xml', source: 'NHK', category: '経済' },
  { url: 'https://www3.nhk.or.jp/rss/news/cat4.xml', source: 'NHK', category: '国際' },
  { url: 'https://www3.nhk.or.jp/rss/news/cat5.xml', source: 'NHK', category: 'スポーツ' },
  { url: 'https://www3.nhk.or.jp/rss/news/cat6.xml', source: 'NHK', category: '科学・文化' },
  { url: 'https://gigazine.net/news/rss_2.0/', source: 'Gigazine', category: 'テクノロジー' },
  { url: 'https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml', source: 'ITmedia', category: 'テクノロジー' },
  { url: 'https://www.publickey1.jp/atom.xml', source: 'Publickey', category: 'テクノロジー' },
  { url: 'https://japan.zdnet.com/rss/all/', source: 'ZDNet Japan', category: 'テクノロジー' },
  { url: 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml', source: 'ITmedia AI+', category: 'AI' },
  { url: 'https://venturebeat.com/category/ai/feed/', source: 'VentureBeat AI', category: 'AI' },
  { url: 'https://www.technologyreview.com/feed/', source: 'MIT Technology Review', category: 'AI' },
  { url: 'https://ledge.ai/feed/', source: 'Ledge.ai', category: 'AI' },
  { url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', source: 'The Verge AI', category: 'AI' },
  { url: 'https://www.saastr.com/feed/', source: 'SaaStr', category: 'SaaS' },
  { url: 'https://www.producthunt.com/feed', source: 'Product Hunt', category: 'SaaS' },
  { url: 'https://techcrunch.com/category/enterprise/feed/', source: 'TechCrunch Enterprise', category: 'SaaS' },
  { url: 'https://toyokeizai.net/list/feed/rss', source: '東洋経済', category: 'ビジネス' },
  { url: 'https://gendai.media/rss', source: '現代ビジネス', category: 'ビジネス' },
  { url: 'https://president.jp/list/rss/top', source: 'プレジデントオンライン', category: 'ビジネス' },
  { url: 'https://forbesjapan.com/feed', source: 'Forbes Japan', category: 'ビジネス' },
  { url: 'https://www.bengo4.com/rss/', source: '弁護士ドットコム', category: '社会' },
  { url: 'https://www.asahi.com/rss/asahi/newsheadlines.rdf', source: '朝日新聞', category: '主要' },
  { url: 'https://feeds.reuters.com/reuters/JPTopNews', source: 'Reuters Japan', category: '国際' },
  { url: 'https://feeds.bbci.co.uk/japanese/rss.xml', source: 'BBC Japan', category: '国際' },
  { url: 'https://wired.jp/rss/', source: 'Wired Japan', category: 'テクノロジー' },
  { url: 'https://japan.cnet.com/rss/index.rdf', source: 'CNET Japan', category: 'テクノロジー' },
  { url: 'https://pc.watch.impress.co.jp/rss/pc/news.rdf', source: 'PC Watch', category: 'テクノロジー' },
  { url: 'https://news.mynavi.jp/rss/it', source: 'マイナビニュース', category: 'テクノロジー' },
  { url: 'https://www.gizmodo.jp/feed/', source: 'Gizmodo Japan', category: 'テクノロジー' },
  // ── 妻向け・実用書テーマ強化 ──
  { url: 'https://www.businessinsider.jp/feed/index.xml', source: 'Business Insider Japan', category: 'ビジネス' },
  { url: 'https://www.moneypost.jp/feed', source: 'マネーポストWEB', category: 'ビジネス' },
  { url: 'https://gentosha-go.com/rss', source: '幻冬舎ゴールドオンライン', category: 'ビジネス' },
  { url: 'https://www.huffingtonpost.jp/feeds/index.xml', source: 'ハフポスト', category: '社会' },
  { url: 'https://bunshun.jp/list/article/rss', source: '文春オンライン', category: '社会' },
  { url: 'https://dot.asahi.com/rss/index.rdf', source: 'AERA dot.', category: '社会' },
  { url: 'https://gooday.nikkei.co.jp/rss/', source: '日経Gooday', category: '科学・文化' },
  { url: 'https://courrier.jp/feed/', source: 'クーリエ・ジャポン', category: '国際' },
  // ── さらなる拡充 ──
  { url: 'https://www.sankei.com/rss/news/flash.xml', source: '産経ニュース', category: '主要' },
  { url: 'https://mainichi.jp/rss/etc/mainichi-flash.rss', source: '毎日新聞', category: '主要' },
  { url: 'https://ascii.jp/rss.xml', source: 'ASCII.jp', category: 'テクノロジー' },
  { url: 'https://natgeo.nikkeibp.co.jp/nng/article/news/rss/', source: 'ナショジオ日本版', category: '科学・文化' },
  { url: 'https://woman.nikkei.com/atcl/rss/', source: '日経xWOMAN', category: 'ビジネス' },
  { url: 'https://diamond.jp/rss', source: 'ダイヤモンドオンライン', category: 'ビジネス' },
  { url: 'https://resemom.jp/rss/20/index.rdf', source: 'リセマム', category: '社会' },
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
  return items.map((item, idx) => {
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
      feedRank: idx, // フィード内順位（0が最重要）
    };
  }).filter(n => n.title);
}

async function fetchAllRSS() {
  const excluded = new Set(S.settings.excludedSources || []);
  const active   = RSS_SOURCES.filter(s => !excluded.has(s.source));
  const results = await Promise.allSettled(
    active.map(s => fetchViaProxy(s.url).then(xml => parseRSS(xml, s.source, s.category)))
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

// ─── グッド・好み分析 ────────────────────────────────────────────────────────
function getLikedNews()    { return LS.getJSON('nr_liked_news',    []); }
function getDislikedNews() { return LS.getJSON('nr_disliked_news', []); }

function getPreferences() {
  const liked    = getLikedNews();
  const disliked = getDislikedNews();
  if (!liked.length && !disliked.length) return null;

  const stopWords = new Set(['ニュース', 'について', 'として', 'による', 'ために', 'こと', 'もの', 'それ', 'これ', 'その', 'どの', 'ある', 'いる', 'する', 'なる']);

  // ── グッド集計 ──
  const catCount = {};
  for (const item of liked) catCount[item.category] = (catCount[item.category] || 0) + 1;
  const likeWords = (liked.map(l => `${l.title} ${l.summary || ''} ${l.reason || ''}`).join(' ').match(/[一-鿿゠-ヿ]{2,}/g) || []);
  const likeWordCount = {};
  for (const w of likeWords) { if (!stopWords.has(w)) likeWordCount[w] = (likeWordCount[w] || 0) + 1; }
  const topKeywords   = Object.entries(likeWordCount).sort((a,b) => b[1]-a[1]).slice(0,15).map(([w]) => w);
  const topCategories = Object.entries(catCount).sort((a,b) => b[1]-a[1]).slice(0,3).map(([c]) => c);

  // ── バッド集計 ──
  const dislikeCatCount = {};
  for (const item of disliked) dislikeCatCount[item.category] = (dislikeCatCount[item.category] || 0) + 1;
  const dislikeWords = (disliked.map(d => `${d.title} ${d.summary || ''}`).join(' ').match(/[一-鿿゠-ヿ]{2,}/g) || []);
  const dislikeWordCount = {};
  for (const w of dislikeWords) { if (!stopWords.has(w)) dislikeWordCount[w] = (dislikeWordCount[w] || 0) + 1; }
  const topDislikeKeywords = Object.entries(dislikeWordCount).sort((a,b) => b[1]-a[1]).slice(0,10).map(([w]) => w);

  return { topCategories, topKeywords, catCount, total: liked.length,
           dislikeCatCount, topDislikeKeywords, dislikeTotal: disliked.length };
}

function scoreItemByPrefs(item, prefs) {
  if (!prefs) return 0;
  let score = 0;
  const text = `${item.title} ${item.summary || ''}`;
  // グッドボーナス
  score += (prefs.catCount[item.category] || 0) * 3;
  for (const kw of prefs.topKeywords) { if (text.includes(kw)) score += 2; }
  // バッドペナルティ
  score -= (prefs.dislikeCatCount?.[item.category] || 0) * 3;
  for (const kw of (prefs.topDislikeKeywords || [])) { if (text.includes(kw)) score -= 2; }
  return score;
}

// クロスソースマップ：同じ話題を複数ソースが報じているか検出
function buildCrossSourceMap(allItems) {
  const getWords = title => (title.match(/[一-鿿゠-ヿ]{2,}/g) || []);
  const wordIndex = {};
  for (const item of allItems) {
    for (const w of getWords(item.title)) {
      (wordIndex[w] = wordIndex[w] || []).push(item);
    }
  }
  const map = {};
  for (const item of allItems) {
    const otherSources = new Set();
    for (const w of getWords(item.title)) {
      for (const related of (wordIndex[w] || [])) {
        if (related.title !== item.title && related.source !== item.source) {
          otherSources.add(related.source);
        }
      }
    }
    map[item.title] = otherSources.size;
  }
  return map;
}

// トピック重複排除用ストップワード（一般的すぎる語はトピック判定から除外）
const TOPIC_STOP_WORDS = new Set([
  '日本', '政府', '国内', '海外', '国際', '東京', '地域', '全国', '各地',
  '問題', '影響', '対策', '方針', '発表', '開始', '実施', '決定', '予定',
  '対応', '検討', '協議', '今年', '今月', '今後', '来年', '今週', '今日',
  '首相', '大臣', '議員', '与党', '野党', '閣議', '内閣',
  '可能', '必要', '重要', '最大', '最高', '最低', '増加', '減少',
  '支援', '関係', '状況', '報告', '会議', '計画', '目標', '結果',
]);

function getTopicWords(title) {
  return (title.match(/[一-鿿゠-ヿ]{2,}/g) || []).filter(w => !TOPIC_STOP_WORDS.has(w));
}

function hasTopicOverlap(title, covered) {
  return getTopicWords(title).some(w => covered.has(w));
}

function markTopicCovered(title, covered) {
  for (const w of getTopicWords(title)) covered.add(w);
}

const AI_KEYWORDS = ['AI', '人工知能', '生成AI', 'LLM', 'ChatGPT', 'Claude', '機械学習', 'GPT', 'Gemini', 'Copilot'];
function isAIRelated(item) {
  const text = item.title + ' ' + (item.category || '');
  return item.category === 'AI' || AI_KEYWORDS.some(kw => text.includes(kw));
}

// 記事の総合重要度スコア
function computeScore(item, prefs, crossSourceMap) {
  let score = 0;
  // フィード内順位（上位ほど重要。0位=最重要で最大15点）
  score += Math.max(0, 10 - (item.feedRank || 0)) * 1.5;
  // クロスソース（複数メディアが同話題を報じると+8点/ソース）
  score += (crossSourceMap[item.title] || 0) * 8;
  // グッド/バッドボタン実績
  score += scoreItemByPrefs(item, prefs);
  // AIプロファイル（+4/-4点/トピック）
  const profile = S.settings.aiProfile;
  if (profile) {
    const text = `${item.title} ${item.summary || ''} ${item.category}`;
    for (const t of (profile.positiveTopics || [])) { if (text.includes(t)) score += 4; }
    for (const t of (profile.negativeTopics || [])) { if (text.includes(t)) score -= 4; }
  }
  return score;
}

function likeNews(idx) {
  const broadcast = LS.getJSON(`nr_broadcast_${todayStr()}`);
  if (!broadcast || !broadcast.news_items || !broadcast.news_items[idx]) return;

  const li = document.querySelector(`[data-news-index="${idx}"]`);
  if (!li) return;

  const item = broadcast.news_items[idx];
  if (getLikedNews().some(l => l.title === item.title)) {
    showToast('すでにグッドしています');
    return;
  }

  let form = li.querySelector('.like-form');
  if (form) { form.remove(); return; }

  form = document.createElement('div');
  form.className = 'like-form';
  form.innerHTML = `
    <textarea class="like-reason" placeholder="なぜ良かったですか？（任意・好みの分析に使われます）" rows="2"></textarea>
    <button class="like-submit-btn" onclick="submitLike(${idx}, this)">👍 グッドを送信</button>
  `;
  li.appendChild(form);
  form.querySelector('.like-reason').focus();
}

function submitLike(idx, btn) {
  const broadcast = LS.getJSON(`nr_broadcast_${todayStr()}`);
  if (!broadcast || !broadcast.news_items || !broadcast.news_items[idx]) return;

  const item = broadcast.news_items[idx];
  const form = btn.closest('.like-form');
  const reason = form.querySelector('.like-reason').value.trim();

  const liked = getLikedNews();
  if (liked.some(l => l.title === item.title)) {
    showToast('すでにグッドしています');
    form.remove();
    return;
  }

  liked.unshift({
    date: todayStr(),
    category: item.category,
    title: item.title,
    summary: (item.summary || '').slice(0, 100),
    reason,
    liked_at: new Date().toISOString(),
  });
  LS.setJSON('nr_liked_news', liked.slice(0, 100));

  const li = document.querySelector(`[data-news-index="${idx}"]`);
  const likeBtn = li?.querySelector('.like-btn');
  if (likeBtn) {
    likeBtn.textContent = '👍 グッド済み';
    likeBtn.classList.add('liked');
    likeBtn.disabled = true;
  }
  form.remove();
  showToast('グッド！好みの分析に反映されます ✓');
}

function dislikeNews(idx) {
  const broadcast = LS.getJSON(`nr_broadcast_${todayStr()}`);
  if (!broadcast?.news_items?.[idx]) return;

  const item = broadcast.news_items[idx];
  if (getDislikedNews().some(d => d.title === item.title)) {
    showToast('すでにバッドしています');
    return;
  }

  const disliked = getDislikedNews();
  disliked.unshift({
    date:        todayStr(),
    category:    item.category,
    title:       item.title,
    summary:     (item.summary || '').slice(0, 100),
    disliked_at: new Date().toISOString(),
  });
  LS.setJSON('nr_disliked_news', disliked.slice(0, 100));

  const li     = document.querySelector(`[data-news-index="${idx}"]`);
  const badBtn = li?.querySelector('.bad-btn');
  if (badBtn) { badBtn.textContent = '👎 バッド済み'; badBtn.classList.add('disliked'); badBtn.disabled = true; }
  showToast('バッド！次回から優先度を下げます 👎');
}

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

    // ─── 重要度スコアで選定（カテゴリ多様性 + トピック重複排除）───
    const maxItems = cfg.maxItems || 15;
    const prefs = getPreferences();
    const crossSourceMap = buildCrossSourceMap(allItems);

    // 全アイテムをスコア付きでソート
    const scored = items
      .map(item => ({ ...item, _score: computeScore(item, prefs, crossSourceMap) }))
      .sort((a, b) => b._score - a._score);

    const selected = [];
    const usedCats = new Set();
    const coveredTopics = new Set();

    // 第1パス：各カテゴリから、トピック重複のない最高スコア記事を1件確保
    for (const item of scored) {
      if (selected.length >= maxItems) break;
      if (!usedCats.has(item.category) && (!hasTopicOverlap(item.title, coveredTopics) || isAIRelated(item))) {
        selected.push(item);
        usedCats.add(item.category);
        markTopicCovered(item.title, coveredTopics);
      }
    }
    // 第2パス：残枠をスコア順で埋める（トピック重複は除外）
    for (const item of scored) {
      if (selected.length >= maxItems) break;
      if (!selected.some(s => s.title === item.title) && (!hasTopicOverlap(item.title, coveredTopics) || isAIRelated(item))) {
        selected.push(item);
        markTopicCovered(item.title, coveredTopics);
      }
    }
    // 第3パス：件数が足りない場合はトピック重複も許容してフォールバック
    if (selected.length < Math.min(5, maxItems)) {
      for (const item of scored) {
        if (selected.length >= maxItems) break;
        if (!selected.some(s => s.title === item.title)) selected.push(item);
      }
    }
    items = selected;
    if (!items.length) items = allItems.slice(0, 5);

    $('home-gen-msg').textContent = 'AIが放送原稿を作成中...';
    const script = await generateScript(items, cfg, prefs);

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

async function generateScript(items, cfg, prefs = null) {
  const lengthMap = { short: '約3分（400字程度）', standard: '約5分（800字程度）', long: '約10分（1600字程度）' };
  const toneMap   = { casual: 'カジュアルで親しみやすい', professional: '落ち着いたプロフェッショナルな', cheerful: '元気で明るい朝らしい' };

  const intro      = cfg.customIntro ? `冒頭に必ず次の文を入れてください: 「${cfg.customIntro}」\n\n` : '';
  const customCats = (cfg.customCategories || []).filter(Boolean);
  const customLine = customCats.length ? `- カスタムテーマ（以下のトピックを優先して取り上げてください）: ${customCats.join('、')}\n` : '';
  const prefLine     = prefs && prefs.total > 0
    ? `- リスナーの好み（グッドボタン実績より）: 関心カテゴリ「${prefs.topCategories.join('・')}」、関心キーワード「${prefs.topKeywords.slice(0, 5).join('・')}」。これらに関連するニュースはより熱意を持って詳しく紹介してください。\n`
    : '';
  const dislikeLine  = prefs && prefs.dislikeTotal > 0
    ? `- 興味なし（バッドボタン実績より）: カテゴリ「${Object.keys(prefs.dislikeCatCount).join('・')}」、キーワード「${prefs.topDislikeKeywords.slice(0, 5).join('・')}」。これらのトピックは簡潔にまとめるか省略してください。\n`
    : '';
  const profile      = cfg.aiProfile;
  const profileLine  = profile?.profileText
    ? `- ユーザーの好みプロファイル: ${profile.profileText}${profile.positiveAngles?.length ? `（重視する視点: ${profile.positiveAngles.join('・')}）` : ''}。\n`
    : '';

  const system = `あなたはプロのラジオパーソナリティです。
以下のニュース情報をもとに、${lengthMap[cfg.length] || lengthMap.standard}のラジオ放送原稿を作成してください。
トーンは${toneMap[cfg.tone] || toneMap.casual}口調です。
${intro}ルール:
${customLine}${prefLine}${dislikeLine}${profileLine}- です・ます調で自然な話し言葉
- 難しい用語は噛み砕いて説明
- 出力は原稿テキストのみ（見出し・箇条書き・記号・マークダウン不要）
- 数字は日本語の読みに合わせて表記（例: 2025年→二〇二五年、1兆円→一兆円）
- 英語略語は初出時にカナ読みを添える（例: AI（エーアイ）、GDP（ジーディーピー））
- 文末は必ず「。」で終わらせ、読み上げ時に自然な間が取れるようにする
- 2件目以降のニュースに移る際は必ず「次のニュースです。」という一文を入れてください（1件目の前は不要）`;

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
  const likedTitles    = new Set(getLikedNews().map(l => l.title));
  const dislikedTitles = new Set(getDislikedNews().map(d => d.title));
  (broadcast.news_items || []).forEach((item, idx) => {
    const isLiked    = likedTitles.has(item.title);
    const isDisliked = dislikedTitles.has(item.title);
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
        <button class="news-btn like-btn${isLiked ? ' liked' : ''}" onclick="likeNews(${idx})"${isLiked ? ' disabled' : ''}>${isLiked ? '👍 グッド済み' : '👍 グッド'}</button>
        <button class="news-btn bad-btn${isDisliked ? ' disliked' : ''}" onclick="dislikeNews(${idx})"${isDisliked ? ' disabled' : ''}>${isDisliked ? '👎 バッド済み' : '👎 バッド'}</button>
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
function jumpToNewsAndPlay(newsIdx) {
  const broadcast = LS.getJSON(`nr_broadcast_${todayStr()}`);
  if (!broadcast || !broadcast.news_items) return;
  if (!mainChunks || mainChunks.length === 0) return;

  const items    = broadcast.news_items;
  const perChunk = mainChunks.length / items.length;

  if (newsIdx === 0) {
    // 1件目はイントロ直後 = チャンク0から再生
    stopMainSpeak();
    mainChunkIdx = 0;
    startMainSpeak();
    return;
  }

  // 「次のニュースです。」セパレータのN番目を探す
  let count = 0;
  for (let i = 0; i < mainChunks.length; i++) {
    if (mainChunks[i].includes('次のニュース')) {
      count++;
      if (count === newsIdx) {
        stopMainSpeak();
        mainChunkIdx = i;
        startMainSpeak();
        return;
      }
    }
  }

  // フォールバック: 均等分割 + イントロ半分オフセット
  stopMainSpeak();
  mainChunkIdx = Math.min(Math.floor(perChunk * 0.5 + newsIdx * perChunk), mainChunks.length - 1);
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
  renderSourceSettings();
  const profile = S.settings.aiProfile;
  if ($('profile-input')) $('profile-input').value = profile?.profileText || '';
  renderProfileResult(profile);
}

function renderProfileResult(profile) {
  const el = $('profile-result');
  if (!el) return;
  if (!profile?.analyzedAt) { el.style.display = 'none'; return; }
  const pos = t => `<span class="profile-tag">${escHtml(t)}</span>`;
  const neg = t => `<span class="profile-tag negative">${escHtml(t)}</span>`;
  el.innerHTML = `
    <div class="profile-result-row">
      <span class="profile-result-label">興味あり</span>
      <div class="profile-tags">${(profile.positiveTopics || []).map(pos).join('')}</div>
    </div>
    ${(profile.positiveAngles || []).length ? `
    <div class="profile-result-row">
      <span class="profile-result-label">視点</span>
      <div class="profile-tags">${profile.positiveAngles.map(pos).join('')}</div>
    </div>` : ''}
    ${(profile.negativeTopics || []).length ? `
    <div class="profile-result-row">
      <span class="profile-result-label">興味なし</span>
      <div class="profile-tags">${profile.negativeTopics.map(neg).join('')}</div>
    </div>` : ''}
    <div class="profile-analyzed-at">最終分析: ${new Date(profile.analyzedAt).toLocaleString('ja-JP')}</div>
  `;
  el.style.display = '';
}

async function analyzeProfile() {
  const text = $('profile-input')?.value.trim();
  if (!text) { showToast('好みのテキストを入力してください'); return; }
  if (!S.apiKey) { showToast('APIキーが設定されていません'); switchTab('settings'); return; }

  const btn = $('profile-analyze-btn');
  btn.disabled = true;
  btn.textContent = '分析中...';

  try {
    const system = `ユーザーのニュースの好み・関心を分析して、以下のJSON形式のみで返してください。
固定カテゴリに縛らず、ユーザーの言葉のニュアンスを活かした具体的なトピック・キーワードを抽出してください。

{
  "positiveTopics": ["興味あるトピック・キーワード（10〜20語）"],
  "positiveAngles": ["好む切り口・視点（3〜5語）"],
  "negativeTopics": ["興味なし・不要なトピック（0〜10語）"]
}

ルール:
- 「テクノロジー」より「エンタープライズAI活用」「SaaS導入事例」のように具体的に
- ユーザーの職業・文脈を読み取り、業務に関連するキーワードも含める
- 日本語で返す
- JSONのみ出力（前後に説明文・マークダウン不要）`;

    const raw    = await callClaude(system, `ユーザーの好み:\n${text}`);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);

    const cfg    = S.settings;
    cfg.aiProfile = {
      profileText:    text,
      positiveTopics: parsed.positiveTopics || [],
      positiveAngles: parsed.positiveAngles || [],
      negativeTopics: parsed.negativeTopics || [],
      analyzedAt:     new Date().toISOString(),
    };
    S.saveSettings(cfg);
    renderProfileResult(cfg.aiProfile);
    showToast('プロファイルを保存しました ✓');
  } catch (e) {
    showToast(`分析エラー: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ AIで分析・保存';
  }
}

function renderSourceSettings() {
  const excluded = new Set(S.settings.excludedSources || []);
  const groups   = new Map();
  for (const s of RSS_SOURCES) {
    if (!groups.has(s.category)) groups.set(s.category, []);
    groups.get(s.category).push(s);
  }
  const container = $('source-settings');
  container.innerHTML = '';
  for (const [cat, sources] of groups) {
    const allOn   = sources.every(s => !excluded.has(s.source));
    const groupEl = document.createElement('div');
    groupEl.className      = 'source-group';
    groupEl.dataset.srcCat = cat;
    groupEl.innerHTML = `
      <div class="source-group-header">
        <span class="source-cat-name">${cat}</span>
        <button type="button" class="btn-src-all"
          onclick="toggleSourceAll('${cat}')">${allOn ? '全て無効化' : '全て有効化'}</button>
      </div>
      <div class="source-checks">
        ${sources.map(s => `
          <label class="source-check">
            <input type="checkbox" name="src" value="${s.source}" ${excluded.has(s.source) ? '' : 'checked'}>
            ${s.source}
          </label>`).join('')}
      </div>`;
    container.appendChild(groupEl);
  }
}

function toggleSourceAll(cat) {
  const group = document.querySelector(`#source-settings .source-group[data-src-cat="${cat}"]`);
  const boxes = [...group.querySelectorAll('input[type=checkbox]')];
  const allOn = boxes.every(cb => cb.checked);
  boxes.forEach(cb => cb.checked = !allOn);
  group.querySelector('.btn-src-all').textContent = allOn ? '全て有効化' : '全て無効化';
}

function saveSettings() {
  const key = $('setting-key').value.trim();
  if (key) S.apiKey = key;

  S.saveSettings({
    categories:       [...document.querySelectorAll('.cat-checks input:checked')].map(cb => cb.value),
    customCategories: (S.settings.customCategories || []),
    excludedSources:  [...document.querySelectorAll('#source-settings input[type=checkbox]:not(:checked)')].map(cb => cb.value),
    maxItems:         parseInt($('setting-max').value, 10),
    focusKeywords:    $('setting-focus').value.trim(),
    excludeKeywords:  $('setting-exclude').value.trim(),
    length:           $('setting-length').value,
    tone:             $('setting-tone').value,
    speechRate:       parseFloat($('setting-rate').value),
    customIntro:      $('setting-intro').value.trim(),
    voiceName:        $('setting-voice').value,
    aiProfile:        S.settings.aiProfile || null,
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
