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
      excludeKeywords:  '',
      length:           'standard',
      tone:             'casual',
      speechRate:       1.0,
      customIntro:      '',
      aiProfile:        null,
      crossSourceEnabled: true,
      playMode:           'voice',
      maxPerCategory:     2,
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
    this.addSeenTitles((data.news_items || []).map(n => n.title));
  },

  getSeenTitles() { return LS.getJSON('nr_seen_titles', []); },
  addSeenTitles(titles) {
    const seen = new Set(this.getSeenTitles());
    titles.forEach(t => seen.add(t));
    // 最新 500 件に絞る（古いものから自然に押し出し）
    LS.setJSON('nr_seen_titles', [...seen].slice(-500));
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
  // ── 主要系強化 ──
  { url: 'https://www.yomiuri.co.jp/feed/', source: '読売新聞', category: '主要' },
  { url: 'https://www.jiji.com/rss/ranking.rdf', source: '時事通信', category: '主要' },
  { url: 'https://www.jiji.com/rss/pol.rdf', source: '時事通信', category: '政治' },
  { url: 'https://www.jiji.com/rss/eco.rdf', source: '時事通信', category: '経済' },
  { url: 'https://www.jiji.com/rss/soc.rdf', source: '時事通信', category: '社会' },
  { url: 'https://www.jiji.com/rss/int.rdf', source: '時事通信', category: '国際' },
  { url: 'https://www.jiji.com/rss/spo.rdf', source: '時事通信', category: 'スポーツ' },
  { url: 'https://www.nikkansports.com/rss/news.rdf', source: '日刊スポーツ', category: 'スポーツ' },
  { url: 'https://feeds.reuters.com/reuters/JPBusinessNews', source: 'Reuters Japan 経済', category: '経済' },
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
  const text         = `${item.title} ${item.summary || ''}`;
  const total        = Math.max(prefs.total        || 1, 1);
  const dislikeTotal = Math.max(prefs.dislikeTotal || 1, 1);

  // グッドボーナス（割合ベース・最大+12点）
  score += ((prefs.catCount[item.category] || 0) / total) * 12;
  let kwScore = 0;
  for (const kw of prefs.topKeywords) { if (text.includes(kw)) kwScore += 2; }
  score += Math.min(kwScore, 6); // キーワードは最大+6点

  // バッドペナルティ（同様に割合ベース・最大-12点）
  score -= ((prefs.dislikeCatCount?.[item.category] || 0) / dislikeTotal) * 12;
  let dkwScore = 0;
  for (const kw of (prefs.topDislikeKeywords || [])) { if (text.includes(kw)) dkwScore += 2; }
  score -= Math.min(dkwScore, 6);

  return score;
}

// クロスソースマップ：同じ話題を複数ソースが報じているか検出
function buildCrossSourceMap(allItems) {
  const getWords = title => (title.match(/[一-鿿゠-ヿ]{3,}/g) || []); // 3文字以上の語のみ（AI・日本など汎用2文字語を除外）
  const OVERLAP_THRESHOLD = 2; // 3文字以上の語が2語一致で同トピック判定
  const map = {};
  for (const item of allItems) {
    const itemWords = new Set(getWords(item.title));
    const otherSources = new Set();
    for (const other of allItems) {
      if (other.title === item.title || other.source === item.source) continue;
      const overlap = getWords(other.title).filter(w => itemWords.has(w)).length;
      if (overlap >= OVERLAP_THRESHOLD) otherSources.add(other.source);
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

// string[] → {topic,weight}[] への後方互換マイグレーション
function migrateProfile(profile) {
  if (!profile) return profile;
  if (profile.positiveTopics?.length && typeof profile.positiveTopics[0] === 'string') {
    profile.positiveTopics = profile.positiveTopics.map(t => ({ topic: t, weight: 1 }));
  }
  if (profile.negativeTopics?.length && typeof profile.negativeTopics[0] === 'string') {
    profile.negativeTopics = profile.negativeTopics.map(t => ({ topic: t, weight: 1 }));
  }
  return profile;
}

// トピック配列に newTopics を追記（既存なら weight++）
// 上限100語に達したとき: weight=1の仮登録語を削除してから追加
const TOPIC_LIMIT = 100;
function mergeTopics(existing, newTopics) {
  let arr = existing ? [...existing] : [];
  for (const topicStr of newTopics) {
    if (!topicStr) continue;
    const idx = arr.findIndex(t => t.topic === topicStr);
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], weight: Math.min(arr[idx].weight + 1, 10) };
    } else {
      if (arr.length >= TOPIC_LIMIT) arr = arr.filter(t => t.weight > 1); // 仮登録を掃除
      if (arr.length < TOPIC_LIMIT) arr.push({ topic: topicStr, weight: 1 });
    }
  }
  return arr.sort((a, b) => b.weight - a.weight);
}

