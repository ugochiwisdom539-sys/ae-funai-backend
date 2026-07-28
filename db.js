// db.js
// PostgreSQL database setup for the AE-FUNAI system (Render free Postgres).
//
// NOTE: Render's free web services have an ephemeral filesystem — any local
// SQLite file gets wiped on every restart/redeploy/sleep-wake cycle. Postgres
// runs as a separate managed service, so data survives restarts. Render's
// free Postgres plan expires 90 days after creation (not 90 days of
// inactivity — 90 days total), after which you'd need to create a fresh
// database. Back up data via a SQL export before that if this matters long-term.

const { Pool } = require('pg');
const bcrypt = require('bcrypt');

if (!process.env.DATABASE_URL) {
    console.error('---------------------------------------------------------');
    console.error('ERROR: DATABASE_URL environment variable is not set.');
    console.error('Add it in your Render service\'s Environment tab, using the');
    console.error('"Internal Database URL" from your Render Postgres instance.');
    console.error('---------------------------------------------------------');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
        ? { rejectUnauthorized: false }
        : false
});

// ---------------------------------------------------------------------------
// Compatibility wrapper
// ---------------------------------------------------------------------------
// The rest of the codebase was written against better-sqlite3's synchronous
// `db.prepare(sql).get(...)/.all(...)/.run(...)` style. Rather than rewrite
// every route file, `db.prepare(sql)` here returns an object with async
// get/all/run methods that translate '?' placeholders to Postgres's '$1,$2...'
// style and run the query against the real Postgres pool.
//
// This keeps route files almost unchanged — they just need `await` added
// in front of each db call (already done in the route files shipped here).
// ---------------------------------------------------------------------------

function toPgParams(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
}

const db = {
    prepare(sql) {
        const pgSql = toPgParams(sql);
        return {
            async get(...params) {
                const result = await pool.query(pgSql, params);
                return result.rows[0];
            },
            async all(...params) {
                const result = await pool.query(pgSql, params);
                return result.rows;
            },
            async run(...params) {
                const result = await pool.query(pgSql, params);
                return {
                    lastInsertRowid: result.rows[0] ? result.rows[0].id : undefined,
                    changes: result.rowCount
                };
            }
        };
    },
    async exec(sql) {
        await pool.query(sql);
    }
};

// ---------------------------------------------------------------------------
// Schema
// Postgres syntax differences from the original SQLite version:
// - INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
// - datetime('now') -> NOW()
// - INSERT statements that need the new row's id use "RETURNING id" so our
//   .run() wrapper above can still return lastInsertRowid the same way
//   better-sqlite3 did, keeping route files unchanged.
// ---------------------------------------------------------------------------
async function initSchema() {
    await db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        matric_no TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        department_code TEXT NOT NULL REFERENCES departments(code),
        fingerprint_registered INTEGER DEFAULT 0,
        webauthn_user_id TEXT,
        created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id),
        credential_id TEXT UNIQUE NOT NULL,
        public_key TEXT NOT NULL,
        counter INTEGER DEFAULT 0,
        device_type TEXT,
        backed_up INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS webauthn_challenges (
        id SERIAL PRIMARY KEY,
        student_id INTEGER,
        challenge TEXT NOT NULL,
        purpose TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS exam_settings (
        id SERIAL PRIMARY KEY,
        department_code TEXT NOT NULL REFERENCES departments(code),
        exam_name TEXT NOT NULL,
        exam_date TEXT NOT NULL,
        restricted INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS activities (
        id SERIAL PRIMARY KEY,
        description TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS verification_log (
        id SERIAL PRIMARY KEY,
        student_id INTEGER REFERENCES students(id),
        exam_setting_id INTEGER REFERENCES exam_settings(id),
        result TEXT NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
    );
    `);

    const adminCountResult = await pool.query('SELECT COUNT(*) AS count FROM admins');
    const adminCount = parseInt(adminCountResult.rows[0].count, 10);

    if (adminCount === 0) {
        const defaultPassword = 'changeme123';
        const hash = bcrypt.hashSync(defaultPassword, 10);
        await pool.query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', ['admin', hash]);
        console.log('---------------------------------------------------------');
        console.log('No admin account found. Created default admin account:');
        console.log('  username: admin');
        console.log('  password: changeme123');
        console.log('Please log in and change this password as soon as possible.');
        console.log('---------------------------------------------------------');
    }
}

const ready = initSchema().catch(err => {
    console.error('Database schema initialization failed:', err);
});

async function logActivity(description) {
    await pool.query('INSERT INTO activities (description) VALUES ($1)', [description]);
}

module.exports = { db, logActivity, ready, pool };
