// routes/admin.js
const express = require('express');
const bcrypt = require('bcrypt');
const { db, logActivity } = require('../db');
const { requireAdminAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/admin/login
// ---------------------------------------------------------------------------
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    try {
        const admin = await db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
        if (!admin) {
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }

        const passwordMatches = bcrypt.compareSync(password, admin.password_hash);
        if (!passwordMatches) {
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }

        req.session.adminId = admin.id;
        req.session.username = admin.username;
        res.json({ success: true, message: 'Login successful.' });
    } catch (err) {
        console.error('Admin login error:', err);
        res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true, message: 'Logged out.' });
    });
});

// GET /api/admin/session
router.get('/session', (req, res) => {
    if (req.session && req.session.adminId) {
        return res.json({ loggedIn: true, username: req.session.username });
    }
    res.json({ loggedIn: false });
});

// ---------------------------------------------------------------------------
// DEPARTMENTS
// ---------------------------------------------------------------------------
router.get('/departments', requireAdminAuth, async (req, res) => {
    try {
        const departments = await db.prepare('SELECT * FROM departments ORDER BY name').all();
        res.json({ success: true, departments });
    } catch (err) {
        console.error('Get departments error:', err);
        res.status(500).json({ success: false, message: 'Server error loading departments.' });
    }
});

router.post('/departments', requireAdminAuth, async (req, res) => {
    const { name, code } = req.body;
    if (!name || !code) {
        return res.status(400).json({ success: false, message: 'Department name and code are required.' });
    }

    try {
        const existing = await db.prepare('SELECT id FROM departments WHERE code = ?').get(code);
        if (existing) {
            return res.status(409).json({ success: false, message: 'Department code already exists.' });
        }

        await db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run(name, code);
        await logActivity(`Added department: ${name} (${code})`);
        res.json({ success: true, message: 'Department added.' });
    } catch (err) {
        console.error('Add department error:', err);
        res.status(500).json({ success: false, message: 'Server error adding department.' });
    }
});

router.put('/departments/:id', requireAdminAuth, async (req, res) => {
    const { id } = req.params;
    const { name, code } = req.body;
    if (!name || !code) {
        return res.status(400).json({ success: false, message: 'Department name and code are required.' });
    }

    try {
        const dept = await db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
        if (!dept) {
            return res.status(404).json({ success: false, message: 'Department not found.' });
        }

        await db.prepare('UPDATE departments SET name = ?, code = ? WHERE id = ?').run(name, code, id);
        await logActivity(`Edited department: ${name} (${code})`);
        res.json({ success: true, message: 'Department updated.' });
    } catch (err) {
        console.error('Edit department error:', err);
        res.status(500).json({ success: false, message: 'Server error editing department.' });
    }
});

router.delete('/departments/:id', requireAdminAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const dept = await db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
        if (!dept) {
            return res.status(404).json({ success: false, message: 'Department not found.' });
        }

        await db.prepare('DELETE FROM departments WHERE id = ?').run(id);
        await logActivity(`Deleted department: ${dept.name}`);
        res.json({ success: true, message: 'Department deleted.' });
    } catch (err) {
        console.error('Delete department error:', err);
        res.status(500).json({ success: false, message: 'Server error deleting department.' });
    }
});

// ---------------------------------------------------------------------------
// EXAM SETTINGS
// ---------------------------------------------------------------------------
router.get('/exams', requireAdminAuth, async (req, res) => {
    try {
        const exams = await db.prepare(`
            SELECT exam_settings.*, departments.name AS department_name
            FROM exam_settings
            JOIN departments ON departments.code = exam_settings.department_code
            ORDER BY exam_date DESC
        `).all();
        res.json({ success: true, exams });
    } catch (err) {
        console.error('Get exams error:', err);
        res.status(500).json({ success: false, message: 'Server error loading exams.' });
    }
});

