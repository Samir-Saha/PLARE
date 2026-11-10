from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./plare.db"
    # Supabase Auth. Set the JWT secret (legacy HS256 projects) or just the URL
    # (projects with asymmetric signing keys, verified through JWKS).
    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    # Demo sign-in: lets seeded demo accounts sign in with an X-Demo-User
    # header. Local development and demos only. Never enable in production.
    demo_auth: bool = False
    cors_origins: str = "http://localhost:3000"
    upload_dir: str = "./uploads"
    max_upload_bytes: int = 8 * 1024 * 1024
    # Run the reminder loop inside the API process (checks once a minute).
    run_reminders: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
