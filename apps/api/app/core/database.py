from collections.abc import Iterator
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

# SQLite compatibility settings if running local dev/testing
connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(settings.DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)

if settings.DATABASE_URL.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection: Any, connection_record: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
