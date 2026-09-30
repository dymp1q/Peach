from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import AsyncClient

from app.config import get_settings
from tests.tokens import make_token


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_me_creates_the_user_on_first_request(client: AsyncClient) -> None:
    response = await client.get("/api/v1/me")
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "alice@example.com"
    assert body["name"] == "alice"
    # The same person again is the same row.
    assert (await client.get("/api/v1/me")).json()["id"] == body["id"]


async def test_missing_token_is_401(anon_client: AsyncClient) -> None:
    response = await anon_client.get("/api/v1/items")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


async def test_liveness_needs_no_token(anon_client: AsyncClient) -> None:
    assert (await anon_client.get("/health")).status_code == 200


async def test_expired_token_is_401(anon_client: AsyncClient) -> None:
    token = make_token(expires_in=-60)
    response = await anon_client.get("/api/v1/me", headers=bearer(token))
    assert response.status_code == 401
    assert response.json()["detail"] == "Token expired"


async def test_access_token_is_refused(anon_client: AsyncClient) -> None:
    token = make_token(token_use="access")
    assert (await anon_client.get("/api/v1/me", headers=bearer(token))).status_code == 401


async def test_other_client_is_refused(anon_client: AsyncClient) -> None:
    token = make_token(audience="someone-elses-client")
    assert (await anon_client.get("/api/v1/me", headers=bearer(token))).status_code == 401


async def test_other_issuer_is_refused(anon_client: AsyncClient) -> None:
    token = make_token(issuer="https://evil.example.com")
    assert (await anon_client.get("/api/v1/me", headers=bearer(token))).status_code == 401


async def test_forged_signature_is_refused(anon_client: AsyncClient) -> None:
    forger = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = make_token(key=forger)
    assert (await anon_client.get("/api/v1/me", headers=bearer(token))).status_code == 401


async def test_no_pool_configured_is_503(anon_client: AsyncClient, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "cognito_user_pool_id", "")
    response = await anon_client.get("/api/v1/me", headers=bearer(make_token()))
    assert response.status_code == 503
