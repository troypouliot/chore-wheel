-- Chore Wheel database schema

CREATE TABLE IF NOT EXISTS kids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    spins_per_day INTEGER NOT NULL DEFAULT 2,
    color TEXT NOT NULL DEFAULT '#4f8ef7',
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wheel_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kid_id INTEGER REFERENCES kids(id) ON DELETE CASCADE, -- Legacy single-kid column
    label TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('chore', 'prize')),
    weight INTEGER NOT NULL DEFAULT 1,      -- relative odds
    color TEXT NOT NULL DEFAULT '#8e8e93',
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wheel_item_kids (
    wheel_item_id INTEGER NOT NULL REFERENCES wheel_items(id) ON DELETE CASCADE,
    kid_id INTEGER NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
    PRIMARY KEY (wheel_item_id, kid_id)
);

CREATE TABLE IF NOT EXISTS spins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kid_id INTEGER NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES wheel_items(id) ON DELETE SET NULL,
    label TEXT NOT NULL,          -- snapshot of label at spin time
    kind TEXT NOT NULL,           -- snapshot of kind at spin time
    spin_date TEXT NOT NULL,      -- YYYY-MM-DD, local kiosk date
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spins_kid_date ON spins(kid_id, spin_date);