// 記事の総合重要度スコア
function computeScore(item, prefs, crossSourceMap) {
  let score = 0;
  // フィード内順位（上位ほど重要。0位=最重要で最大15点）
  score += Math.max(0, 10 - (item.feedRank || 0)) * 1.5;
  // クロスソース（上限3ソース×5点=最大+15。OFFにすると無効）
  if (S.settings.crossSourceEnabled !== false) {
    score += Math.min(crossSourceMap[item.title] || 0, 3) * 5;
  }
  // グッド/バッドボタン実績
  score += scoreItemByPrefs(item, prefs);
  // AIプロファイル（weight×2点/トピック、合計±15点でキャップ）
  const profile = migrateProfile(S.settings.aiProfile);
  if (profile) {
    const text = `${item.title} ${item.summary || ''} ${item.category}`;
    let posScore = 0, negScore = 0;
    for (const t of (profile.positiveTopics || [])) {
      if (t.weight >= 2 && text.includes(t.topic)) posScore += Math.min(t.weight * 2, 8);
    }
    for (const t of (profile.negativeTopics || [])) {
      if (t.weight >= 2 && text.includes(t.topic)) negScore += Math.min(t.weight * 2, 8);
    }
    score += Math.min(posScore, 15) - Math.min(negScore, 15);
  }
  return score;
}

function likeNews(idx) {
  const broadcast = LS.getJSON(`nr_broadcast_${todayStr()}`);
  if (!broadcast?.news_items?.[idx]) return;

  const item = broadcast.news_items[idx];
  const li = document.querySelector(`[data-news-index="${idx}"]`);
  if (!li) return;

  if (getLikedNews().some(l => l.title === item.title)) {
    showToast('すでにグッドしています');
    return;
  }

  // 即座に Layer 3（行動履歴）に保存
  const liked = getLikedNews();
  liked.unshift({ date: todayStr(), category: item.category, title: item.title,
    summary: (item.summary || '').slice(0, 100), reason: '', liked_at: new Date().toISOString() });
  LS.setJSON('nr_liked_news', liked.slice(0, 100));

  const likeBtn = li.querySelector('.like-btn');
  if (likeBtn) { likeBtn.textContent = '👍 グッド済み'; likeBtn.classList.add('liked'); likeBtn.disabled = true; }
  showToast('グッド！好みの分析に反映されます ✓');

  // 任意の理由入力（Layer 2 更新用）
  let form = li.querySelector('.like-form');
  if (form) { form.remove(); return; }
  form = document.createElement('div');
  form.className = 'like-form';
  form.innerHTML = `
    <textarea class="like-reason" placeholder="なぜ良かったですか？（任意・AIプロファイルを更新します）" rows="2"></textarea>
    <div class="reason-form-btns">
      <button class="like-submit-btn" onclick="submitLikeReason(${idx}, this)">送信してAIプロファイル更新</button>
      <button class="reason-skip-btn" onclick="this.closest('.like-form').remove()">スキップ</button>
    </div>
  `;
  li.appendChild(form);
  form.querySelector('.like-reason').focus();
}

function submitLikeReason(idx, btn) {
  const broadcast = LS.getJSON(`nr_broadcast_${todayStr()}`);
  if (!broadcast?.news_items?.[idx]) return;

  const item = broadcast.news_items[idx];
  const form = btn.closest('.like-form');
  const reason = form.querySelector('.like-reason').value.trim();
  form.remove();

  if (!reason) return;
  // reason を nr_liked_news にも保存
  const liked = getLikedNews();
  const entry = liked.find(l => l.title === item.title);
  if (entry) entry.reason = reason;
  LS.setJSON('nr_liked_news', liked);

  updateProfileFromReason(item, reason); // Layer 2
}

function dislikeNews(idx) {
  const broadcast = LS.getJSON(`nr_broadcast_${todayStr()}`);
  if (!broadcast?.news_items?.[idx]) return;

  const item = broadcast.news_items[idx];
  const li = document.querySelector(`[data-news-index="${idx}"]`);
  if (!li) return;

  if (getDislikedNews().some(d => d.title === item.title)) {
    showToast('すでにバッドしています');
    return;
  }

  // 即座に Layer 3（行動履歴）に保存
  const disliked = getDislikedNews();
  disliked.unshift({ date: todayStr(), category: item.category, title: item.title,
    summary: (item.summary || '').slice(0, 100), disliked_at: new Date().toISOString() });
  LS.setJSON('nr_disliked_news', disliked.slice(0, 100));

  const badBtn = li.querySelector('.bad-btn');
  if (badBtn) { badBtn.textContent = '👎 バッド済み'; badBtn.classList.add('disliked'); badBtn.disabled = true; }
  showToast('バッド！次回から優先度を下げます 👎');

  // 任意の理由入力（Layer 2 更新用）
  let form = li.querySelector('.dislike-form');
  if (form) { form.remove(); return; }
  form = document.createElement('div');
  form.className = 'dislike-form';
  form.innerHTML = `
    <textarea class="like-reason" placeholder="なぜ興味がありませんでしたか？（任意・AIプロファイルを更新します）" rows="2"></textarea>
    <div class="reason-form-btns">
      <button class="dislike-submit-btn" onclick="submitDislikeReason(${idx}, this)">送信してAIプロファイル更新</button>
      <button class="reason-skip-btn" onclick="this.closest('.dislike-form').remove()">スキップ</button>
    </div>
  `;
  li.appendChild(form);
  form.querySelector('.like-reason').focus();
}

