from fastapi import APIRouter

from app.api.routes import health, meetings

# Everything lives under /api: the meetings resource (PROJECT.md section 4)
# and a readiness probe that checks the database answers.
api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(meetings.router)
