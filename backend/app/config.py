from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration, sourced entirely from the environment."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Spry API"
    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "info"

    database_url: str = "postgresql+asyncpg://peach:peach@db:5432/peach"
    # NoDecode keeps pydantic-settings from JSON-parsing the env value, so the
    # validator below can accept the comma-separated form Compose passes.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )

    # Lab 6: the agenda parser. The model is configuration, not code:
    # anthropic.* goes through the Messages API, any other bedrock-mantle model
    # (moonshotai.kimi-k2.5, qwen.qwen3-235b-a22b-2507, ...) through chat
    # completions. Kimi K2.5 because this account's Claude quotas are 0.
    parser_model: str = "moonshotai.kimi-k2.5"
    # Bedrock serves the Claude models from us-east-1; the rest of Spry can be
    # elsewhere and still call it there.
    bedrock_region: str = "us-east-1"
    # The Cognito user pool the parser trusts (lab 4): its issuer URL and the
    # web client's id. Both empty means every request is rejected.
    cognito_issuer: str = ""
    cognito_client_id: str = ""

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept a comma-separated string, since that is how Compose passes it."""
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