function submitDislikeReason(idx, btn) {
  const broadcast = LS.getJSON(`nr_broadcast_${todayStr()}`);
  if (!broadcast?.news_items?.[idx]) return;

  const item = broadcast.news_items[idx];
  const form = btn.closest('.dislike-form');
  const reason = form.querySelector('.like-reason').value.trim();
  form.remove();

  if (reason) updateProfileFromDislikeReason(item, reason); // Layer 2
}

async function updateProfileFromReason(item, reason) {
  if (!S.apiKey) return;
  const cfg = S.settings;
  const existing = (migrateProfile(cfg.aiProfile)?.positiveTopics || []).map(t => t.topic);

  const system = `ニュース記事とユーザーのコメントから、興味・関心を表す具体的なトピックを3〜5語抽出してください。
JSONのみ返してください: {"newTopics": ["トピック1", "トピック2"]}
ルール:
- 既存トピック（${existing.join('、') || 'なし'}）と重複しない新しい視点を抽出
- 「テクノロジー」より「SaaS導入事例」「エンタープライズAI活用」のように具体的に
- 日本語で返す`;

  try {
    const raw    = await callClaude(system, `記事: 【${item.category}】${item.title}\nコメント: ${reason}`);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    const newTopics = (parsed.newTopics || []).filter(t => t.length > 0);
    if (!newTopics.length) return;

    const latest  = S.settings;
    const profile = migrateProfile(latest.aiProfile) || { profileText: '', positiveTopics: [], positiveAngles: [], negativeTopics: [], analyzedAt: null };
    const before  = profile.positiveTopics.length;
    profile.positiveTopics = mergeTopics(profile.positiveTopics, newTopics);
    const added = profile.positiveTopics.length - before;
    profile.analyzedAt = new Date().toISOString();
    latest.aiProfile   = profile;
    S.saveSettings(latest);
    if (added > 0) showToast(`プロファイルを更新しました（+${added}語）✓`);
    renderProfileResult(profile);
  } catch { /* サイレント失敗 */ }
}

async function updateProfileFromDislikeReason(item, reason) {
  if (!S.apiKey) return;
  const cfg = S.settings;
  const existing = (migrateProfile(cfg.aiProfile)?.negativeTopics || []).map(t => t.topic);

  const system = `ニュース記事とユーザーのコメントから、ユーザーが興味なし・不要と感じる具体的なトピックを2〜4語抽出してください。
JSONのみ返してください: {"newTopics": ["トピック1", "トピック2"]}
ルール:
- 既存トピック（${existing.join('、') || 'なし'}）と重複しない新しい視点を抽出
- 「テクノロジー」より「芸能スキャンダル」「競馬・ギャンブル」のように具体的に
- 日本語で返す`;

  try {
    const raw    = await callClaude(system, `記事: 【${item.category}】${item.title}\nコメント: ${reason}`);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    const newTopics = (parsed.newTopics || []).filter(t => t.length > 0);
    if (!newTopics.length) return;

    const latest  = S.settings;
    const profile = migrateProfile(latest.aiProfile) || { profileText: '', positiveTopics: [], positiveAngles: [], negativeTopics: [], analyzedAt: null };
    const before  = profile.negativeTopics.length;
    profile.negativeTopics = mergeTopics(profile.negativeTopics, newTopics);
    const added = profile.negativeTopics.length - before;
    profile.analyzedAt = new Date().toISOString();
    latest.aiProfile   = profile;
    S.saveSettings(latest);
    if (added > 0) showToast(`プロファイルを更新しました（-${added}語）✓`);
    renderProfileResult(profile);
  } catch { /* サイレント失敗 */ }
}

