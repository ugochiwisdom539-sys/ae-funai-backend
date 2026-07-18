// server.js
// AE-FUNAI Exam & Student Verification System — main backend entry point.

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const adminRoutes = require('./routes/admin');
const studentRoutes = require('./routes/students');
const verifyRoutes = require('./routes/verify');

// Ensure the database is initialized (creates data.db + tables + default admin
// on first run) simply by requiring it here.
require('./db');

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

app.listen(PORT, () => {
    console.log(`AE-FUNAI backend running at http://localhost:${PORT}`);
    if (!process.env.RP_ID || !process.env.ORIGIN) {
        console.log('---------------------------------------------------------');
        console.log('NOTE: RP_ID and ORIGIN environment variables are not set.');
        console.log('WebAuthn (fingerprint) registration/login will NOT work');
        console.log('correctly on a live deployment without these set to your');
        console.log('real domain, e.g.:');
        console.log('  RP_ID=ae-funai-backend.onrender.com');
        console.log('  ORIGIN=https://ae-funai-backend.onrender.com');
        console.log('Set these in your Render dashboard under Environment.');
        console.log('---------------------------------------------------------');
    }
});
