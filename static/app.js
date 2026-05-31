const API = "";
let pollingTimer = null;
let currentDate = null;

async function init() {
  const today = new Date().toISOString().split("T")[0];
  await loadArchive();
  await checkAndLoadBroadcast(today);
}

async function checkAndLoadBroadcast(dateStr) {
  currentDate = dateStr;

  // ステータス確認
  const statusRes = await fetch(`${API}/api/status/${dateStr}`);
  const status = await statusRes.json();

  if (status.status === "running") {
    showGenerating();
    startPolling(dateStr);
    return;
  }

  // 放送データ取得試行
  const res = await fetch(`${API}/api/broadcasts/${dateStr}`);
  if (res.ok) {
    const data = await res.json();
    showPlayer(data);
  } else {
    // 今日分のみ空状態を表示（過去分はスキップ）
    const today = new Date().toISOString().split("T")[0];
    if (dateStr === today) {
      showEmpty();
    }
  }
}

function showPlayer(data) {
  stopPolling();
  hide("generating-section");
  hide("empty-section");

  const dateObj = new Date(data.date + "T00:00:00");
  const formatted = dateObj.toLocaleDateString("ja-JP", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });

  document.getElementById("broadcast-date").textContent = formatted;
  document.getElementById("news-count").textContent = `${data.news_count}件のニュース`;
  document.getElementById("script-text").textContent = data.script;

  const audioPlayer = document.getElementById("audio-player");
  const audioSource = document.getElementById("audio-source");

  if (data.audio_url) {
    audioSource.src = data.audio_url;
    audioPlayer.load();
    document.getElementById("on-air-badge").style.display = "inline-block";
  } else {
    audioPlayer.style.display = "none";
    document.getElementById("on-air-badge").style.display = "none";
  }

  const newsList = document.getElementById("news-list");
  newsList.innerHTML = "";
  for (const item of data.news_items) {
    const li = document.createElement("li");
    li.className = "news-item";
    li.innerHTML = `
      <div class="news-item-header">
        <span class="news-category">${item.category}</span>
        <span class="news-source">${item.source}</span>
      </div>
      <div class="news-title"><a href="${item.url}" target="_blank" rel="noopener">${item.title}</a></div>
      <div class="news-summary">${item.summary}</div>
    `;
    newsList.appendChild(li);
  }

  show("player-section");
}

function showGenerating() {
  hide("player-section");
  hide("empty-section");
  show("generating-section");
}

function showEmpty() {
  hide("player-section");
  hide("generating-section");
  show("empty-section");
}

async function startGeneration() {
  const today = new Date().toISOString().split("T")[0];
  const btn = document.querySelector(".generate-btn");
  btn.disabled = true;

  showGenerating();

  try {
    await fetch(`${API}/api/generate`, { method: "POST" });
    startPolling(today);
  } catch (e) {
    showEmpty();
    btn.disabled = false;
    alert("生成の開始に失敗しました: " + e.message);
  }
}

function startPolling(dateStr) {
  stopPolling();
  pollingTimer = setInterval(async () => {
    const res = await fetch(`${API}/api/status/${dateStr}`);
    const status = await res.json();
    if (status.status === "done") {
      stopPolling();
      await checkAndLoadBroadcast(dateStr);
      await loadArchive();
    } else if (status.status === "error") {
      stopPolling();
      showEmpty();
      alert("放送生成中にエラーが発生しました。しばらく後に再試行してください。");
    }
  }, 5000);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

async function loadArchive() {
  const res = await fetch(`${API}/api/broadcasts`);
  const broadcasts = await res.json();
  const list = document.getElementById("archive-list");

  if (broadcasts.length === 0) {
    list.innerHTML = '<li class="loading">まだ放送がありません</li>';
    return;
  }

  list.innerHTML = "";
  for (const b of broadcasts) {
    const dateObj = new Date(b.date + "T00:00:00");
    const formatted = dateObj.toLocaleDateString("ja-JP", {
      year: "numeric", month: "long", day: "numeric", weekday: "short",
    });
    const li = document.createElement("li");
    li.className = "archive-item";
    li.innerHTML = `
      <div>
        <div class="archive-date">${formatted}</div>
        <div class="archive-meta">${b.news_count}件のニュース</div>
      </div>
      <span class="archive-play">${b.has_audio ? "▶" : "📄"}</span>
    `;
    li.onclick = () => checkAndLoadBroadcast(b.date);
    list.appendChild(li);
  }
}

function setSpeed(rate) {
  const player = document.getElementById("audio-player");
  player.playbackRate = rate;
  document.querySelectorAll(".speed-btn").forEach(btn => {
    btn.classList.toggle("active", parseFloat(btn.textContent) === rate);
  });
}

function show(id) { document.getElementById(id).style.display = ""; }
function hide(id) { document.getElementById(id).style.display = "none"; }

init();
