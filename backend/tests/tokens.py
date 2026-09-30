"""A pretend Cognito user pool for the tests.

Importing this module generates an RSA key and points the app's settings at
it - pool id, client id and the public key as JWKS - so it must be imported
before the app is. ``make_token`` then mints ID tokens the app accepts.
"""

import json
import os
import time
import uuid

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

REGION = "us-east-1"
USER_POOL_ID = "us-east-1_TestPool"
CLIENT_ID = "test-client"
ISSUER = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}"
KEY_ID = "test-key"

_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_public_jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(_private_key.public_key()))
_public_jwk.update({"kid": KEY_ID, "alg": "RS256", "use": "sig"})

os.environ["COGNITO_REGION"] = REGION
os.environ["COGNITO_USER_POOL_ID"] = USER_POOL_ID
os.environ["COGNITO_CLIENT_ID"] = CLIENT_ID
os.environ["COGNITO_JWKS"] = json.dumps({"keys": [_public_jwk]})


def make_token(
    sub: str = "alice-sub",
    email: str = "alice@example.com",
    *,
    name: str | None = None,
    token_use: str = "id",
    audience: str = CLIENT_ID,
    issuer: str = ISSUER,
    expires_in: int = 3600,
    key: rsa.RSAPrivateKey | None = None,
) -> str:
    now = int(time.time())
    claims = {
        "sub": sub,
        "email": email,
        "token_use": token_use,
        "aud": audience,
        "iss": issuer,
        "iat": now,
        "exp": now + expires_in,
        "jti": str(uuid.uuid4()),
    }
    if name is not None:
        claims["name"] = name
    return jwt.encode(claims, key or _private_key, algorithm="RS256", headers={"kid": KEY_ID})


def auth(sub: str = "alice-sub", email: str = "alice@example.com") -> dict[str, str]:
    """Headers that sign a request in as the given person."""
    return {"Authorization": f"Bearer {make_token(sub, email)}"}
