// db.js
// SQLite database setup for the AE-FUNAI system.
// Uses better-sqlite3 (synchronous, simple, file-based — no server needed).

const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = path.join(__dirname, 'data.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    matric_no TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    department_code TEXT NOT NULL,
    fingerprint_registered INTEGER DEFAULT 0,  -- 0 = not enrolled, 1 = enrolled
    webauthn_user_id TEXT,              -- random ID used to link this student to their WebAuthn credential
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (department_code) REFERENCES departments(code)
);

-- Each row is one registered fingerprint/device credential for a student.
-- A student could technically have more than one (e.g. registers on both
-- phone and laptop), so this is a separate table rather than a column.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    credential_id TEXT UNIQUE NOT NULL,   -- base64url credential ID from the authenticator
    public_key TEXT NOT NULL,             -- base64url public key, used to verify future logins
    counter INTEGER DEFAULT 0,            -- replay-attack protection counter
    device_type TEXT,
    backed_up INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (student_id) REFERENCES students(id)
);

-- Temporary storage for in-progress WebAuthn registration/login challenges.
-- Rows are short-lived: created when a challenge is issued, deleted once used.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,                   -- NULL during login lookup-by-matric flow
    challenge TEXT NOT NULL,
    purpose TEXT NOT NULL,                -- 'registration' | 'authentication'
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exam_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_code TEXT NOT NULL,
    exam_name TEXT NOT NULL,
    exam_date TEXT NOT NULL,
    restricted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (department_code) REFERENCES departments(code)
);

CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS verification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,           -- NULL if no match found
    exam_setting_id INTEGER,
    result TEXT NOT NULL,         -- 'granted' | 'denied'
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (exam_setting_id) REFERENCES exam_settings(id)
);
`);

// ---------------------------------------------------------------------------
// Seed a default admin account if none exists yet
// Default login: username "admin", password "changeme123"
// CHANGE THIS PASSWORD after first login in a real deployment.
// ---------------------------------------------------------------------------
const adminCount = db.prepare('SELECT COUNT(*) AS count FROM admins').get().count;
if (adminCount === 0) {
    const defaultPassword = 'changeme123';
    const hash = bcrypt.hashSync(defaultPassword, 10);
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('admin', hash);
    console.log('---------------------------------------------------------');
    console.log('No admin account found. Created default admin account:');
    console.log('  username: admin');
    console.log('  password: changeme123');
    console.log('Please log in and change this password as soon as possible.');
    console.log('---------------------------------------------------------');
}

function logActivity(description) {
    db.prepare('INSERT INTO activities (description) VALUES (?)').run(description);
}

module.exports = { db, logActivity };
