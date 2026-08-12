import sqlite3
import os
import secrets
from datetime import date
from passlib.hash import pbkdf2_sha256

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "chorewheel.db")
SCHEMA_PATH = os.path.join(BASE_DIR, "schema.sql")

DEFAULT_ADMIN_PASSWORD = "chorewheel"  # change on first login via /admin


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_conn()
    with open(SCHEMA_PATH) as f:
        conn.executescript(f.read())
    conn.commit()

    # Migration: add kid_id column to wheel_items if upgrading existing db
    columns = [row[1] for row in conn.execute("PRAGMA table_info(wheel_items)").fetchall()]
    if "kid_id" not in columns:
        conn.execute("ALTER TABLE wheel_items ADD COLUMN kid_id INTEGER REFERENCES kids(id) ON DELETE CASCADE")
        conn.commit()

    # Seed default settings (session secret + admin password) if missing
    cur = conn.execute("SELECT value FROM settings WHERE key = 'admin_password_hash'")
    if cur.fetchone() is None:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('admin_password_hash', ?)",
            (pbkdf2_sha256.hash(DEFAULT_ADMIN_PASSWORD),),
        )
    cur = conn.execute("SELECT value FROM settings WHERE key = 'session_secret'")
    if cur.fetchone() is None:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('session_secret', ?)",
            (secrets.token_hex(32),),
        )
    cur = conn.execute("SELECT value FROM settings WHERE key = 'prevent_repeat_chores'")
    if cur.fetchone() is None:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('prevent_repeat_chores', '1')",
        )
    cur = conn.execute("SELECT value FROM settings WHERE key = 'guarantee_prize_per_week'")
    if cur.fetchone() is None:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('guarantee_prize_per_week', '1')",
        )
    conn.commit()

    # Seed example data only if tables are empty
    kid_count = conn.execute("SELECT COUNT(*) c FROM kids").fetchone()["c"]
    if kid_count == 0:
        conn.executemany(
            "INSERT INTO kids (name, spins_per_day, color, sort_order) VALUES (?, ?, ?, ?)",
            [("Kid 1", 2, "#4f8ef7", 0), ("Kid 2", 2, "#f76b6b", 1)],
        )
    item_count = conn.execute("SELECT COUNT(*) c FROM wheel_items").fetchone()["c"]
    if item_count == 0:
        conn.executemany(
            "INSERT INTO wheel_items (label, kind, weight, color, sort_order) VALUES (?, ?, ?, ?, ?)",
            [
                ("Make your bed", "chore", 3, "#8e8e93", 0),
                ("Feed the pets", "chore", 3, "#8e8e93", 1),
                ("Clear the table", "chore", 3, "#8e8e93", 2),
                ("Tidy your room", "chore", 3, "#8e8e93", 3),
                ("Take out trash", "chore", 2, "#8e8e93", 4),
                ("Extra screen time", "prize", 1, "#f7c948", 5),
                ("Pick tonight's movie", "prize", 1, "#f7c948", 6),
            ],
        )
    conn.commit()
    conn.close()


def get_setting(key: str, default=None):
    conn = get_conn()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    conn = get_conn()
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()
    conn.close()


def today_str() -> str:
    return date.today().isoformat()
