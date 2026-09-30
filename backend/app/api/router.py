from fastapi import APIRouter, Depends

from app.api.routes import health, items, me, meetings
from app.auth import current_user

# Everything under /api/v1 needs a signed-in user. Declared once here, so a new
# route cannot be added unprotected by forgetting a parameter. Routes that need
# the user object still ask for CurrentUser; FastAPI resolves it only once.
api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(current_user)])
api_router.include_router(health.router)
api_router.include_router(items.router)
api_router.include_router(me.router)

# Meetings are public for now (lab 2 scope: no sign-in), so they live outside
# /api/v1 and its auth dependency, at the path the spec names: /api/meetings.
public_router = APIRouter(prefix="/api")
public_router.include_router(meetings.router)
