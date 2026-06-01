"""
GitHub Actions から毎日実行されるニュース生成スクリプト。
data/YYYY-MM-DD.json と audio/YYYY-MM-DD.mp3 を生成してリポジトリに保存する。
"""
import os
import json
import asyncio
import xml.etree.ElementTree as ET
from datetime import date, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path

import httpx
from anthropic import AsyncAnthropic
from gtts import gTTS

# ── パス設定 ───────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).parent.parent
DATA_DIR  = REPO_ROOT / "data"
AUDIO_DIR = REPO_ROOT / "audio"
DATA_DIR.mkdir(exist_ok=True)
AUDIO_DIR.mkdir(exist_ok=True)

# ── RSS ソース ────────────────────────────────────────────────────────────
RSS_SOURCES = [
    {"url": "https://www3.nhk.or.jp/rss/news/cat0.xml",  "source": "NHK",        "category": "総合"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat1.xml",  "source": "NHK",        "category": "政治"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat3.xml",  "source": "NHK",        "category": "経済"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat5.xml",  "source": "NHK",        "category": "国際"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat7.xml",  "source": "NHK",        "category": "科学・文化"},
    {"url": "https://gigazine.net/news/rss_2.0/",        "source": "Gigazine",   "category": "テクノロジー"},
    {"url": "https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml", "source": "ITmedia", "category": "テクノロジー"},
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NewsRadioBot/1.0; +https://github.com)",
}

SYSTEM_PROMPT = """
あなたはプロのラジオパーソナリティです。
提供されたニュース一覧をもとに、聴取者が朝の通勤・家事中に聴ける、
自然で親しみやすいラジオ番組風の読み上げ原稿を作成してください。

【原稿の構成】
1. オープニング（挨拶・日付・今日の見どころ30秒程度）
2. 各ニュースコーナー（1項目あたり60〜90秒、重要度順）
3. エンディング（締めの言葉・明日への一言）

【文体ルール】
- です・ます調で話し言葉として自然に
- 難しい用語は噛み砕いて説明
- 数字・固有名詞は正確に
- 「。」で文を区切り、音声合成が読みやすいよう配慮
- 括弧や記号（「」『』【】★☆）は最小限に
- 全角英数字・略語は読み仮名を（例：AI（エーアイ））

出力はそのまま音声合成にかけられる原稿テキストのみ。見出しや説明文は不要。
"""


# ── ニュース取得 ──────────────────────────────────────────────────────────
def parse_rss(xml_text: str, source: str, category: str) -> list[dict]:
    items = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return items

    for el in root.findall(".//item")[:5]:
        title = (el.findtext("title") or "").strip()
        link  = (el.findtext("link")  or "").strip()
        desc  = (el.findtext("description") or title).strip()
        pub   = el.findtext("pubDate") or ""
        pub_dt = None
        if pub:
            try:
                pub_dt = parsedate_to_datetime(pub).replace(tzinfo=None).isoformat()
            except Exception:
                pass
        if title and link:
            items.append({"title": title, "summary": desc[:400], "url": link,
                          "source": source, "category": category, "published_at": pub_dt})
    return items


async def fetch_news() -> list[dict]:
    results, seen = [], set()
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=HEADERS) as client:
        for cfg in RSS_SOURCES:
            try:
                r = await client.get(cfg["url"])
                r.raise_for_status()
                for item in parse_rss(r.text, cfg["source"], cfg["category"]):
                    if item["title"] not in seen:
                        seen.add(item["title"])
                        results.append(item)
            except Exception as e:
                print(f"  RSS取得失敗 {cfg['source']}: {e}")
    print(f"  {len(results)} 件取得")
    return results[:20]


# ── スクリプト生成 ────────────────────────────────────────────────────────
async def generate_script(news_items: list[dict], date_str: str) -> str:
    key = os.environ["ANTHROPIC_API_KEY"]
    client = AsyncAnthropic(api_key=key)

    news_text = "\n\n".join([
        f"【{n['category']}】{n['source']}\nタイトル: {n['title']}\n概要: {n['summary']}"
        for n in news_items
    ])

    response = await client.messages.create(
        model="claude-opus-4-8",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"今日の日付: {date_str}\n\n{news_text}"}],
    )
    return response.content[0].text


# ── 音声合成 ──────────────────────────────────────────────────────────────
def synthesize(script: str, output_path: Path):
    tts = gTTS(text=script, lang="ja", slow=False)
    tts.save(str(output_path))


# ── index.json 更新 ───────────────────────────────────────────────────────
def update_index(date_str: str, news_count: int):
    index_path = DATA_DIR / "index.json"
    index = []
    if index_path.exists():
        try:
            index = json.loads(index_path.read_text())
        except Exception:
            index = []

    # 同じ日付があれば上書き
    index = [e for e in index if e["date"] != date_str]
    index.insert(0, {
        "date": date_str,
        "news_count": news_count,
        "has_audio": True,
        "generated_at": datetime.utcnow().isoformat(),
    })
    # 最新30件のみ保持
    index = index[:30]
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2))


# ── メイン ────────────────────────────────────────────────────────────────
async def main():
    date_str = date.today().isoformat()
    data_file  = DATA_DIR  / f"{date_str}.json"
    audio_file = AUDIO_DIR / f"{date_str}.mp3"

    if data_file.exists() and audio_file.exists():
        print(f"{date_str} は生成済みです。スキップします。")
        return

    print(f"[{date_str}] ニュース収集開始")
    news_items = await fetch_news()
    if not news_items:
        raise SystemExit("ニュースを取得できませんでした")

    print(f"[{date_str}] スクリプト生成")
    script = await generate_script(news_items, date_str)

    print(f"[{date_str}] 音声合成")
    synthesize(script, audio_file)

    data_file.write_text(json.dumps({
        "date": date_str,
        "news_count": len(news_items),
        "script": script,
        "audio_file": f"audio/{date_str}.mp3",
        "news_items": news_items,
        "generated_at": datetime.utcnow().isoformat(),
    }, ensure_ascii=False, indent=2))

    update_index(date_str, len(news_items))

    # 30日より古い音声ファイルを削除
    for mp3 in sorted(AUDIO_DIR.glob("*.mp3"))[:-30]:
        mp3.unlink()

    print(f"[{date_str}] 完了")


if __name__ == "__main__":
    asyncio.run(main())
