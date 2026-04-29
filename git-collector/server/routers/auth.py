import secrets
import time
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Team

router = APIRouter(prefix="/worker/oauth", tags=["auth"])
_pending_codes: dict[str, dict] = {}


class DeviceCodeResponse(BaseModel):
    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int = 600
    interval: int = 5


class TokenRequest(BaseModel):
    grant_type: str
    device_code: str | None = None
    client_id: str = "git-ai-cli"
    install_nonce: str | None = None
    refresh_token: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    refresh_token: str | None = None


@router.post("/device/code")
async def device_code():
    device_code = secrets.token_urlsafe(32)
    user_code = secrets.token_hex(4).upper()
    _pending_codes[device_code] = {
        "user_code": user_code,
        "expires_at": time.time() + 600,
        "used": False,
    }
    return DeviceCodeResponse(
        device_code=device_code,
        user_code=user_code,
        verification_uri="/auth/verify",
    )


@router.post("/token")
async def token_exchange(req: TokenRequest, db: AsyncSession = Depends(get_db)):
    if req.grant_type == "urn:ietf:params:oauth:grant-type:device_code":
        if not req.device_code:
            raise HTTPException(400, "device_code required")
        pending = _pending_codes.get(req.device_code)
        if not pending or pending["expires_at"] < time.time():
            raise HTTPException(400, "device_code expired or invalid")
        if pending["used"]:
            raise HTTPException(400, "device_code already used")
        pending["used"] = True
    elif req.grant_type == "install_nonce":
        if not req.install_nonce:
            raise HTTPException(400, "install_nonce required")
        result = await db.execute(select(Team).where(Team.api_key == req.install_nonce))
        if not result.scalar_one_or_none():
            raise HTTPException(401, "Invalid install_nonce")
    elif req.grant_type == "refresh_token":
        if not req.refresh_token:
            raise HTTPException(400, "refresh_token required")
    else:
        raise HTTPException(400, f"Unsupported grant_type: {req.grant_type}")

    token = secrets.token_urlsafe(48)
    return TokenResponse(
        access_token=token,
        token_type="Bearer",
        expires_in=2592000,
        refresh_token=secrets.token_urlsafe(48),
    )
