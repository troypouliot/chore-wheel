import os
import secrets
import random
import time
from datetime import datetime

ASSET_VERSION = str(int(time.time()))  # changes on every server restart, forces browsers to refetch static files

from fastapi import FastAPI, Request, Response, Depends, HTTPException, Cookie
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from passlib.hash import pbkdf2_sha256
from pydantic import BaseModel

import db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = FastAPI(title="Chore Wheel")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

db.init_db()

# ---- very small in-memory session store (fine for a single-household admin) ----
SESSIONS: dict[str, datetime] = {}
SESSION_COOKIE = "chorewheel_session"


def is_authed(request: Request) -> bool:
    token = request.cookies.get(SESSION_COOKIE)
    return bool(token and token in SESSIONS)


def require_admin(request: Request):
    if not is_authed(request):
        raise HTTPException(status_code=401, detail="Not authenticated")


# ---------------------------------------------------------------------------
# Kiosk-facing pages / API
# ---------------------------------------------------------------------------

@app.get("/")
def kiosk_page(request: Request):
    return templates.TemplateResponse("kiosk.html", {"request": request, "v": ASSET_VERSION})


@app.get("/api/kids")
def api_kids():
    conn = db.get_conn()
    kids = conn.execute(
        "SELECT * FROM kids WHERE active = 1 ORDER BY sort_order, id"
    ).fetchall()
    today = db.today_str()
    result = []
    for k in kids:
        used = conn.execute(
            "SELECT COUNT(*) c FROM spins WHERE kid_id = ? AND spin_date = ?",
            (k["id"], today),
        ).fetchone()["c"]
        result.append(
            {
                "id": k["id"],
                "name": k["name"],
                "color": k["color"],
                "spins_per_day": k["spins_per_day"],
                "spins_used_today": used,
                "spins_remaining": max(0, k["spins_per_day"] - used),
            }
        )
    conn.close()
    return result


@app.get("/api/wheel")
def api_wheel():
    conn = db.get_conn()
    items = conn.execute(
        "SELECT * FROM wheel_items WHERE active = 1 ORDER BY sort_order, id"
    ).fetchall()
    conn.close()
    return [
        {
            "id": i["id"],
            "label": i["label"],
            "kind": i["kind"],
            "weight": i["weight"],
            "color": i["color"],
        }
        for i in items
    ]


class SpinRequest(BaseModel):
    kid_id: int


@app.post("/api/spin")
def api_spin(payload: SpinRequest):
    conn = db.get_conn()
    kid = conn.execute("SELECT * FROM kids WHERE id = ? AND active = 1", (payload.kid_id,)).fetchone()
    if not kid:
        conn.close()
        raise HTTPException(status_code=404, detail="Kid not found")

    today = db.today_str()
    used = conn.execute(
        "SELECT COUNT(*) c FROM spins WHERE kid_id = ? AND spin_date = ?",
        (kid["id"], today),
    ).fetchone()["c"]
    if used >= kid["spins_per_day"]:
        conn.close()
        raise HTTPException(status_code=400, detail="No spins remaining today")

    items = conn.execute("SELECT * FROM wheel_items WHERE active = 1").fetchall()
    if not items:
        conn.close()
        raise HTTPException(status_code=400, detail="No wheel items configured")

    weights = [max(1, i["weight"]) for i in items]
    chosen = random.choices(items, weights=weights, k=1)[0]

    conn.execute(
        "INSERT INTO spins (kid_id, item_id, label, kind, spin_date) VALUES (?, ?, ?, ?, ?)",
        (kid["id"], chosen["id"], chosen["label"], chosen["kind"], today),
    )
    conn.commit()

    remaining = kid["spins_per_day"] - (used + 1)
    conn.close()
    return {
        "result": {"id": chosen["id"], "label": chosen["label"], "kind": chosen["kind"], "color": chosen["color"]},
        "spins_remaining": max(0, remaining),
    }


# ---------------------------------------------------------------------------
# Admin auth
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    password: str


@app.post("/api/login")
def api_login(payload: LoginRequest, response: Response):
    stored_hash = db.get_setting("admin_password_hash")
    if not stored_hash or not pbkdf2_sha256.verify(payload.password, stored_hash):
        raise HTTPException(status_code=401, detail="Incorrect password")
    token = secrets.token_hex(24)
    SESSIONS[token] = datetime.now()
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=60 * 60 * 12)
    return {"ok": True}


