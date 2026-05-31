import os
from anthropic import AsyncAnthropic
from .collector import NewsEntry

client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

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

出力はそのまま音声合成にかけられる原稿テキストのみ。
見出しや説明文は不要。
"""


async def generate_script(news_items: list[NewsEntry], date_str: str) -> str:
    news_text = "\n\n".join([
        f"【{item.category}】{item.source}\nタイトル: {item.title}\n概要: {item.summary}"
        for item in news_items
    ])

    user_message = f"""
今日の日付: {date_str}
ニュース件数: {len(news_items)}件

以下のニュースをもとにラジオ原稿を作成してください。

{news_text}
"""

    response = await client.messages.create(
        model="claude-opus-4-8",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    return response.content[0].text