router.post('/exams', requireAdminAuth, async (req, res) => {
    const { departmentCodes, examName, examDate } = req.body;
    if (!Array.isArray(departmentCodes) || departmentCodes.length === 0 || !examName || !examDate) {
        return res.status(400).json({ success: false, message: 'Department(s), exam name, and date are required.' });
    }

    try {
        let addedCount = 0;
        for (const code of departmentCodes) {
            const exists = await db.prepare('SELECT id FROM exam_settings WHERE department_code = ? AND exam_name = ?').get(code, examName);
            if (!exists) {
                await db.prepare('INSERT INTO exam_settings (department_code, exam_name, exam_date) VALUES (?, ?, ?)').run(code, examName, examDate);
                const dept = await db.prepare('SELECT name FROM departments WHERE code = ?').get(code);
                await logActivity(`Added exam '${examName}' for ${dept ? dept.name : code}`);
                addedCount++;
            }
        }

        res.json({ success: true, message: `${addedCount} exam setting(s) added.` });
    } catch (err) {
        console.error('Add exam error:', err);
        res.status(500).json({ success: false, message: 'Server error adding exam.' });
    }
});

router.patch('/exams/:id/restriction', requireAdminAuth, async (req, res) => {
    const { id } = req.params;
    const { restricted } = req.body;

    try {
        const exam = await db.prepare('SELECT * FROM exam_settings WHERE id = ?').get(id);
        if (!exam) {
            return res.status(404).json({ success: false, message: 'Exam setting not found.' });
        }

        await db.prepare('UPDATE exam_settings SET restricted = ? WHERE id = ?').run(restricted ? 1 : 0, id);
        const dept = await db.prepare('SELECT name FROM departments WHERE code = ?').get(exam.department_code);
        await logActivity(`${restricted ? 'Restricted' : 'Unrestricted'} exam '${exam.exam_name}' for ${dept ? dept.name : exam.department_code}`);
        res.json({ success: true, message: 'Exam restriction updated.' });
    } catch (err) {
        console.error('Update exam restriction error:', err);
        res.status(500).json({ success: false, message: 'Server error updating exam restriction.' });
    }
});

router.delete('/exams/:id', requireAdminAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const exam = await db.prepare('SELECT * FROM exam_settings WHERE id = ?').get(id);
        if (!exam) {
            return res.status(404).json({ success: false, message: 'Exam setting not found.' });
        }

        await db.prepare('DELETE FROM exam_settings WHERE id = ?').run(id);
        const dept = await db.prepare('SELECT name FROM departments WHERE code = ?').get(exam.department_code);
        await logActivity(`Deleted exam '${exam.exam_name}' for ${dept ? dept.name : exam.department_code}`);
        res.json({ success: true, message: 'Exam setting deleted.' });
    } catch (err) {
        console.error('Delete exam error:', err);
        res.status(500).json({ success: false, message: 'Server error deleting exam.' });
    }
});

// ---------------------------------------------------------------------------
// DASHBOARD OVERVIEW
// ---------------------------------------------------------------------------
router.get('/dashboard', requireAdminAuth, async (req, res) => {
    try {
        const totalDepartmentsRow = await db.prepare('SELECT COUNT(*) AS count FROM departments').get();
        const totalStudentsRow = await db.prepare('SELECT COUNT(*) AS count FROM students WHERE fingerprint_registered = 1').get();
        const pendingRegistrationsRow = await db.prepare('SELECT COUNT(*) AS count FROM students WHERE fingerprint_registered = 0').get();
        const recentActivities = await db.prepare('SELECT description, created_at FROM activities ORDER BY id DESC LIMIT 20').all();

        res.json({
            success: true,
            totalDepartments: parseInt(totalDepartmentsRow.count, 10),
            totalStudents: parseInt(totalStudentsRow.count, 10),
            pendingRegistrations: parseInt(pendingRegistrationsRow.count, 10),
            recentActivities
        });
    } catch (err) {
        console.error('Dashboard overview error:', err);
        res.status(500).json({ success: false, message: 'Server error loading dashboard.' });
    }
});

// ---------------------------------------------------------------------------
// STUDENT LIST
// ---------------------------------------------------------------------------
router.get('/students', requireAdminAuth, async (req, res) => {
    try {
        const students = await db.prepare(`
            SELECT students.id, students.matric_no, students.full_name, students.email,
                   students.department_code, departments.name AS department_name,
                   students.fingerprint_registered, students.created_at
            FROM students
            LEFT JOIN departments ON departments.code = students.department_code
            ORDER BY students.created_at DESC
        `).all();
        res.json({ success: true, students });
    } catch (err) {
        console.error('Get students error:', err);
        res.status(500).json({ success: false, message: 'Server error loading students.' });
    }
});

module.exports = router;
