# AE-FUNAI Backend — Setup Guide

## What this is
A real Node.js/Express/SQLite backend for the AE-FUNAI system, connecting your
4 existing pages (dashboard, admin login, registration, exam verification) to
an actual database instead of page-local mock arrays.

## Requirements
- Node.js installed (v18 or newer recommended) — check with `node -v`
- npm (comes with Node)

## Setup (run these in order, in a terminal, inside this folder)

```
npm install
npm start
```

That's it. On first run you'll see something like:

```
No admin account found. Created default admin account:
  username: admin
  password: changeme123
AE-FUNAI backend running at http://localhost:3000
```

Open **http://localhost:3000** in your browser — it'll take you to the admin
login page. Log in with the username/password above.

## What's real now vs. still simulated

**Fully real (backend-backed):**
- Admin login (secure password hash, sessions)
- Departments (add/edit/delete) — stored in SQLite
- Exam settings (add/restrict/delete) — stored in SQLite
- Student registration — stored in SQLite
- Dashboard stats & activity log — pulled from real data
- Exam verification — does a real 1:N lookup against all registered
  students in the database

**Still simulated (clearly marked in code):**
- The actual *fingerprint scan* step. Real hardware scanning requires the
  SecuGen WebAPI 1:N service running locally and talking to a physical
  SecuGen scanner. Until that's connected:
  - Registration's "Scan Thumbprint" button generates a placeholder string
  - Exam verification's "Simulate Scan" button sends a placeholder string
    to the backend, which runs it through a fake 80%-success matcher

**The one file to touch when your SecuGen scanner arrives:**
`fingerprint.js` — both `registerFingerprintTemplate()` and
`identifyFingerprint()` have the real SecuGen WebAPI calls written out as
comments showing exactly what to uncomment/adapt. Nothing else in the
codebase needs to change.

## Project structure

```
ae-funai-backend/
├── server.js              Main entry point
├── db.js                  SQLite schema + connection
├── fingerprint.js         <-- swap in real SecuGen calls here later
├── middleware/
│   └── auth.js            Admin session guard
├── routes/
│   ├── admin.js           Login, departments, exams, dashboard stats
│   ├── students.js        Student registration
│   └── verify.js          Exam verification (1:N match)
├── public/                 Your 4 HTML pages + shared.css + shared.js
└── data.db                 Created automatically on first run (SQLite file)
```

## Notes
- `data.db` is a single file — back it up to save all your data, or delete
  it to reset everything (a fresh default admin will be created next start).
- Change the default admin password by logging in and asking me to add a
  "change password" endpoint, or manually via the SQLite file.
- This runs on `localhost` only for now — deploying it publicly later
  requires additional security steps (HTTPS, environment secrets, etc.) that
  we should handle separately when you're ready.
