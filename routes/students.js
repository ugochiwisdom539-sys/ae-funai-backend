// routes/students.js
const express = require('express');
const { db, logActivity } = require('../db');
const { registerFingerprintTemplate } = require('../fingerprint');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/students/register
// Public route — students register themselves (no admin login needed).
// Matches the frontend's registration.html / registration-script.js flow:
// matricNo, fullName, email, department, fingerprint_data
// ---------------------------------------------------------------------------
router.post('/register', async (req, res) => {
    const { matricNo, fullName, email, department, fingerprint_data } = req.body;

    if (!matricNo || !fullName || !email || !department) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    if (!fingerprint_data) {
        return res.status(400).json({ success: false, message: 'Please scan your thumbprint first.' });
    }

    // Look up department by code OR name, since the frontend form currently
    // free-types the department as text rather than picking from a list.
    const dept = db.prepare('SELECT * FROM departments WHERE code = ? OR name = ?').get(department, department);
    if (!dept) {
        return res.status(400).json({
            success: false,
            message: `Department "${department}" is not recognized. Please contact admin to have it added first.`
        });
    }

    const existing = db.prepare('SELECT id FROM students WHERE matric_no = ?').get(matricNo);
    if (existing) {
        return res.status(409).json({ success: false, message: 'A student with this matric number is already registered.' });
    }

    try {
        const insertResult = db.prepare(`
            INSERT INTO students (matric_no, full_name, email, department_code, fingerprint_registered)
            VALUES (?, ?, ?, ?, 0)
        `).run(matricNo, fullName, email, dept.code);

        const studentId = insertResult.lastInsertRowid;

        const fpResult = await registerFingerprintTemplate(studentId, fingerprint_data);
        if (!fpResult.success) {
            // Roll back the student record if fingerprint registration failed,
            // so we don't leave a "half-registered" student in the database.
            db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
            return res.status(400).json({ success: false, message: fpResult.message });
        }

        db.prepare(`
            UPDATE students SET fingerprint_template = ?, fingerprint_registered = 1 WHERE id = ?
        `).run(fingerprint_data, studentId);

        logActivity(`Registered student: ${fullName} (${matricNo})`);
        res.json({ success: true, message: 'Registration successful!' });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ success: false, message: 'Server error during registration.' });
    }
});

module.exports = router;