// ─── 起動 ─────────────────────────────────────────────────────────────────
async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  setupMediaSessionHandlers();

  // 画面復帰時: Wake Lock 再取得 + speechSynthesis が一時停止していれば再開
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && mainSpeaking) {
      acquireWakeLock();
      if (window.speechSynthesis?.paused) window.speechSynthesis.resume();
    }
  });

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

    // ─── 重要度スコアで選定（カテゴリ多様性 + トピック重複排除）───
    const maxItems = cfg.maxItems || 15;
    const prefs = getPreferences();
    const crossSourceMap = buildCrossSourceMap(allItems);

    // 全アイテムをスコア付きでソート
    const scored = items
      .map(item => ({ ...item, _score: computeScore(item, prefs, crossSourceMap) }))
      .sort((a, b) => b._score - a._score);

    // 既出タイトルを除外（新規記事が5件以上ある場合のみ適用）
    const seenTitles = new Set(S.getSeenTitles());
    const freshScored = scored.filter(item => !seenTitles.has(item.title));
    const pool = freshScored.length >= Math.min(5, maxItems) ? freshScored : scored;

    const selected = [];
    const usedCats = new Set();
    const coveredTopics = new Set();

    // 第1パス：各カテゴリから、トピック重複のない最高スコア記事を1件確保
    for (const item of pool) {
      if (selected.length >= maxItems) break;
      if (!usedCats.has(item.category) && (!hasTopicOverlap(item.title, coveredTopics) || isAIRelated(item))) {
        selected.push(item);
        usedCats.add(item.category);
        markTopicCovered(item.title, coveredTopics);
      }
    }
    // 第2パス：残枠をスコア順で埋める（カテゴリ上限・トピック重複を考慮）
    const maxPerCat = cfg.maxPerCategory ?? 2; // 0 = 制限なし
    for (const item of pool) {
      if (selected.length >= maxItems) break;
      if (maxPerCat > 0 && selected.filter(s => s.category === item.category).length >= maxPerCat) continue;
      if (!selected.some(s => s.title === item.title) && (!hasTopicOverlap(item.title, coveredTopics) || isAIRelated(item))) {
        selected.push(item);
        markTopicCovered(item.title, coveredTopics);
      }
    }
    // 第3パス：件数が足りない場合は全候補（既出含む）でフォールバック
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
  // 削除前に今日のタイトルを既出リストへ保存（fix以前のキャッシュも対象にするため）
  const current = S.getCachedBroadcast(todayStr());
  if (current) S.addSeenTitles((current.news_items || []).map(n => n.title));
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
- 英語・アルファベット略語はカタカナのみで書き、アルファベット表記は一切使わない（例: AI→エーアイ、GDP→ジーディーピー、SaaS→サース）
- 文末は必ず「。」で終わらせ、読み上げ時に自然な間が取れるようにする
- 2件目以降のニュースに移る際は必ず「次のニュースです。」という一文を入れてください（1件目の前は不要）`;

  const newsText = items.map((n, i) => `${i + 1}. 【${n.category}】${n.title}\n${n.summary || ''}`).join('\n\n');

  return callClaude(system, `今日のニュース一覧:\n${newsText}`);
}

// ─── 2人ホストプレビュー ────────────────────────────────────────────────────
let duoChunks  = [];   // [{speaker:'A'|'B', text:string}]
let duoIdx     = 0;
let duoSpeaking = false;
let duoVoiceA  = null;
let duoVoiceB  = null;

async function generateDuoScript(items, cfg) {
  const lengthMap = { short: '約3分', standard: '約5分', long: '約10分' };
  const newsText  = items.map((n, i) => `${i+1}. 【${n.category}】${n.title}\n${n.summary || ''}`).join('\n\n');

  const system = `あなたは日本語ラジオ番組の台本作家です。
2人のMC（MC-AとMC-B）が自然に会話しながらニュースを紹介する台本を書いてください。

