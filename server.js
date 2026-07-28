// server.js
// AE-FUNAI Exam & Student Verification System — main backend entry point.

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const adminRoutes = require('./routes/admin');
const studentRoutes = require('./routes/students');
const verifyRoutes = require('./routes/verify');

// Wait for the database schema to finish initializing before accepting
// requests — important since Postgres setup is asynchronous (unlike the
// old synchronous SQLite version).
const { ready: dbReady } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'ae-funai-dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 4 // 4 hours
    }
}));

// --- API routes ---
app.use('/api/admin', adminRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/verify', verifyRoutes);

// --- Serve the frontend (dashboard.html, admin-login.html, etc.) ---
app.use(express.static(path.join(__dirname, 'public')));

// Friendly root redirect
app.get('/', (req, res) => {
    res.redirect('/admin-login.html');
});

dbReady.then(() => {
    app.listen(PORT, () => {
        console.log(`AE-FUNAI backend running at http://localhost:${PORT}`);
        if (!process.env.RP_ID || !process.env.ORIGIN) {
            console.log('---------------------------------------------------------');
            console.log('NOTE: RP_ID and ORIGIN environment variables are not set.');
            console.log('WebAuthn (fingerprint) registration/login will NOT work');
            console.log('correctly on a live deployment without these set to your');
            console.log('real domain, e.g.:');
            console.log('  RP_ID=ae-funai-exam-verification.onrender.com');
            console.log('  ORIGIN=https://ae-funai-exam-verification.onrender.com');
            console.log('Set these in your Render dashboard under Environment.');
            console.log('---------------------------------------------------------');
        }
        if (!process.env.DATABASE_URL) {
            console.log('---------------------------------------------------------');
            console.log('NOTE: DATABASE_URL environment variable is not set.');
            console.log('Add your Render Postgres "Internal Database URL" in the');
            console.log('Environment tab, or the app cannot store any data.');
            console.log('---------------------------------------------------------');
        }
    });
});
