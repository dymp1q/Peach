"""Who is calling the parser: a Cognito access token from the lab 4 sign-in.

Every parse costs money, so the parser's public URL answers only signed-in
users. The function runs outside the VPC, so it can fetch the pool's public
keys (JWKS) itself; they are cached between invocations.
"""

from dataclasses import dataclass
from typing import Any

import jwt

from app.config import get_settings


class Unauthorized(Exception):
    """No token, or one this user pool did not issue: answer 401."""


@dataclass(frozen=True)
class User:
    sub: str


_jwks: dict[str, Any] = {}


def _jwks_client(issuer: str) -> jwt.PyJWKClient:
    if issuer not in _jwks:
        _jwks[issuer] = jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json", cache_keys=True)
    return _jwks[issuer]


def verify_cognito_token(authorization: str) -> User:
    settings = get_settings()
    if not settings.cognito_issuer or not settings.cognito_client_id:
        raise Unauthorized("sign-in is not configured")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise Unauthorized("missing bearer token")
    try:
        key = _jwks_client(settings.cognito_issuer).get_signing_key_from_jwt(token)
        # A Cognito access token has no aud; it names the app client in
        # client_id instead, and says what it is in token_use.
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            issuer=settings.cognito_issuer,
            options={"require": ["exp", "iss", "sub"], "verify_aud": False},
        )
    except jwt.PyJWTError as e:
        raise Unauthorized(str(e)) from e
    if claims.get("token_use") != "access" or claims.get("client_id") != settings.cognito_client_id:
        raise Unauthorized("not an access token for this app")
    return User(sub=claims["sub"])
