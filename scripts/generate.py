"""
GitHub Actions から毎日実行されるニュース生成スクリプト。
data/config.json の設定を読み込んで動作を制御する。
"""
import os
import json
import asyncio
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone, timedelta
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

JST = timezone(timedelta(hours=9))

# ── RSS ソース ────────────────────────────────────────────────────────────
ALL_RSS_SOURCES = [
    {"url": "https://www3.nhk.or.jp/rss/news/cat0.xml",           "source": "NHK",      "category": "総合"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat1.xml",           "source": "NHK",      "category": "政治"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat3.xml",           "source": "NHK",      "category": "経済"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat5.xml",           "source": "NHK",      "category": "国際"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat7.xml",           "source": "NHK",      "category": "科学・文化"},
    {"url": "https://gigazine.net/news/rss_2.0/",                  "source": "Gigazine", "category": "テクノロジー"},
    {"url": "https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml",  "source": "ITmedia",  "category": "テクノロジー"},
]

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; NewsRadioBot/1.0; +https://github.com)"}

DAYS_MAP = {0: "mon", 1: "tue", 2: "wed", 3: "thu", 4: "fri", 5: "sat", 6: "sun"}

LENGTH_INSTRUCTIONS = {
    "short":    "約3分（800文字程度）で読めるコンパクトな",
    "standard": "約5分（1500文字程度）の",
    "long":     "約10分（3000文字程度）の詳しい",
}

TONE_INSTRUCTIONS = {
    "professional": "プロフェッショナルで落ち着いた",
    "casual":       "友達に話すような親しみやすいカジュアルな",
    "cheerful":     "明るく元気な朝らしい",
}


# ── 設定読み込み ──────────────────────────────────────────────────────────
def load_config() -> dict:
    defaults = {
        "schedule": {"enabled": True, "days": list(DAYS_MAP.values())},
        "news":     {"categories": ["総合","政治","経済","国際","科学・文化","テクノロジー"],
                     "max_items": 15, "focus_keywords": [], "exclude_keywords": []},
        "style":    {"length": "standard", "tone": "casual", "custom_intro": ""},
    }
    path = DATA_DIR / "config.json"
    if not path.exists():
        return defaults
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
        # 存在しないキーをデフォルト値で補完
        for section, values in defaults.items():
            cfg.setdefault(section, {})
            for k, v in values.items():
                cfg[section].setdefault(k, v)
        return cfg
    except Exception as e:
        print(f"  config.json 読み込み失敗、デフォルトを使用: {e}")
        return defaults


# ── スケジュールチェック ──────────────────────────────────────────────────
def should_run(config: dict) -> tuple[bool, str]:
    if not config["schedule"]["enabled"]:
        return False, "毎日生成がOFFに設定されています"
    today_day = DAYS_MAP[datetime.now(JST).weekday()]
    if today_day not in config["schedule"]["days"]:
        return False, f"今日({today_day})は実行対象外の曜日です"
    return True, ""


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


async def fetch_news(config: dict) -> list[dict]:
    active_categories = set(config["news"]["categories"])
    sources = [s for s in ALL_RSS_SOURCES if s["category"] in active_categories]

    results, seen = [], set()
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=HEADERS) as client:
        for cfg in sources:
            try:
                r = await client.get(cfg["url"])
                r.raise_for_status()
                for item in parse_rss(r.text, cfg["source"], cfg["category"]):
                    if item["title"] not in seen:
                        seen.add(item["title"])
                        results.append(item)
            except Exception as e:
                print(f"  RSS取得失敗 {cfg['source']}: {e}")

    results = filter_and_sort_news(results, config)
    print(f"  {len(results)} 件取得（フィルタ後）")
    return results


def filter_and_sort_news(items: list[dict], config: dict) -> list[dict]:
    focus   = [k.strip().lower() for k in config["news"]["focus_keywords"]   if k.strip()]
    exclude = [k.strip().lower() for k in config["news"]["exclude_keywords"] if k.strip()]
    max_n   = config["news"]["max_items"]

    filtered = []
    for item in items:
        text = (item["title"] + " " + item["summary"]).lower()
        if any(kw in text for kw in exclude):
            continue
        filtered.append(item)

    if focus:
        def priority(item):
            text = (item["title"] + " " + item["summary"]).lower()
            return -sum(1 for kw in focus if kw in text)
        filtered.sort(key=priority)

    return filtered[:max_n]


