import secrets
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from .config import BASIC_AUTH_USERNAME, BASIC_AUTH_PASSWORD

security = HTTPBasic(auto_error=False)


async def require_auth(credentials: HTTPBasicCredentials | None = Depends(security)) -> str:
    """HTTP Basic Auth - 保护管理页面和统计接口."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            headers={"WWW-Authenticate": 'Basic realm="RAgent Dashboard"'},
            detail="请登录后访问",
        )
    if credentials.username != BASIC_AUTH_USERNAME or credentials.password != BASIC_AUTH_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            headers={"WWW-Authenticate": 'Basic realm="RAgent Dashboard"'},
            detail="用户名或密码错误",
        )
    return credentials.username


async def check_login(request: Request, credentials: HTTPBasicCredentials | None = Depends(security)) -> bool:
    """检查是否登录（用于页面访问控制），不弹窗."""
    if not credentials:
        return False
    return credentials.username == BASIC_AUTH_USERNAME and credentials.password == BASIC_AUTH_PASSWORD
