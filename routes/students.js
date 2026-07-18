// routes/students.js
const express = require('express');
const { db, logActivity } = require('../db');
const { getRegistrationOptions, verifyRegistration } = require('../webauthn');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/students/register-info
// Step 0: create the student's basic record BEFORE fingerprint registration.
// Matches: matricNo, fullName, email, department
// ---------------------------------------------------------------------------
router.post('/register-info', async (req, res) => {
    const { matricNo, fullName, email, department } = req.body;

    if (!matricNo || !fullName || !email || !department) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

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

    const insertResult = db.prepare(`
        INSERT INTO students (matric_no, full_name, email, department_code, fingerprint_registered)
        VALUES (?, ?, ?, ?, 0)
    `).run(matricNo, fullName, email, dept.code);

    res.json({ success: true, studentId: insertResult.lastInsertRowid });
});

// ---------------------------------------------------------------------------
// POST /api/students/webauthn/register-options
// Step 1: get a WebAuthn challenge for the browser to sign with the
// device's fingerprint sensor.
// ---------------------------------------------------------------------------
router.post('/webauthn/register-options', async (req, res) => {
    const { studentId } = req.body;
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    if (!student) {
        return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    try {
        const options = await getRegistrationOptions(student);
        res.json({ success: true, options });
    } catch (err) {
        console.error('Registration options error:', err);
        res.status(500).json({ success: false, message: 'Could not start fingerprint registration.' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/students/webauthn/register-verify
// Step 2: verify the signed challenge and save the credential.
// ---------------------------------------------------------------------------
router.post('/webauthn/register-verify', async (req, res) => {
    const { studentId, response } = req.body;
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    if (!student) {
        return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    try {
        const result = await verifyRegistration(student, response);
        if (result.verified) {
            logActivity(`Registered student: ${student.full_name} (${student.matric_no})`);
        }
        res.json({ success: result.verified, message: result.message });
    } catch (err) {
        console.error('Registration verify error:', err);
        res.status(500).json({ success: false, message: 'Server error during fingerprint registration.' });
    }
});

module.exports = router;
