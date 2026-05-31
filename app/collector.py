import os
import httpx
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import NamedTuple

RSS_SOURCES = [
    {"url": "https://www3.nhk.or.jp/rss/news/cat0.xml",  "source": "NHK",        "category": "総合"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat1.xml",  "source": "NHK",        "category": "政治"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat3.xml",  "source": "NHK",        "category": "経済"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat5.xml",  "source": "NHK",        "category": "国際"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat7.xml",  "source": "NHK",        "category": "科学・文化"},
    {"url": "https://gigazine.net/news/rss_2.0/",        "source": "Gigazine",   "category": "テクノロジー"},
    {"url": "https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml", "source": "ITmedia", "category": "テクノロジー"},
]

MAX_ITEMS_PER_SOURCE = 5
MAX_TOTAL_ITEMS = 20

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/rss+xml, application/atom+xml, text/xml, */*",
}

DEMO_NEWS = [
    ("政治", "NHK", "岸田首相、経済対策の新たなパッケージを発表", "政府は物価高対策として総額5兆円規模の経済パッケージを発表。エネルギー支援や中小企業への補助金が柱となる。", "https://nhk.jp"),
    ("経済", "NHK", "日経平均株価、今年最高値を更新　38,500円台に", "東京株式市場で日経平均が上昇し、今年の最高値を更新した。半導体関連株が牽引した。", "https://nhk.jp"),
    ("国際", "NHK", "米国・中国首脳が電話会談　貿易問題で協議", "バイデン大統領と習近平国家主席が電話会談を行い、貿易摩擦の緩和に向けた協議を行ったことが明らかになった。", "https://nhk.jp"),
    ("テクノロジー", "Gigazine", "OpenAI、新モデル「GPT-5」を発表　性能が大幅向上", "OpenAIが次世代大規模言語モデルを発表。前モデル比で推論能力が2倍以上に向上したとしている。", "https://gigazine.net"),
    ("テクノロジー", "ITmedia", "Appleが新型iPhone発表　チタン筐体とAI機能を強化", "新型iPhoneが発表され、チタン製フレームの採用と独自AIアシスタントの大幅強化が注目を集めている。", "https://itmedia.co.jp"),
    ("科学・文化", "NHK", "iPS細胞を使った心臓病治療、臨床試験で良好な結果", "京都大学の研究チームがiPS細胞由来の心筋細胞を使った心臓病治療の臨床試験で有効性を確認した。", "https://nhk.jp"),
    ("総合", "NHK", "能登半島地震の復興支援、新たな住宅再建補助制度を創設", "政府は能登半島地震の被災地における住宅再建を加速するため、新たな補助制度を創設すると発表した。", "https://nhk.jp"),
    ("経済", "NHK", "円相場、1ドル148円台　日銀の政策変更観測が影響", "外国為替市場で円が対ドルで下落し148円台となった。日銀が追加利上げを見送るとの観測が広がっている。", "https://nhk.jp"),
]


class NewsEntry(NamedTuple):
    title: str
    summary: str
    url: str
    source: str
    category: str
    published_at: datetime | None


def _parse_rss(xml_text: str, source: str, category: str) -> list[NewsEntry]:
    entries: list[NewsEntry] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return entries

    ns = {"atom": "http://www.w3.org/2005/Atom"}

    items = root.findall(".//item")
    for item in items[:MAX_ITEMS_PER_SOURCE]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        description = (item.findtext("description") or title).strip()
        pub_date_str = item.findtext("pubDate") or ""

        pub_date = None
        if pub_date_str:
            try:
                pub_date = parsedate_to_datetime(pub_date_str).replace(tzinfo=None)
            except Exception:
                pass

        if title and link:
            entries.append(NewsEntry(
                title=title, summary=description[:500], url=link,
                source=source, category=category, published_at=pub_date,
            ))

    # Atom フォールバック
    if not entries:
        for entry in root.findall(".//atom:entry", ns)[:MAX_ITEMS_PER_SOURCE]:
            title = (entry.findtext("atom:title", namespaces=ns) or "").strip()
            link_el = entry.find("atom:link", ns)
            link = link_el.get("href", "") if link_el is not None else ""
            summary = (entry.findtext("atom:summary", namespaces=ns) or title).strip()
            if title and link:
                entries.append(NewsEntry(
                    title=title, summary=summary[:500], url=link,
                    source=source, category=category, published_at=None,
                ))

    return entries


def _demo_news() -> list[NewsEntry]:
    now = datetime.now()
    return [
        NewsEntry(title=title, summary=summary, url=url,
                  source=source, category=category, published_at=now)
        for category, source, title, summary, url in DEMO_NEWS
    ]


async def fetch_news() -> list[NewsEntry]:
    if os.environ.get("DEMO_MODE", "").lower() == "true":
        print("[collector] デモモードでサンプルニュースを使用")
        return _demo_news()

    results: list[NewsEntry] = []
    seen_titles: set[str] = set()

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=HEADERS) as client:
        for cfg in RSS_SOURCES:
            try:
                resp = await client.get(cfg["url"])
                resp.raise_for_status()
                entries = _parse_rss(resp.text, cfg["source"], cfg["category"])
                for entry in entries:
                    if entry.title not in seen_titles:
                        seen_titles.add(entry.title)
                        results.append(entry)
            except Exception as e:
                print(f"[collector] {cfg['source']} 取得失敗: {e}")

    if not results:
        print("[collector] RSS取得失敗 → デモデータにフォールバック")
        return _demo_news()

    return results[:MAX_TOTAL_ITEMS]
