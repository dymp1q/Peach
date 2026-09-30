"""Cognito sign-in for the API.

Every route under /api/v1 depends on ``current_user``. It accepts only a
Cognito *ID* token, minted by this project's user pool for this project's web
client, and checks it in this order: signature against the pool's public keys,
then issuer, audience, expiry and ``token_use``. Anything else is a 401. With no
pool configured at all the answer is 503 - a missing setting must never turn
into an open API.

The first request from a person creates their ``users`` row, keyed by the
token's ``sub``; later requests refresh their email and name from the token.
"""

import asyncio
import json
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert

from app.config import Settings, get_settings
from app.db import SessionDep
from app.models import User

_bearer = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


@lru_cache
def _static_keys(jwks: str) -> dict[str, jwt.PyJWK]:
    """Keys handed over as JSON (on Lambda, which cannot fetch them)."""
    return {key.key_id: key for key in jwt.PyJWKSet.from_dict(json.loads(jwks)).keys}


@lru_cache
def _jwk_client(issuer: str) -> jwt.PyJWKClient:
    """Downloads and caches the pool's keys from its well-known URL."""
    return jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json", cache_keys=True)


async def _signing_key(token: str, settings: Settings) -> Any:
    try:
        if settings.cognito_jwks:
            kid = jwt.get_unverified_header(token).get("kid")
            key = _static_keys(settings.cognito_jwks).get(kid)
            if key is None:
                raise _unauthorized("Unknown signing key")
            return key.key
        # PyJWKClient does blocking HTTP; keep it off the event loop.
        client = _jwk_client(settings.cognito_issuer)
        return (await asyncio.to_thread(client.get_signing_key_from_jwt, token)).key
    except jwt.PyJWKClientError as exc:
        raise _unauthorized("Unknown signing key") from exc
    except jwt.PyJWTError as exc:
        raise _unauthorized("Malformed token") from exc


async def verify_id_token(token: str, settings: Settings) -> dict[str, Any]:
    key = await _signing_key(token, settings)
    try:
        claims = jwt.decode(
            token,
            key=key,
            algorithms=["RS256"],
            audience=settings.cognito_client_id,
            issuer=settings.cognito_issuer,
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise _unauthorized("Token expired") from exc
    except jwt.PyJWTError as exc:
        raise _unauthorized("Invalid token") from exc
    if claims.get("token_use") != "id":
        raise _unauthorized("An ID token is required")
    return claims


async def current_user(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    settings = get_settings()
    if not settings.auth_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sign-in is not configured",
        )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("Not signed in")

    claims = await verify_id_token(credentials.credentials, settings)
    email = claims.get("email")
    name = claims.get("name") or (email.split("@")[0] if email else None)

    # One statement, so two first requests racing each other cannot both insert.
    statement = (
        insert(User)
        .values(cognito_sub=claims["sub"], email=email, name=name)
        .on_conflict_do_update(
            index_elements=[User.cognito_sub],
            set_={"email": email, "name": name, "updated_at": func.now()},
        )
        .returning(User)
        .execution_options(populate_existing=True)
    )
    return (await session.scalars(statement)).one()


CurrentUser = Annotated[User, Depends(current_user)]
