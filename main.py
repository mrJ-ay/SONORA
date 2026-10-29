from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import psycopg
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

ROOT_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT_DIR / "frontend"

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
ONEID_JWT_SECRET = os.getenv(
    "ONEID_JWT_SECRET",
    "5K9sewleVmRejBIRGN7pHaIP1Yf63QR98_z94MOty1YSk8bv81cRwtZFvwUJkj-d",
).strip()
ONEID_ISSUER_URL = os.getenv("ONEID_ISSUER_URL", "https://oneid-icvq.onrender.com").strip()
ONEID_CLIENT_ID = os.getenv("ONEID_CLIENT_ID", "sonora").strip()

app = FastAPI(title="SONORA Web DAW", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def no_cache_static(request, call_next):
    response = await call_next(request)
    if request.url.path.endswith((".html", ".js", ".css")) or request.url.path == "/":
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


def get_connection():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured.")
    return psycopg.connect(
        DATABASE_URL,
        connect_timeout=10,
        row_factory=dict_row,
    )


def init_db() -> None:
    if not DATABASE_URL:
        return
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS sonora_projects (
                    project_id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    username TEXT NOT NULL,
                    nickname TEXT NOT NULL,
                    title TEXT NOT NULL,
                    bpm INTEGER NOT NULL DEFAULT 120,
                    is_public BOOLEAN NOT NULL DEFAULT TRUE,
                    likes INTEGER NOT NULL DEFAULT 0,
                    project_data JSONB NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_sonora_projects_user
                ON sonora_projects (user_id)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_sonora_projects_public
                ON sonora_projects (is_public, updated_at DESC)
                """
            )


@app.on_event("startup")
def on_startup() -> None:
    try:
        init_db()
    except Exception as exc:
        print("SONORA DB init warning:", exc)


def serialize_user(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["user_id"],
        "username": row["username"],
        "nickname": row["nickname"],
        "role": row["role"],
        "is_admin": row["role"] == "admin",
    }


def require_user(authorization: str | None) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="ONEID 통합 로그인이 필요합니다.")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="ONEID 통합 로그인이 필요합니다.")

    try:
        payload = jwt.decode(
            token,
            ONEID_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False, "verify_iss": False},
        )
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="ONEID 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.") from exc

    mode = payload.get("mode")
    user_id = payload.get("sub")
    if not user_id or mode not in ("sso", "oneid"):
        raise HTTPException(status_code=401, detail="유효하지 않은 ONEID 인증 토큰입니다.")

    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM oneid_users WHERE user_id = %s",
            (str(user_id),),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="ONEID 계정을 찾을 수 없습니다.")
        if row.get("global_suspended"):
            raise HTTPException(
                status_code=403,
                detail=row.get("suspension_reason") or "이용이 정지된 ONEID 계정입니다.",
            )
        site_ban = conn.execute(
            "SELECT reason FROM oneid_site_suspensions WHERE user_id = %s AND client_id = %s",
            (str(user_id), ONEID_CLIENT_ID),
        ).fetchone()
        if site_ban:
            raise HTTPException(
                status_code=403,
                detail=site_ban.get("reason") or "SONORA에서 이용이 정지된 계정입니다.",
            )

    return serialize_user(row)


def serialize_project_summary(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["project_id"],
        "project_id": row["project_id"],
        "user_id": row["user_id"],
        "username": row["username"],
        "nickname": row["nickname"],
        "title": row["title"],
        "bpm": row["bpm"],
        "is_public": row["is_public"],
        "likes": row["likes"],
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
    }


class ProjectSaveInput(BaseModel):
    project_id: int | None = None
    title: str = Field(min_length=1, max_length=80)
    bpm: int = Field(default=120, ge=40, le=240)
    is_public: bool = True
    data: dict[str, Any] | None = None
    project_data: dict[str, Any] | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "sonora-daw"}


@app.get("/api/auth/me")
def me(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    return require_user(authorization)


@app.get("/api/projects")
def list_my_projects(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT project_id, user_id, username, nickname, title, bpm, is_public, likes, created_at, updated_at
            FROM sonora_projects
            WHERE user_id = %s
            ORDER BY updated_at DESC
            """,
            (user["id"],),
        ).fetchall()
    return {"items": [serialize_project_summary(r) for r in rows]}


@app.get("/api/projects/public")
def list_public_projects() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT project_id, user_id, username, nickname, title, bpm, is_public, likes, created_at, updated_at
            FROM sonora_projects
            WHERE is_public = TRUE
            ORDER BY updated_at DESC
            LIMIT 40
            """
        ).fetchall()
    return [serialize_project_summary(r) for r in rows]


@app.get("/api/projects/{project_id}")
def get_project(project_id: int, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM sonora_projects WHERE project_id = %s",
            (project_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    if not row["is_public"]:
        user = require_user(authorization)
        if row["user_id"] != user["id"] and not user["is_admin"]:
            raise HTTPException(status_code=403, detail="비공개 프로젝트입니다.")

    out = serialize_project_summary(row)
    out["data"] = row["project_data"]
    out["project_data"] = row["project_data"]
    return out


@app.post("/api/projects")
def save_project(
    payload: ProjectSaveInput,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = require_user(authorization)
    title = payload.title.strip() or "Untitled Session"
    proj_obj = payload.data if payload.data is not None else (payload.project_data or {})
    raw_json = json.dumps(proj_obj)
    if len(raw_json) > 1_200_000:
        raise HTTPException(status_code=413, detail="프로젝트 용량이 너무 큽니다.")

    with get_connection() as conn:
        if payload.project_id:
            existing = conn.execute(
                "SELECT * FROM sonora_projects WHERE project_id = %s",
                (payload.project_id,),
            ).fetchone()
            if existing and existing["user_id"] == user["id"]:
                updated = conn.execute(
                    """
                    UPDATE sonora_projects
                    SET title = %s,
                        bpm = %s,
                        is_public = %s,
                        nickname = %s,
                        project_data = %s::jsonb,
                        updated_at = NOW()
                    WHERE project_id = %s
                    RETURNING *
                    """,
                    (title, payload.bpm, payload.is_public, user["nickname"], raw_json, payload.project_id),
                ).fetchone()
                summary = serialize_project_summary(updated)
                return {
                    "id": updated["project_id"],
                    "message": f"'{title}' 프로젝트가 덮어쓰기 저장되었습니다.",
                    "project": summary,
                }

        created = conn.execute(
            """
            INSERT INTO sonora_projects (user_id, username, nickname, title, bpm, is_public, project_data)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            RETURNING *
            """,
            (user["id"], user["username"], user["nickname"], title, payload.bpm, payload.is_public, raw_json),
        ).fetchone()

    summary = serialize_project_summary(created)
    return {
        "id": created["project_id"],
        "message": f"'{title}' 새 클라우드 프로젝트로 저장되었습니다.",
        "project": summary,
    }


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: int, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    with get_connection() as conn:
        target = conn.execute(
            "SELECT user_id FROM sonora_projects WHERE project_id = %s",
            (project_id,),
        ).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
        if target["user_id"] != user["id"] and not user["is_admin"]:
            raise HTTPException(status_code=403, detail="삭제 권한이 없습니다.")
        conn.execute("DELETE FROM sonora_projects WHERE project_id = %s", (project_id,))
    return {"deleted": True, "id": project_id, "project_id": project_id}


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