ルール:
- 各発言は必ず行頭に [A] または [B] を付けてください
- 1発言は1〜3文程度（短めにテンポよく）
- MC-A がメイン進行、MC-B が相槌・感想・補足を担当
- 「そうなんですよ」「えー！」「なるほど」「それは気になりますね」「実は」「ちなみに」などの自然なフィラーを入れる
- 驚き・共感・疑問など感情の起伏をつける
- ニュースとニュースの間を自然な一言でつなぐ
- 全体で${lengthMap[cfg.length] || '約5分'}程度
- 出力は台本テキストのみ（説明文・見出し不要）
- 数字は読み仮名で（例: 2025年→二〇二五年、1兆円→一兆円）`;

  return callClaude(system, `以下のニュースで台本を作成してください:\n\n${newsText}`);
}

function parseDuoScript(script) {
  const chunks = [];
  for (const line of script.split('\n')) {
    const m = line.match(/^\[([AB])\]\s*(.+)/);
    if (m) {
      chunks.push({ speaker: m[1], text: m[2].trim() });
    } else if (chunks.length && line.trim()) {
      chunks[chunks.length - 1].text += '　' + line.trim();
    }
  }
  return chunks.filter(c => c.text.length > 0);
}

async function startDuoPreview() {
  const broadcast = S.getCachedBroadcast(todayStr());
  if (!broadcast?.news_items?.length) { showToast('今日の放送がありません'); return; }
  if (!S.apiKey) { showToast('APIキーが設定されていません'); return; }

  if (mainSpeaking) stopMainSpeak();

  const btn = $('duo-preview-btn');
  btn.disabled = true;
  btn.textContent = '台本を生成中...';

  try {
    const script = await generateDuoScript(broadcast.news_items, S.settings);
    duoChunks = parseDuoScript(script);
    if (!duoChunks.length) throw new Error('台本の解析に失敗しました');

    // 2つの日本語音声を選択
    const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('ja'));
    duoVoiceA = resolveVoice(S.settings.voiceName) || voices[0] || null;
    duoVoiceB = voices.find(v => v.name !== (duoVoiceA?.name)) || voices[0] || null;

    duoIdx = 0;
    $('duo-player-card').style.display = '';
    $('duo-current-text').textContent  = '';
    toggleDuoSpeak(); // 自動再生開始
  } catch (e) {
    showToast('生成エラー: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🎙 2人で聴く（β）';
  }
}

function toggleDuoSpeak() {
  if (duoSpeaking) {
    duoSpeaking = false;
    speechSynthesis.cancel();
    $('duo-play-btn').textContent = '▶';
    releaseWakeLock();
    updateMediaSession('paused');
  } else {
    if (duoIdx >= duoChunks.length) duoIdx = 0;
    duoSpeaking = true;
    $('duo-play-btn').textContent = '⏸';
    acquireWakeLock();
    updateMediaSession('playing', '2人版ニュースラジオ');
    speakDuoChunk();
  }
}

function speakDuoChunk() {
  if (!duoSpeaking || duoIdx >= duoChunks.length) {
    duoSpeaking = false;
    $('duo-play-btn').textContent  = '▶';
    $('duo-chunk-info').textContent = duoIdx >= duoChunks.length ? '再生完了' : 'タップして再生';
    $('duo-progress-fill').style.width = duoIdx >= duoChunks.length ? '100%' : '0%';
    if (duoIdx >= duoChunks.length) duoIdx = 0;
    releaseWakeLock();
    updateMediaSession('paused');
    return;
  }

  const chunk = duoChunks[duoIdx];
  const pct   = (duoIdx / duoChunks.length) * 100;
  $('duo-progress-fill').style.width  = pct + '%';
  $('duo-chunk-info').textContent     = `${duoIdx + 1} / ${duoChunks.length}`;
  $('duo-current-text').textContent   = chunk.text;
  $('duo-speaker-a').classList.toggle('active', chunk.speaker === 'A');
  $('duo-speaker-b').classList.toggle('active', chunk.speaker === 'B');

  const utt   = new SpeechSynthesisUtterance(chunk.text);
  utt.lang    = 'ja-JP';
  utt.rate    = mainSpeed;
  utt.voice   = chunk.speaker === 'A' ? duoVoiceA : duoVoiceB;
  const next  = () => { if (duoSpeaking) { duoIdx++; setTimeout(speakDuoChunk, 180); } };
  utt.onend   = next;
  utt.onerror = next;
  speechSynthesis.speak(utt);
}

function stopDuo() {
  duoSpeaking = false;
  speechSynthesis.cancel();
  duoChunks = [];
  duoIdx    = 0;
  $('duo-player-card').style.display = 'none';
  $('duo-play-btn').textContent = '▶';
  releaseWakeLock();
  updateMediaSession('paused');
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

// ─── NoSleep（画面OFF防止）──────────────────────────────────────────────────
// Android Chrome: Wake Lock API  /  iOS Chrome/Safari: 無音動画ループ
const _NS_MP4  = 'data:video/mp4;base64,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';
const _NS_WEBM = 'data:video/webm;base64,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';

let _wakeLock   = null;
let _noSleepVid = null;

function _initNoSleepVideo() {
  if (_noSleepVid) return;
  _noSleepVid = document.createElement('video');
  _noSleepVid.setAttribute('playsinline', '');
  _noSleepVid.setAttribute('muted', '');
  _noSleepVid.loop   = true;
  _noSleepVid.muted  = true;
  _noSleepVid.style.cssText = 'position:fixed;width:1px;height:1px;top:0;left:0;opacity:0.01;pointer-events:none;z-index:-1';
  // iOS は MP4 優先、Android/Chrome は WebM
  _noSleepVid.innerHTML = `<source src="${_NS_MP4}" type="video/mp4"><source src="${_NS_WEBM}" type="video/webm">`;
  document.body.appendChild(_noSleepVid);
}

async function acquireWakeLock() {
  if ('wakeLock' in navigator) {
    try { _wakeLock = await navigator.wakeLock.request('screen'); return; } catch {}
  }
  // iOS フォールバック: 無音動画ループで画面ON維持
  _initNoSleepVideo();
  _noSleepVid.play().catch(() => {});
}

function releaseWakeLock() {
  _wakeLock?.release().catch(() => {});
  _wakeLock = null;
  _noSleepVid?.pause();
}

// ─── Media Session（ロック画面に再生コントロールを表示）──────────────────
function updateMediaSession(state, title) {
  if (!('mediaSession' in navigator)) return;
  if (state === 'playing') {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || '今日のニュースラジオ',
      artist: 'Daily News Radio',
    });
    navigator.mediaSession.playbackState = 'playing';
  } else {
    navigator.mediaSession.playbackState = 'paused';
  }
}
function setupMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play',  () => { if (!mainSpeaking) toggleMainSpeak(); });
  navigator.mediaSession.setActionHandler('pause', () => { if (mainSpeaking)  toggleMainSpeak(); });
  navigator.mediaSession.setActionHandler('stop',  () => stopMainSpeak());
}

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
        <button class="news-btn play-news-btn" onclick="jumpToNewsAndPlay(${idx})">▶ 再生</button>
        <button class="news-btn deep-btn" onclick="showDeepDiveModal(${idx})">🔍 深掘り</button>
        <button class="news-btn icon-btn-sq like-btn${isLiked ? ' liked' : ''}" onclick="likeNews(${idx})"${isLiked ? ' disabled' : ''}>👍</button>
        <button class="news-btn icon-btn-sq bad-btn${isDisliked ? ' disliked' : ''}" onclick="dislikeNews(${idx})"${isDisliked ? ' disabled' : ''}>👎</button>
      </div>
      ${item.url ? `<a class="news-source-link" href="${escHtml(item.url)}" target="_blank" rel="noopener">元記事を読む →</a>` : ''}`;
    li.dataset.newsIndex = idx;
    list.appendChild(li);
  });

  // モードに応じた初期アクション
  _applyPlayModeUI(getPlayMode());
  if (getPlayMode() === 'voice') {
    setTimeout(() => startMainSpeak(), 400);
  } else {
    setTimeout(() => openReadingMode(), 400);
  }
}