# ── スクリプト生成 ────────────────────────────────────────────────────────
def build_system_prompt(config: dict) -> str:
    style      = config["style"]
    length_str = LENGTH_INSTRUCTIONS.get(style.get("length", "standard"), LENGTH_INSTRUCTIONS["standard"])
    tone_str   = TONE_INSTRUCTIONS.get(style.get("tone", "casual"),       TONE_INSTRUCTIONS["casual"])

    prompt = f"""
あなたはプロのラジオパーソナリティです。
{length_str}ラジオ番組風の読み上げ原稿を、{tone_str}トーンで作成してください。

【原稿の構成】
1. オープニング（挨拶・日付・今日の見どころ）
2. 各ニュースコーナー（重要度順）
3. エンディング（締めの言葉）

【文体ルール】
- です・ます調で話し言葉として自然に
- 難しい用語は噛み砕いて説明
- 「。」で文を区切り音声合成が読みやすいよう配慮
- 括弧・記号（「」【】★）は最小限に
- 略語は読み仮名を添える（例：AI（エーアイ））

出力は音声合成にかけられる原稿テキストのみ。見出しや説明文は不要。
"""
    if intro := style.get("custom_intro", "").strip():
        prompt += f"\n【オープニング定型文】\nオープニングで必ず次の言葉を含めてください：\n{intro}\n"

    return prompt


def build_user_message(news_items: list[dict], date_str: str, config: dict) -> str:
    focus   = [k.strip() for k in config["news"]["focus_keywords"]   if k.strip()]
    exclude = [k.strip() for k in config["news"]["exclude_keywords"] if k.strip()]

    lines = [f"今日の日付: {date_str}"]
    if focus:
        lines.append(f"重視するトピック: {', '.join(focus)}")
    if exclude:
        lines.append(f"除外するトピック: {', '.join(exclude)}")
    lines.append("")
    lines += [
        f"【{n['category']}】{n['source']}\nタイトル: {n['title']}\n概要: {n['summary']}"
        for n in news_items
    ]
    return "\n\n".join(lines)


async def generate_script(news_items: list[dict], date_str: str, config: dict) -> str:
    client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response = await client.messages.create(
        model="claude-opus-4-8",
        max_tokens=4096,
        system=build_system_prompt(config),
        messages=[{"role": "user", "content": build_user_message(news_items, date_str, config)}],
    )
    return response.content[0].text


# ── 音声合成 ──────────────────────────────────────────────────────────────
def synthesize(script: str, output_path: Path):
    gTTS(text=script, lang="ja", slow=False).save(str(output_path))


# ── index.json 更新 ───────────────────────────────────────────────────────
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
                     "has_audio": True, "generated_at": datetime.utcnow().isoformat()})
    path.write_text(json.dumps(index[:30], ensure_ascii=False, indent=2), encoding="utf-8")


# ── メイン ────────────────────────────────────────────────────────────────
async def main():
    config   = load_config()
    ok, reason = should_run(config)
    if not ok:
        print(f"スキップ: {reason}")
        sys.exit(0)

    date_str   = date.today().isoformat()
    data_file  = DATA_DIR  / f"{date_str}.json"
    audio_file = AUDIO_DIR / f"{date_str}.mp3"

    if data_file.exists() and audio_file.exists():
        print(f"{date_str} は生成済みです。スキップします。")
        sys.exit(0)

    print(f"[{date_str}] ニュース収集開始")
    news_items = await fetch_news(config)
    if not news_items:
        raise SystemExit("ニュースを取得できませんでした")

    print(f"[{date_str}] スクリプト生成（長さ:{config['style']['length']} / トーン:{config['style']['tone']}）")
    script = await generate_script(news_items, date_str, config)

    print(f"[{date_str}] 音声合成")
    synthesize(script, audio_file)

    data_file.write_text(json.dumps({
        "date": date_str,
        "news_count": len(news_items),
        "script": script,
        "audio_file": f"audio/{date_str}.mp3",
        "news_items": news_items,
        "generated_at": datetime.utcnow().isoformat(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    update_index(date_str, len(news_items))

    for mp3 in sorted(AUDIO_DIR.glob("*.mp3"))[:-30]:
        mp3.unlink()

    print(f"[{date_str}] 完了")


if __name__ == "__main__":
    asyncio.run(main())
