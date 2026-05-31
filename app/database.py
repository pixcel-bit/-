from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Boolean
from sqlalchemy.orm import DeclarativeBase, Session

engine = create_engine("sqlite:///./news_radio.db", connect_args={"check_same_thread": False})


class Base(DeclarativeBase):
    pass


class Broadcast(Base):
    __tablename__ = "broadcasts"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String(10), unique=True, index=True)  # YYYY-MM-DD
    script = Column(Text, nullable=False)
    audio_path = Column(String(255), nullable=True)
    news_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_ready = Column(Boolean, default=False)


class NewsItem(Base):
    __tablename__ = "news_items"

    id = Column(Integer, primary_key=True, index=True)
    broadcast_date = Column(String(10), index=True)
    title = Column(String(500))
    summary = Column(Text)
    url = Column(String(1000))
    source = Column(String(100))
    category = Column(String(50))
    published_at = Column(DateTime, nullable=True)


def init_db():
    Base.metadata.create_all(bind=engine)


def get_session() -> Session:
    return Session(engine)