// ─── 再生モード管理 ───────────────────────────────────────────────────────
function getPlayMode() {
  return S.settings.playMode || 'voice';
}

function setPlayMode(mode) {
  const cfg = S.settings;
  cfg.playMode = mode;
  S.saveSettings(cfg);
  _applyPlayModeUI(mode);
  if (mode === 'speakscreen') {
    stopMainSpeak();
    showToast('読み上げモード: 再生ボタンまたは「ここから再生」後、2本指で上からスワイプ');
  } else {
    closeReadingMode();
    showToast('音声モード: 再生ボタンで Kyoko が読み上げます');
  }
}

function _applyPlayModeUI(mode) {
  const isSpeak = mode === 'speakscreen';
  $('mode-btn-voice') ?.classList.toggle('active', !isSpeak);
  $('mode-btn-speak') ?.classList.toggle('active',  isSpeak);
}

function toggleMainSpeak() {
  if (getPlayMode() === 'speakscreen') {
    if (_isReadingModeActive()) {
      closeReadingMode();
    } else {
      if (mainChunkIdx >= mainChunks.length) mainChunkIdx = 0;
      openReadingMode();
    }
    return;
  }
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
  acquireWakeLock();
  updateMediaSession('playing');
  speakMainChunk();
}

function speakMainChunk() {
  if (!mainSpeaking || mainChunkIdx >= mainChunks.length) {
    mainSpeaking = false;
    $('play-btn').textContent          = '▶';
    $('main-chunk-info').textContent   = mainChunkIdx >= mainChunks.length ? '再生完了' : 'タップして再生';
    $('tts-progress-fill').style.width = mainChunkIdx >= mainChunks.length ? '100%' : '0%';
    if (mainChunkIdx >= mainChunks.length) mainChunkIdx = 0;
    releaseWakeLock();
    updateMediaSession('paused');
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
  releaseWakeLock();
  updateMediaSession('paused');
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

  const speakscreen = getPlayMode() === 'speakscreen';
  const items    = broadcast.news_items;
  const perChunk = mainChunks.length / items.length;

  function _jumpTo(idx) {
    mainChunkIdx = idx;
    if (speakscreen) {
      openReadingMode();
    } else {
      stopMainSpeak();
      startMainSpeak();
    }
  }

  if (newsIdx === 0) { _jumpTo(0); return; }

  // 「次のニュースです。」セパレータのN番目を探す
  let count = 0;
  for (let i = 0; i < mainChunks.length; i++) {
    if (mainChunks[i].includes('次のニュース')) {
      count++;
      if (count === newsIdx) { _jumpTo(i); return; }
    }
  }

  // フォールバック: 均等分割
  _jumpTo(Math.min(Math.floor(perChunk * 0.5 + newsIdx * perChunk), mainChunks.length - 1));
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
- 英語・アルファベット略語はカタカナのみで書き、アルファベット表記は一切使わない（例: AI→エーアイ、GDP→ジーディーピー）
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

  $('setting-max-per-cat').value = String(cfg.maxPerCategory ?? 2);
  $('setting-exclude').value = cfg.excludeKeywords || '';
  $('setting-length').value  = cfg.length          || 'standard';
  $('setting-tone').value    = cfg.tone            || 'casual';
  $('setting-rate').value    = String(cfg.speechRate ?? 1.0);
  $('setting-intro').value   = cfg.customIntro     || '';
  populateVoiceSelector();
  if (cfg.voiceName) $('setting-voice').value = cfg.voiceName;
  $('setting-cross-source').checked = cfg.crossSourceEnabled !== false;
  _applyPlayModeUI(cfg.playMode || 'voice');
  renderCustomCategories();
  renderSourceSettings();
  const profile = S.settings.aiProfile;
  if ($('profile-input')) $('profile-input').value = profile?.profileText || '';
  renderProfileResult(profile);
}

function renderProfileResult(rawProfile) {
  const el = $('profile-result');
  if (!el) return;
  const profile = migrateProfile(rawProfile);
  if (!profile?.analyzedAt) { el.style.display = 'none'; return; }

  const topicTag = (t, cls) => {
    const label = typeof t === 'string' ? t : t.topic;
    const w     = typeof t === 'string' ? 1  : t.weight;
    const extra = w >= 3 ? ' strong' : '';
    const badge = w > 1 ? ` <small class="weight-badge">×${w}</small>` : '';
    return `<span class="profile-tag ${cls}${extra}">${escHtml(label)}${badge}</span>`;
  };

  el.innerHTML = `
    <div class="profile-result-row">
      <span class="profile-result-label">興味あり</span>
      <div class="profile-tags">${(profile.positiveTopics || []).map(t => topicTag(t, '')).join('')}</div>
    </div>
    ${(profile.positiveAngles || []).length ? `
    <div class="profile-result-row">
      <span class="profile-result-label">視点</span>
      <div class="profile-tags">${profile.positiveAngles.map(t => topicTag(t, '')).join('')}</div>
    </div>` : ''}
    ${(profile.negativeTopics || []).length ? `
    <div class="profile-result-row">
      <span class="profile-result-label">興味なし</span>
      <div class="profile-tags">${(profile.negativeTopics || []).map(t => topicTag(t, 'negative')).join('')}</div>
    </div>` : ''}
    <div class="profile-analyzed-at">最終分析: ${new Date(profile.analyzedAt).toLocaleString('ja-JP')}</div>
    <button type="button" onclick="resetProfile()" class="btn-reset-profile">プロファイルをリセット</button>
  `;
  el.style.display = '';
}

function resetProfile() {
  if (!confirm('AIプロファイルをリセットしますか？すべてのトピックが削除されます。')) return;
  const cfg = S.settings;
  cfg.aiProfile = null;
  S.saveSettings(cfg);
  if ($('profile-input')) $('profile-input').value = '';
  renderProfileResult(null);
  showToast('プロファイルをリセットしました');
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

    const cfg     = S.settings;
    const profile = migrateProfile(cfg.aiProfile) || { profileText: '', positiveTopics: [], positiveAngles: [], negativeTopics: [], analyzedAt: null };
    profile.profileText    = text;
    profile.positiveTopics = mergeTopics(profile.positiveTopics, parsed.positiveTopics || []);
    profile.positiveAngles = parsed.positiveAngles || profile.positiveAngles || [];
    profile.negativeTopics = mergeTopics(profile.negativeTopics, parsed.negativeTopics || []);
    profile.analyzedAt     = new Date().toISOString();
    cfg.aiProfile = profile;
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
    excludeKeywords:  $('setting-exclude').value.trim(),
    length:           $('setting-length').value,
    tone:             $('setting-tone').value,
    speechRate:       parseFloat($('setting-rate').value),
    customIntro:      $('setting-intro').value.trim(),
    voiceName:        $('setting-voice').value,
    aiProfile:           S.settings.aiProfile || null,
    crossSourceEnabled:  $('setting-cross-source').checked,
    playMode:            S.settings.playMode || 'voice',
    maxPerCategory:      parseInt($('setting-max-per-cat').value, 10),
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

// ─── 原稿読み上げモード（iOS Speak Screen 用） ────────────────────────────
function _setRmBgText(fromIdx) {
  const bgText = $('rm-bg-text');
  if (!bgText) return false;

  // mainChunks があれば指定位置以降を使用、なければ home-script 全文
  let text = '';
  if (mainChunks && mainChunks.length) {
    text = mainChunks.slice(fromIdx || 0).join('');
  }
  if (!text) {
    const scriptEl = $('home-script');
    text = scriptEl ? scriptEl.textContent.trim() : '';
  }
  if (!text) return false;

  bgText.innerHTML = '';
  text.split(/\n+/).filter(l => l.trim()).forEach(line => {
    const p = document.createElement('p');
    p.textContent = line;
    bgText.appendChild(p);
  });
  return true;
}

function openReadingMode() {
  if (!_setRmBgText(mainChunkIdx)) {
    showToast('原稿がありません。先にニュースを読み込んでください');
    return;
  }

  // 通常UIをアクセシビリティツリーから除外 → Speak Screen は背後テキストだけ読む
  $('screen-main')?.setAttribute('aria-hidden', 'true');
  $('screen-onboarding')?.setAttribute('aria-hidden', 'true');
  $('rm-bg-text').removeAttribute('aria-hidden');

  $('rm-badge').style.display = 'flex';
  if (mainSpeaking) toggleMainSpeak();
}

function closeReadingMode() {
  const bgText = $('rm-bg-text');
  bgText.setAttribute('aria-hidden', 'true');
  bgText.innerHTML = '';
  $('screen-main')?.removeAttribute('aria-hidden');
  $('screen-onboarding')?.removeAttribute('aria-hidden');
  $('rm-badge').style.display = 'none';
}

function _isReadingModeActive() {
  return $('rm-badge')?.style.display === 'flex';
}

// ─── ユーティリティ ───────────────────────────────────────────────────────
let _cachedVoices = [];
const _JA_VOICE_NAMES = ['Kyoko', 'O-Ren', 'O-ren', 'Otoya'];

function _isJaVoice(v) {
  return v.lang.startsWith('ja') || _JA_VOICE_NAMES.some(n => v.name.includes(n));
}

function resolveVoice(name) {
  if (!name) return null;
  const live = speechSynthesis.getVoices();
  if (live.length > 0) _cachedVoices = live;
  return _cachedVoices.find(v => v.name === name) || null;
}

function reloadVoices() {
  speechSynthesis.cancel();
  _cachedVoices = [];
  setTimeout(() => {
    const live = speechSynthesis.getVoices();
    if (live.length > 0) _cachedVoices = live;
    populateVoiceSelector();
    const count = _cachedVoices.filter(_isJaVoice).length;
    showToast(`日本語の声: ${count}件`);
  }, 300);
}

function testVoice() {
  const sel = $('setting-voice');
  const name = sel ? sel.value : '';
  const voice = resolveVoice(name);
  const utt = new SpeechSynthesisUtterance('こんにちは。これはテスト再生です。');
  utt.lang = 'ja-JP';
  utt.rate = parseFloat($('setting-rate')?.value || '1.0');
  if (voice) {
    utt.voice = voice;
    showToast(`テスト再生: ${voice.name}`);
  } else {
    showToast(name ? `⚠️ 声が見つかりません: ${name}` : 'テスト再生: デフォルト');
  }
  // iOS: cancel() 直後に speak() すると無視されるため少し待つ
  speechSynthesis.cancel();
  setTimeout(() => {
    speechSynthesis.resume();
    speechSynthesis.speak(utt);
  }, 150);
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
  const all = speechSynthesis.getVoices();
  if (all.length > 0) _cachedVoices = all;

  const sel = $('setting-voice');
  if (!sel) return;

  const jaVoices  = _cachedVoices.filter(_isJaVoice);
  const otherVoices = _cachedVoices.filter(v => !_isJaVoice(v));

  sel.innerHTML = '<option value="">システムデフォルト</option>';

  if (jaVoices.length) {
    const grp = document.createElement('optgroup');
    grp.label = '🇯🇵 日本語';
    jaVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = v.name;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  }

  if (otherVoices.length) {
    const grp = document.createElement('optgroup');
    grp.label = 'その他（Siri声など日本語の可能性あり）';
    otherVoices.sort((a, b) => a.name.localeCompare(b.name)).forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = v.lang ? `${v.name} (${v.lang})` : v.name;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  }

  const saved = S.settings.voiceName || '';
  if (saved) sel.value = saved;
}

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener('voiceschanged', populateVoiceSelector);
  populateVoiceSelector();
}

// ─── 起動 ─────────────────────────────────────────────────────────────────
init();
