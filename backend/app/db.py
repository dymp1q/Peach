from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    """Declarative base shared by every ORM model."""


# pool_pre_ping tests a pooled connection before handing it out, so after the
# database restarts the pool drops dead connections and reconnects on its own.
engine: AsyncEngine = create_async_engine(get_settings().database_url, pool_pre_ping=True)
SessionFactory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a session that commits on success, rolls back on error."""
    async with SessionFactory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# scope="function": the session closes - and commits - BEFORE the response is
# sent. With FastAPI's default ("request") it closes after, so a client that
# re-reads right after a 201 could get the list without the row it just made.
SessionDep = Annotated[AsyncSession, Depends(get_session, scope="function")]
