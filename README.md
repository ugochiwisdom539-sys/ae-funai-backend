# AE-FUNAI Exam & Student Verification System

A full-stack web application for AE-FUNAI that verifies student identity
using real fingerprint/biometric authentication before allowing exam access.
Built by Wisdom Ugochi as a final-year Computer Science project.

## What this system does

- **Admins** log in with a username and password to manage departments,
  set up exams, restrict exam access, and view registered students and
  activity logs.
- **Students** register once using their own phone or laptop's fingerprint
  sensor (Touch ID, Windows Hello, Android fingerprint) — no extra hardware
  needed.
- **Exam verification**: a student enters their matric number and confirms
  their identity with the same fingerprint sensor they registered with,
  granting or denying access to a specific exam.

## Tech stack

- **Frontend**: plain HTML, CSS, and JavaScript (4 pages: admin login,
  admin dashboard, student registration, exam verification)
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (hosted on Render)
- **Biometric authentication**: WebAuthn, via the `@simplewebauthn`
  library — the same open web standard behind Face ID, Touch ID, and
  Windows Hello

## Project structure

```
├── server.js              Main backend entry point
├── db.js                  PostgreSQL connection + schema
├── webauthn.js             Fingerprint registration/verification logic
├── middleware/
│   └── auth.js             Admin session guard
├── routes/
│   ├── admin.js            Login, departments, exams, dashboard stats
│   ├── students.js         Student registration + fingerprint enrollment
│   └── verify.js           Exam verification (fingerprint match)
└── public/                 Frontend pages
    ├── admin-login.html
    ├── dashboard.html
    ├── registration.html
    ├── exam-verification.html
    ├── shared.css
    └── shared.js
```

## Live pages

Once deployed, the system is available at these URLs (replace with your
actual Render domain if different):

- Admin login: `/admin-login.html`
- Admin dashboard: `/dashboard.html` (requires login)
- Student registration: `/registration.html`
- Exam verification: `/exam-verification.html`

## Requirements for real use

- **A modern browser** — Chrome, Samsung Internet, Firefox, or Safari.
  Fingerprint registration/verification will NOT work in Opera Mini or
  other "data-saving" proxy browsers, since they don't support WebAuthn.
- **HTTPS** — WebAuthn requires a secure connection (or `localhost` for
  local development). The live Render deployment already serves over
  HTTPS by default.

## Running locally

```
npm install
npm start
```

You'll need a `DATABASE_URL` environment variable pointing to a Postgres
database, plus `RP_ID` and `ORIGIN` set to match wherever the app is
actually being served from (see below).

## Environment variables (required)

| Variable | Example | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://user:pass@host/dbname` | Connection to your Postgres database |
| `RP_ID` | `ae-funai-exam-verification.onrender.com` | Domain WebAuthn is bound to (no `https://`) |
| `ORIGIN` | `https://ae-funai-exam-verification.onrender.com` | Full origin URL, must match RP_ID exactly |
| `SESSION_SECRET` | any random string | Encrypts admin login sessions |

**Important**: `RP_ID` and `ORIGIN` must always exactly match the real
domain the site is being served from, or fingerprint registration/login
will fail with a domain-mismatch error.

## Database note

This project uses Render's **free PostgreSQL tier**, which expires 90 days
after creation. Before it expires, export your data (departments, students,
exam settings) if you want to keep it — otherwise a fresh database will be
needed and all data will be lost. For a permanent, always-on deployment,
upgrade to a paid Render Postgres instance.

## Default admin login

On first run, if no admin account exists, one is created automatically:

- Username: `admin`
- Password: `changeme123`

Change this after your first login.

## Roadmap / known limitations

- Admin login is currently username/password only.
- Registration and exam verification both use WebAuthn tied to the
  student's own device — there is no shared physical fingerprint scanner
  in this version.
- No password-reset flow yet for the admin account.
