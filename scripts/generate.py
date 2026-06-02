"""
GitHub Actions から毎日実行。
RSS からニュースを取得して data/YYYY-MM-DD-news.json に保存するだけ。
スクリプト生成・音声合成はブラウザ側でユーザーごとに行うため、ここでは不要。
"""
import json
import asyncio
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path

import httpx

REPO_ROOT = Path(__file__).parent.parent
DATA_DIR  = REPO_ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

JST = timezone(timedelta(hours=9))

RSS_SOURCES = [
    {"url": "https://www3.nhk.or.jp/rss/news/cat0.xml",          "source": "NHK",      "category": "総合"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat1.xml",          "source": "NHK",      "category": "政治"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat3.xml",          "source": "NHK",      "category": "経済"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat5.xml",          "source": "NHK",      "category": "国際"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat7.xml",          "source": "NHK",      "category": "科学・文化"},
    {"url": "https://gigazine.net/news/rss_2.0/",                 "source": "Gigazine", "category": "テクノロジー"},
    {"url": "https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml", "source": "ITmedia",  "category": "テクノロジー"},
]

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; NewsRadioBot/1.0; +https://github.com)"}


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
        pub_dt = None
        if pub := el.findtext("pubDate") or "":
            try:
                pub_dt = parsedate_to_datetime(pub).replace(tzinfo=None).isoformat()
            except Exception:
                pass
        if title and link:
            items.append({"title": title, "summary": desc[:400], "url": link,
                          "source": source, "category": category, "published_at": pub_dt})
    return items


async def fetch_all_news() -> list[dict]:
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
    return results[:30]  # ブラウザ側でフィルタするので多めに保存


def update_index(date_str: str, news_count: int):
    path  = DATA_DIR / "index.json"
    index = []
    if path.exists():
        try:
            index = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    index = [e for e in index if e["date"] != date_str]
    index.insert(0, {"date": date_str, "news_count": news_count,
                     "fetched_at": datetime.utcnow().isoformat()})
    path.write_text(json.dumps(index[:30], ensure_ascii=False, indent=2), encoding="utf-8")


async def main():
    date_str  = date.today().isoformat()
    news_file = DATA_DIR / f"{date_str}-news.json"

    if news_file.exists():
        print(f"{date_str} のニュースは取得済みです。スキップします。")
        sys.exit(0)

    print(f"[{date_str}] RSS ニュース取得開始")
    news_items = await fetch_all_news()
    if not news_items:
        raise SystemExit("ニュースを取得できませんでした")

    news_file.write_text(json.dumps({
        "date": date_str,
        "news_items": news_items,
        "fetched_at": datetime.utcnow().isoformat(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    update_index(date_str, len(news_items))

    # 30日より古いニュースファイルを削除
    for f in sorted(DATA_DIR.glob("*-news.json"))[:-30]:
        f.unlink()

    print(f"[{date_str}] 完了（{len(news_items)}件）")


if __name__ == "__main__":
    asyncio.run(main())
