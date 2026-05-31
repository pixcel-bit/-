import os
import asyncio
from datetime import datetime, date
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from .database import init_db, get_session, Broadcast, NewsItem
from .collector import fetch_news
from .script_gen import generate_script
from .tts import synthesize
from .scheduler import start_scheduler

_generation_lock = asyncio.Lock()
_generation_status: dict[str, str] = {}  # date -> "running" | "done" | "error"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    start_scheduler(run_daily_broadcast)
    yield


app = FastAPI(title="Daily News Radio", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/audio", StaticFiles(directory="audio"), name="audio")
app.mount("/static", StaticFiles(directory="static"), name="static")


async def run_daily_broadcast(target_date: str | None = None):
    date_str = target_date or date.today().isoformat()

    async with _generation_lock:
        if _generation_status.get(date_str) == "running":
            return
        _generation_status[date_str] = "running"

    try:
        with get_session() as session:
            existing = session.query(Broadcast).filter_by(date=date_str).first()
            if existing and existing.is_ready:
                _generation_status[date_str] = "done"
                return
            if not existing:
                broadcast = Broadcast(date=date_str, script="", is_ready=False)
                session.add(broadcast)
                session.commit()

        print(f"[{date_str}] ニュース収集開始")
        news_items = await fetch_news()

        if not news_items:
            raise ValueError("ニュースを取得できませんでした")

        print(f"[{date_str}] {len(news_items)}件取得 → スクリプト生成")
        script = await generate_script(news_items, date_str)

        print(f"[{date_str}] 音声合成開始")
        audio_path = await synthesize(script, date_str)

        with get_session() as session:
            broadcast = session.query(Broadcast).filter_by(date=date_str).first()
            if not broadcast:
                broadcast = Broadcast(date=date_str)
                session.add(broadcast)
            broadcast.script = script
            broadcast.audio_path = audio_path
            broadcast.news_count = len(news_items)
            broadcast.is_ready = True
            session.commit()

            for item in news_items:
                news = NewsItem(
                    broadcast_date=date_str,
                    title=item.title,
                    summary=item.summary,
                    url=item.url,
                    source=item.source,
                    category=item.category,
                    published_at=item.published_at,
                )
                session.add(news)
            session.commit()

        _generation_status[date_str] = "done"
        print(f"[{date_str}] 放送準備完了")

    except Exception as e:
        _generation_status[date_str] = "error"
        print(f"[{date_str}] エラー: {e}")
        raise


@app.get("/")
async def index():
    return FileResponse("static/index.html")


@app.get("/api/broadcasts")
async def list_broadcasts():
    with get_session() as session:
        broadcasts = (
            session.query(Broadcast)
            .filter_by(is_ready=True)
            .order_by(Broadcast.date.desc())
            .limit(30)
            .all()
        )
        return [
            {
                "date": b.date,
                "news_count": b.news_count,
                "created_at": b.created_at.isoformat(),
                "has_audio": bool(b.audio_path and Path(b.audio_path).exists()),
            }
            for b in broadcasts
        ]


@app.get("/api/broadcasts/{date_str}")
async def get_broadcast(date_str: str):
    with get_session() as session:
        broadcast = session.query(Broadcast).filter_by(date=date_str).first()
        if not broadcast or not broadcast.is_ready:
            raise HTTPException(status_code=404, detail="放送が見つかりません")

        news_items = (
            session.query(NewsItem)
            .filter_by(broadcast_date=date_str)
            .all()
        )

        return {
            "date": broadcast.date,
            "script": broadcast.script,
            "news_count": broadcast.news_count,
            "audio_url": f"/audio/{date_str}.mp3" if broadcast.audio_path and Path(broadcast.audio_path).exists() else None,
            "created_at": broadcast.created_at.isoformat(),
            "news_items": [
                {
                    "title": n.title,
                    "summary": n.summary,
                    "url": n.url,
                    "source": n.source,
                    "category": n.category,
                }
                for n in news_items
            ],
        }


@app.post("/api/generate")
async def trigger_generation(background_tasks: BackgroundTasks, target_date: str | None = None):
    date_str = target_date or date.today().isoformat()
    status = _generation_status.get(date_str)

    if status == "running":
        return JSONResponse({"status": "running", "date": date_str})

    background_tasks.add_task(run_daily_broadcast, date_str)
    _generation_status[date_str] = "running"
    return JSONResponse({"status": "started", "date": date_str})


@app.get("/api/status/{date_str}")
async def get_status(date_str: str):
    status = _generation_status.get(date_str, "unknown")

    with get_session() as session:
        broadcast = session.query(Broadcast).filter_by(date=date_str).first()
        if broadcast and broadcast.is_ready:
            status = "done"

    return {"date": date_str, "status": status}
