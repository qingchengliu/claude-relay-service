import os

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./data/collector.db")
DEFAULT_API_KEY = os.getenv("DEFAULT_API_KEY", "risk-ai")
BASIC_AUTH_USERNAME = os.getenv("BASIC_AUTH_USERNAME", "admin")
BASIC_AUTH_PASSWORD = os.getenv("BASIC_AUTH_PASSWORD", "ragent123")
AUTH_TOKEN_EXPIRE_HOURS = int(os.getenv("AUTH_TOKEN_EXPIRE_HOURS", "720"))

# ── Install script config ──────────────────────────────────────
INSTALL_GIT_AI_VERSION = os.getenv("INSTALL_GIT_AI_VERSION", "v1.3.4")
INSTALL_GITHUB_BASE = os.getenv("INSTALL_GITHUB_BASE", "https://cdn.gh-proxy.org/https://github.com")
INSTALL_GITHUB_BASE_FALLBACK = os.getenv("INSTALL_GITHUB_BASE_FALLBACK", "https://github.com")
INSTALL_TEAM_NAME = os.getenv("INSTALL_TEAM_NAME", "风控研发中心")
INSTALL_HOOK_REPAIR_INTERVAL_MIN = int(os.getenv("INSTALL_HOOK_REPAIR_INTERVAL_MIN", "15"))
INSTALL_REPO = os.getenv("INSTALL_REPO", "git-ai-project/git-ai")

# Git 远程仓库地址包含过滤；支持逗号/分号/空白分隔，留空表示不过滤。
REPO_URL_INCLUDE_CONTAINS = os.getenv("REPO_URL_INCLUDE_CONTAINS", "")


def repo_url_include_patterns() -> list[str]:
    normalized = REPO_URL_INCLUDE_CONTAINS.replace(";", ",").replace("\n", ",")
    parts: list[str] = []
    for chunk in normalized.split(","):
        parts.extend(chunk.split())
    return [part.strip().lower() for part in parts if part.strip()]


def allowed_repo_url(repo_url: str | None) -> bool:
    patterns = repo_url_include_patterns()
    if not patterns:
        return True
    if not isinstance(repo_url, str) or not repo_url.strip():
        return False
    lowered = repo_url.lower()
    return any(pattern in lowered for pattern in patterns)
