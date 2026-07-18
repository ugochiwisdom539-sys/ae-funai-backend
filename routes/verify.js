// routes/verify.js
const express = require('express');
const { db, logActivity } = require('../db');
const { getAuthenticationOptions, verifyAuthentication } = require('../webauthn');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/verify/options
// Step 1: student enters their matric number, we look them up and issue a
// WebAuthn challenge for their own registered device to sign.
// ---------------------------------------------------------------------------
router.post('/options', async (req, res) => {
    const { matricNo } = req.body;
    if (!matricNo) {
        return res.status(400).json({ success: false, message: 'Matric number is required.' });
    }

    const student = db.prepare('SELECT * FROM students WHERE matric_no = ?').get(matricNo);
    if (!student) {
        return res.status(404).json({ success: false, message: 'No student found with that matric number.' });
    }
    if (!student.fingerprint_registered) {
        return res.status(400).json({ success: false, message: 'This student has not registered a fingerprint yet.' });
    }

    try {
        const result = await getAuthenticationOptions(student);
        if (result.error) {
            return res.status(400).json({ success: false, message: result.error });
        }
        res.json({ success: true, studentId: student.id, options: result.options });
    } catch (err) {
        console.error('Verify options error:', err);
        res.status(500).json({ success: false, message: 'Could not start verification.' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/verify/confirm
// Step 2: verify the signed challenge really matches the student's own
// registered fingerprint, then check exam eligibility.
// ---------------------------------------------------------------------------
router.post('/confirm', async (req, res) => {
    const { studentId, response, examSettingId } = req.body;

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    if (!student) {
        return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    try {
        const result = await verifyAuthentication(student, response);

        if (!result.verified) {
            db.prepare(`
                INSERT INTO verification_log (student_id, exam_setting_id, result, reason)
                VALUES (?, ?, 'denied', ?)
            `).run(student.id, examSettingId || null, result.message);
            return res.json({ success: true, granted: false, message: `Access Denied: ${result.message}` });
        }

        // If an exam is specified, check department match + restriction.
        if (examSettingId) {
            const exam = db.prepare('SELECT * FROM exam_settings WHERE id = ?').get(examSettingId);
            if (exam) {
                if (exam.restricted) {
                    db.prepare(`
                        INSERT INTO verification_log (student_id, exam_setting_id, result, reason)
                        VALUES (?, ?, 'denied', 'Exam is restricted')
                    `).run(student.id, examSettingId);
                    logActivity(`Access denied for ${student.full_name} — exam restricted`);
                    return res.json({ success: true, granted: false, message: 'Access Denied: this exam is currently restricted.' });
                }
                if (exam.department_code !== student.department_code) {
                    db.prepare(`
                        INSERT INTO verification_log (student_id, exam_setting_id, result, reason)
                        VALUES (?, ?, 'denied', 'Wrong department for this exam')
                    `).run(student.id, examSettingId);
                    logActivity(`Access denied for ${student.full_name} — wrong department for exam`);
                    return res.json({ success: true, granted: false, message: `Access Denied: ${student.full_name} is not registered for this exam.` });
                }
            }
        }

        db.prepare(`
            INSERT INTO verification_log (student_id, exam_setting_id, result, reason)
            VALUES (?, ?, 'granted', 'WebAuthn fingerprint match')
        `).run(student.id, examSettingId || null);

        logActivity(`Access granted: ${student.full_name} (${student.matric_no})`);
        res.json({
            success: true,
            granted: true,
            message: `Access Granted: ${student.full_name}`,
            student: {
                id: student.id,
                matricNo: student.matric_no,
                fullName: student.full_name,
                departmentCode: student.department_code
            }
        });
    } catch (err) {
        console.error('Verify confirm error:', err);
        res.status(500).json({ success: false, message: 'Server error during verification.' });
    }
});

module.exports = router;