@app.post("/api/logout")
def api_logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    SESSIONS.pop(token, None)
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/change-password")
def api_change_password(payload: ChangePasswordRequest, _=Depends(require_admin)):
    stored_hash = db.get_setting("admin_password_hash")
    if not pbkdf2_sha256.verify(payload.current_password, stored_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(payload.new_password) < 4:
        raise HTTPException(status_code=400, detail="New password too short")
    db.set_setting("admin_password_hash", pbkdf2_sha256.hash(payload.new_password))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Admin pages
# ---------------------------------------------------------------------------

@app.get("/admin")
def admin_page(request: Request):
    return templates.TemplateResponse("admin.html", {"request": request, "authed": is_authed(request), "v": ASSET_VERSION})


# ---------------------------------------------------------------------------
# Admin API: kids
# ---------------------------------------------------------------------------

class KidIn(BaseModel):
    name: str
    spins_per_day: int = 2
    color: str = "#4f8ef7"
    active: bool = True


@app.get("/api/admin/kids")
def admin_list_kids(_=Depends(require_admin)):
    conn = db.get_conn()
    kids = conn.execute("SELECT * FROM kids ORDER BY sort_order, id").fetchall()
    conn.close()
    return [dict(k) for k in kids]


@app.post("/api/admin/kids")
def admin_create_kid(payload: KidIn, _=Depends(require_admin)):
    conn = db.get_conn()
    cur = conn.execute(
        "INSERT INTO kids (name, spins_per_day, color, active) VALUES (?, ?, ?, ?)",
        (payload.name, payload.spins_per_day, payload.color, int(payload.active)),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return {"id": new_id}


@app.put("/api/admin/kids/{kid_id}")
def admin_update_kid(kid_id: int, payload: KidIn, _=Depends(require_admin)):
    conn = db.get_conn()
    conn.execute(
        "UPDATE kids SET name = ?, spins_per_day = ?, color = ?, active = ? WHERE id = ?",
        (payload.name, payload.spins_per_day, payload.color, int(payload.active), kid_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/admin/kids/{kid_id}")
def admin_delete_kid(kid_id: int, _=Depends(require_admin)):
    conn = db.get_conn()
    conn.execute("DELETE FROM kids WHERE id = ?", (kid_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/admin/kids/{kid_id}/reset-spins")
def admin_reset_spins(kid_id: int, _=Depends(require_admin)):
    """Give a kid their spins back for today (e.g. corrected a mistake)."""
    conn = db.get_conn()
    conn.execute(
        "DELETE FROM spins WHERE kid_id = ? AND spin_date = ?",
        (kid_id, db.today_str()),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Admin API: wheel items (chores + prizes)
# ---------------------------------------------------------------------------

class WheelItemIn(BaseModel):
    label: str
    kind: str  # "chore" | "prize"
    weight: int = 1
    color: str = "#8e8e93"
    active: bool = True


@app.get("/api/admin/wheel-items")
def admin_list_items(_=Depends(require_admin)):
    conn = db.get_conn()
    items = conn.execute("SELECT * FROM wheel_items ORDER BY sort_order, id").fetchall()
    conn.close()
    return [dict(i) for i in items]


@app.post("/api/admin/wheel-items")
def admin_create_item(payload: WheelItemIn, _=Depends(require_admin)):
    if payload.kind not in ("chore", "prize"):
        raise HTTPException(status_code=400, detail="kind must be 'chore' or 'prize'")
    conn = db.get_conn()
    cur = conn.execute(
        "INSERT INTO wheel_items (label, kind, weight, color, active) VALUES (?, ?, ?, ?, ?)",
        (payload.label, payload.kind, payload.weight, payload.color, int(payload.active)),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return {"id": new_id}


@app.put("/api/admin/wheel-items/{item_id}")
def admin_update_item(item_id: int, payload: WheelItemIn, _=Depends(require_admin)):
    if payload.kind not in ("chore", "prize"):
        raise HTTPException(status_code=400, detail="kind must be 'chore' or 'prize'")
    conn = db.get_conn()
    conn.execute(
        "UPDATE wheel_items SET label = ?, kind = ?, weight = ?, color = ?, active = ? WHERE id = ?",
        (payload.label, payload.kind, payload.weight, payload.color, int(payload.active), item_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/admin/wheel-items/{item_id}")
def admin_delete_item(item_id: int, _=Depends(require_admin)):
    conn = db.get_conn()
    conn.execute("DELETE FROM wheel_items WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Admin API: history
# ---------------------------------------------------------------------------

@app.get("/api/admin/history")
def admin_history(_=Depends(require_admin), limit: int = 100):
    conn = db.get_conn()
    rows = conn.execute(
        """
        SELECT spins.*, kids.name as kid_name
        FROM spins
        JOIN kids ON kids.id = spins.kid_id
        ORDER BY spins.id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
