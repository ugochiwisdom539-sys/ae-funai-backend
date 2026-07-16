// routes/admin.js
const express = require('express');
const bcrypt = require('bcrypt');
const { db, logActivity } = require('../db');
const { requireAdminAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/admin/login
// Username/password login. (Thumbprint-based admin login can be added later
// the same way verification is wired in fingerprint.js, if you want that too —
// for now this uses a normal secure password login since admin access is
// usually one or two people, not a crowd needing a shared scanner.)
// ---------------------------------------------------------------------------
router.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
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
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true, message: 'Logged out.' });
    });
});

// GET /api/admin/session — check if currently logged in (for page load checks)
router.get('/session', (req, res) => {
    if (req.session && req.session.adminId) {
        return res.json({ loggedIn: true, username: req.session.username });
    }
    res.json({ loggedIn: false });
});

// ---------------------------------------------------------------------------
// DEPARTMENTS
// ---------------------------------------------------------------------------
router.get('/departments', requireAdminAuth, (req, res) => {
    const departments = db.prepare('SELECT * FROM departments ORDER BY name').all();
    res.json({ success: true, departments });
});

router.post('/departments', requireAdminAuth, (req, res) => {
    const { name, code } = req.body;
    if (!name || !code) {
        return res.status(400).json({ success: false, message: 'Department name and code are required.' });
    }

    const existing = db.prepare('SELECT id FROM departments WHERE code = ?').get(code);
    if (existing) {
        return res.status(409).json({ success: false, message: 'Department code already exists.' });
    }

    db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run(name, code);
    logActivity(`Added department: ${name} (${code})`);
    res.json({ success: true, message: 'Department added.' });
});

router.put('/departments/:id', requireAdminAuth, (req, res) => {
    const { id } = req.params;
    const { name, code } = req.body;
    if (!name || !code) {
        return res.status(400).json({ success: false, message: 'Department name and code are required.' });
    }

    const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
    if (!dept) {
        return res.status(404).json({ success: false, message: 'Department not found.' });
    }

    db.prepare('UPDATE departments SET name = ?, code = ? WHERE id = ?').run(name, code, id);
    logActivity(`Edited department: ${name} (${code})`);
    res.json({ success: true, message: 'Department updated.' });
});

router.delete('/departments/:id', requireAdminAuth, (req, res) => {
    const { id } = req.params;
    const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
    if (!dept) {
        return res.status(404).json({ success: false, message: 'Department not found.' });
    }

    db.prepare('DELETE FROM departments WHERE id = ?').run(id);
    logActivity(`Deleted department: ${dept.name}`);
    res.json({ success: true, message: 'Department deleted.' });
});

// ---------------------------------------------------------------------------
// EXAM SETTINGS
// ---------------------------------------------------------------------------
router.get('/exams', requireAdminAuth, (req, res) => {
    const exams = db.prepare(`
        SELECT exam_settings.*, departments.name AS department_name
        FROM exam_settings
        JOIN departments ON departments.code = exam_settings.department_code
        ORDER BY exam_date DESC
    `).all();
    res.json({ success: true, exams });
});

router.post('/exams', requireAdminAuth, (req, res) => {
    const { departmentCodes, examName, examDate } = req.body;
    if (!Array.isArray(departmentCodes) || departmentCodes.length === 0 || !examName || !examDate) {
        return res.status(400).json({ success: false, message: 'Department(s), exam name, and date are required.' });
    }

    const insert = db.prepare('INSERT INTO exam_settings (department_code, exam_name, exam_date) VALUES (?, ?, ?)');
    const checkExists = db.prepare('SELECT id FROM exam_settings WHERE department_code = ? AND exam_name = ?');

    let addedCount = 0;
    for (const code of departmentCodes) {
        const exists = checkExists.get(code, examName);
        if (!exists) {
            insert.run(code, examName, examDate);
            const dept = db.prepare('SELECT name FROM departments WHERE code = ?').get(code);
            logActivity(`Added exam '${examName}' for ${dept ? dept.name : code}`);
            addedCount++;
        }
    }

    res.json({ success: true, message: `${addedCount} exam setting(s) added.` });
});

router.patch('/exams/:id/restriction', requireAdminAuth, (req, res) => {
    const { id } = req.params;
    const { restricted } = req.body;

    const exam = db.prepare('SELECT * FROM exam_settings WHERE id = ?').get(id);
    if (!exam) {
        return res.status(404).json({ success: false, message: 'Exam setting not found.' });
    }

    db.prepare('UPDATE exam_settings SET restricted = ? WHERE id = ?').run(restricted ? 1 : 0, id);
    const dept = db.prepare('SELECT name FROM departments WHERE code = ?').get(exam.department_code);
    logActivity(`${restricted ? 'Restricted' : 'Unrestricted'} exam '${exam.exam_name}' for ${dept ? dept.name : exam.department_code}`);
    res.json({ success: true, message: 'Exam restriction updated.' });
});

router.delete('/exams/:id', requireAdminAuth, (req, res) => {
    const { id } = req.params;
    const exam = db.prepare('SELECT * FROM exam_settings WHERE id = ?').get(id);
    if (!exam) {
        return res.status(404).json({ success: false, message: 'Exam setting not found.' });
    }

    db.prepare('DELETE FROM exam_settings WHERE id = ?').run(id);
    const dept = db.prepare('SELECT name FROM departments WHERE code = ?').get(exam.department_code);
    logActivity(`Deleted exam '${exam.exam_name}' for ${dept ? dept.name : exam.department_code}`);
    res.json({ success: true, message: 'Exam setting deleted.' });
});

// ---------------------------------------------------------------------------
// DASHBOARD OVERVIEW
// ---------------------------------------------------------------------------
router.get('/dashboard', requireAdminAuth, (req, res) => {
    const totalDepartments = db.prepare('SELECT COUNT(*) AS count FROM departments').get().count;
    const totalStudents = db.prepare('SELECT COUNT(*) AS count FROM students WHERE fingerprint_registered = 1').get().count;
    const pendingRegistrations = db.prepare('SELECT COUNT(*) AS count FROM students WHERE fingerprint_registered = 0').get().count;
    const recentActivities = db.prepare('SELECT description, created_at FROM activities ORDER BY id DESC LIMIT 20').all();

    res.json({
        success: true,
        totalDepartments,
        totalStudents,
        pendingRegistrations,
        recentActivities
    });
});

// ---------------------------------------------------------------------------
// STUDENT LIST (for the dashboard's Student Management tab)
// ---------------------------------------------------------------------------
router.get('/students', requireAdminAuth, (req, res) => {
    const students = db.prepare(`
        SELECT students.id, students.matric_no, students.full_name, students.email,
               students.department_code, departments.name AS department_name,
               students.fingerprint_registered, students.created_at
        FROM students
        LEFT JOIN departments ON departments.code = students.department_code
        ORDER BY students.created_at DESC
    `).all();
    res.json({ success: true, students });
});

module.exports = router;
