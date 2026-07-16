// routes/verify.js
const express = require('express');
const { db, logActivity } = require('../db');
const { identifyFingerprint } = require('../fingerprint');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/verify
// Public route — used by exam-verification.html's "Simulate Scan" button
// (and later, the real SecuGen scanner) to verify a student's identity
// against ALL enrolled students (1:N matching) before letting them into
// an exam. Optionally pass examSettingId to check exam restriction too.
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
    const { fingerprint_data, examSettingId } = req.body;

    if (!fingerprint_data) {
        return res.status(400).json({ success: false, message: 'No fingerprint data received.' });
    }

    const enrolledStudents = db.prepare(`
        SELECT id, matric_no, full_name, department_code, fingerprint_template
        FROM students
        WHERE fingerprint_registered = 1
    `).all();

    try {
        const result = await identifyFingerprint(fingerprint_data, enrolledStudents);

        if (!result.matched) {
            db.prepare(`
                INSERT INTO verification_log (student_id, exam_setting_id, result, reason)
                VALUES (NULL, ?, 'denied', ?)
            `).run(examSettingId || null, result.reason);

            return res.json({
                success: true,
                granted: false,
                message: `Access Denied: ${result.reason}`
            });
        }

        const student = db.prepare('SELECT * FROM students WHERE id = ?').get(result.studentId);
        if (!student) {
            return res.json({ success: true, granted: false, message: 'Access Denied: matched record not found.' });
        }

        // If an exam is specified, check the student's department is allowed
        // and the exam isn't restricted.
        if (examSettingId) {
            const exam = db.prepare('SELECT * FROM exam_settings WHERE id = ?').get(examSettingId);
            if (exam) {
                if (exam.restricted) {
                    db.prepare(`
                        INSERT INTO verification_log (student_id, exam_setting_id, result, reason)
                        VALUES (?, ?, 'denied', 'Exam is restricted')
                    `).run(student.id, examSettingId);
                    logActivity(`Access denied for ${student.full_name} — exam restricted`);
                    return res.json({ success: true, granted: false, message: `Access Denied: this exam is currently restricted.` });
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
            VALUES (?, ?, 'granted', ?)
        `).run(student.id, examSettingId || null, result.reason);

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
        console.error('Verification error:', err);
        res.status(500).json({ success: false, message: 'Server error during verification.' });
    }
});

module.exports = router;
