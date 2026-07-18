/* ==========================================================================
   AE-FUNAI Shared Script — now backed by the real Express/SQLite backend.
   Used by: dashboard.html, admin-login.html, registration.html,
            exam-verification.html
   Each section below only runs if that page's expected elements exist.
   ========================================================================== */

const API_BASE = '/api';

async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.message || 'Request failed');
        error.status = response.status;
        error.data = data;
        throw error;
    }
    return data;
}

/* ==========================================================================
   1. DASHBOARD LOGIC (dashboard.html)
   ========================================================================== */
if (document.getElementById('mainContent') && document.getElementById('sidebar')) {

    const navLinks = document.querySelectorAll('.sidebar nav ul li a');
    const contentWidgets = document.querySelectorAll('.content-widget');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    const toggleSidebarBtn = document.getElementById('toggleSidebar');
    const logoutBtn = document.getElementById('logoutBtn');

    // Guard: redirect to login if not authenticated
    (async () => {
        try {
            const session = await apiRequest('/admin/session');
            if (!session.loggedIn) {
                window.location.href = '/admin-login.html';
                return;
            }
            initDashboard();
        } catch (err) {
            console.error('Session check failed:', err);
            window.location.href = '/admin-login.html';
        }
    })();

    if (toggleSidebarBtn) {
        toggleSidebarBtn.onclick = () => {
            sidebar.classList.toggle('open');
            mainContent.classList.toggle('sidebar-open');
        };
    }

    if (logoutBtn) {
        logoutBtn.onclick = async () => {
            await apiRequest('/admin/logout', { method: 'POST' });
            window.location.href = '/admin-login.html';
        };
    }

    navLinks.forEach(link => {
        link.onclick = (e) => {
            e.preventDefault();
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            const target = link.getAttribute('href').substring(1);
            contentWidgets.forEach(w => w.style.display = 'none');
            document.getElementById(`${target}-content`).style.display = 'block';
            sidebar.classList.remove('open');
            mainContent.classList.remove('sidebar-open');

            if (target === 'departments') loadDepartments();
            if (target === 'students') loadStudents();
            if (target === 'exam') { loadDepartmentsDropdown(); loadExams(); }
            if (target === 'dashboard') loadDashboardOverview();
        };
    });

    function initDashboard() {
        loadDashboardOverview();
        loadDepartments();
        loadDepartmentsDropdown();

        const deptForm = document.getElementById('addDepartmentForm');
        if (deptForm) {
            deptForm.onsubmit = async (e) => {
                e.preventDefault();
                const name = document.getElementById('departmentName').value.trim();
                const code = document.getElementById('departmentCode').value.trim();
                if (!name || !code) return alert('Please fill all fields');
                try {
                    await apiRequest('/admin/departments', { method: 'POST', body: JSON.stringify({ name, code }) });
                    deptForm.reset();
                    loadDepartments();
                    loadDepartmentsDropdown();
                    loadDashboardOverview();
                } catch (err) {
                    alert(err.message);
                }
            };
        }

        const examForm = document.getElementById('examSettingForm');
        if (examForm) {
            examForm.onsubmit = async (e) => {
                e.preventDefault();
                const examDeptSelect = document.getElementById('examDepartments');
                const departmentCodes = Array.from(examDeptSelect.selectedOptions).map(opt => opt.value);
                const examName = document.getElementById('examCourse').value.trim();
                const examDate = document.getElementById('examDateTime').value;
                if (!examName || departmentCodes.length === 0 || !examDate) return alert('Please fill all fields');
                try {
                    await apiRequest('/admin/exams', { method: 'POST', body: JSON.stringify({ departmentCodes, examName, examDate }) });
                    examForm.reset();
                    loadExams();
                } catch (err) {
                    alert(err.message);
                }
            };
        }
    }

    async function loadDashboardOverview() {
        try {
            const data = await apiRequest('/admin/dashboard');
            document.getElementById('totalDepartments').textContent = data.totalDepartments;
            document.getElementById('totalStudents').textContent = data.totalStudents;
            document.getElementById('pendingRegistrations').textContent = data.pendingRegistrations;

            const list = document.getElementById('recentActivitiesList');
            list.innerHTML = '';
            if (data.recentActivities.length === 0) {
                list.innerHTML = `<li class="activity-item">No recent activities</li>`;
                return;
            }
            data.recentActivities.forEach(a => {
                const li = document.createElement('li');
                li.className = 'activity-item';
                li.textContent = a.description;
                list.appendChild(li);
            });
        } catch (err) {
            console.error('Failed to load dashboard overview:', err);
        }
    }

    async function loadDepartments() {
        const deptTable = document.querySelector('#departmentsTable tbody');
        if (!deptTable) return;
        try {
            const data = await apiRequest('/admin/departments');
            deptTable.innerHTML = '';
            data.departments.forEach(d => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${d.name}</td>
                    <td>${d.code}</td>
                    <td>
                        <button class="btn btn-edit" onclick="editDepartment(${d.id}, '${d.name.replace(/'/g, "\\'")}', '${d.code.replace(/'/g, "\\'")}')">Edit</button>
                        <button class="btn btn-delete" onclick="deleteDepartment(${d.id})">Delete</button>
                    </td>`;
                deptTable.appendChild(tr);
            });
        } catch (err) {
            console.error('Failed to load departments:', err);
        }
    }

    window.editDepartment = async function(id, currentName, currentCode) {
        const newName = prompt('Enter new department name', currentName);
        const newCode = prompt('Enter new department code', currentCode);
        if (newName && newCode) {
            try {
                await apiRequest(`/admin/departments/${id}`, { method: 'PUT', body: JSON.stringify({ name: newName, code: newCode }) });
                loadDepartments();
                loadDepartmentsDropdown();
                loadDashboardOverview();
            } catch (err) {
                alert(err.message);
            }
        }
    };

    window.deleteDepartment = async function(id) {
        if (!confirm('Are you sure you want to delete this department?')) return;
        try {
            await apiRequest(`/admin/departments/${id}`, { method: 'DELETE' });
            loadDepartments();
            loadDepartmentsDropdown();
            loadDashboardOverview();
        } catch (err) {
            alert(err.message);
        }
    };

    async function loadDepartmentsDropdown() {
        const examDeptSelect = document.getElementById('examDepartments');
        if (!examDeptSelect) return;
        try {
            const data = await apiRequest('/admin/departments');
            examDeptSelect.innerHTML = '';
            data.departments.forEach(d => {
                const option = document.createElement('option');
                option.value = d.code;
                option.textContent = d.name;
                examDeptSelect.appendChild(option);
            });
        } catch (err) {
            console.error('Failed to load departments dropdown:', err);
        }
    }

    async function loadExams() {
        const examTableBody = document.querySelector('#examTable tbody');
        if (!examTableBody) return;
        try {
            const data = await apiRequest('/admin/exams');
            examTableBody.innerHTML = '';
            data.exams.forEach(ex => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${ex.department_name || ex.department_code}</td>
                    <td>${ex.exam_name}</td>
                    <td>${new Date(ex.exam_date).toLocaleString()}</td>
                    <td>
                        <input type="checkbox" ${ex.restricted ? 'checked' : ''} onchange="toggleRestriction(${ex.id}, this.checked)">
                    </td>
                    <td>
                        <button class="btn btn-delete" onclick="deleteExam(${ex.id})">Delete</button>
                    </td>`;
                examTableBody.appendChild(tr);
            });
        } catch (err) {
            console.error('Failed to load exams:', err);
        }
    }

    window.toggleRestriction = async function(id, checked) {
        try {
            await apiRequest(`/admin/exams/${id}/restriction`, { method: 'PATCH', body: JSON.stringify({ restricted: checked }) });
            loadDashboardOverview();
        } catch (err) {
            alert(err.message);
        }
    };

    window.deleteExam = async function(id) {
        if (!confirm('Are you sure you want to delete this exam?')) return;
        try {
            await apiRequest(`/admin/exams/${id}`, { method: 'DELETE' });
            loadExams();
            loadDashboardOverview();
        } catch (err) {
            alert(err.message);
        }
    };

    async function loadStudents() {
        const studentsTable = document.querySelector('#studentsTable tbody');
        if (!studentsTable) return;
        try {
            const data = await apiRequest('/admin/students');
            studentsTable.innerHTML = '';
            if (data.students.length === 0) {
                studentsTable.innerHTML = `<tr><td colspan="6">No students registered yet.</td></tr>`;
                return;
            }
            data.students.forEach(s => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${s.full_name}</td>
                    <td>${s.matric_no}</td>
                    <td>${s.email}</td>
                    <td>${s.department_name || s.department_code}</td>
                    <td>${s.fingerprint_registered ? 'Registered' : 'Pending'}</td>
                    <td>-</td>`;
                studentsTable.appendChild(tr);
            });
        } catch (err) {
            console.error('Failed to load students:', err);
        }
    }
}

/* ==========================================================================
   2. ADMIN LOGIN LOGIC (admin-login.html)
   Plain username/password login — no fingerprint UI for admin.
   ========================================================================== */
if (document.getElementById('adminLoginForm')) {

    const adminLoginForm = document.getElementById('adminLoginForm');
    const adminFingerprintStatus = document.getElementById('adminFingerprintStatus');
    const adminUsernameInput = document.getElementById('adminUsername');
    const adminPasswordInput = document.getElementById('adminPassword');

    // Default login on first run: username "admin", password "changeme123"
    // (shown in the server console on first start — change it after login).

    adminLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = adminUsernameInput.value.trim();
        const password = adminPasswordInput.value;

        if (!username || !password) {
            adminFingerprintStatus.textContent = 'Please enter username and password.';
            adminFingerprintStatus.className = 'status-message status-error';
            return;
        }

        adminFingerprintStatus.textContent = 'Logging in...';
        adminFingerprintStatus.className = 'status-message status-pending';

        try {
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();

            if (response.ok && data.success) {
                adminFingerprintStatus.textContent = 'Login successful! Redirecting...';
                adminFingerprintStatus.className = 'status-message status-success';
                setTimeout(() => { window.location.href = '/dashboard.html'; }, 500);
            } else {
                adminFingerprintStatus.textContent = data.message || 'Invalid username or password.';
                adminFingerprintStatus.className = 'status-message status-error';
            }
        } catch (err) {
            console.error('Login error:', err);
            adminFingerprintStatus.textContent = 'Network error. Please try again.';
            adminFingerprintStatus.className = 'status-message status-error';
        }
    });
}

/* ==========================================================================
   3. STUDENT REGISTRATION LOGIC (registration.html)
   Uses real WebAuthn — the student's own phone/laptop fingerprint sensor
   (Touch ID, Windows Hello, Android fingerprint) via the browser's built-in
   WebAuthn API. No external hardware needed.
   ========================================================================== */
if (document.getElementById('registrationForm') && document.getElementById('scanFingerprintBtn')) {

    const registrationForm = document.getElementById('registrationForm');
    const matricNoInput = document.getElementById('matricNo');
    const fullNameInput = document.getElementById('fullName');
    const emailInput = document.getElementById('email');
    const departmentInput = document.getElementById('department');
    const scanFingerprintBtn = document.getElementById('scanFingerprintBtn');
    const fingerprintStatus = document.getElementById('fingerprintStatus');
    const fingerprintIcon = document.getElementById('fingerprintIcon');
    const submitRegistrationBtn = document.getElementById('submitRegistrationBtn');

    let savedStudentId = null;

    // Step 1: save the student's basic details first (needed before we can
    // issue a WebAuthn challenge tied to their student record).
    submitRegistrationBtn.addEventListener('click', async (event) => {
        event.preventDefault();

        if (!matricNoInput.value || !fullNameInput.value || !emailInput.value || !departmentInput.value) {
            fingerprintStatus.textContent = 'Please fill in all required fields.';
            fingerprintIcon.className = 'fingerprint-icon error';
            return;
        }

        submitRegistrationBtn.textContent = 'Saving...';
        submitRegistrationBtn.disabled = true;

        try {
            const result = await apiRequest('/students/register-info', {
                method: 'POST',
                body: JSON.stringify({
                    matricNo: matricNoInput.value,
                    fullName: fullNameInput.value,
                    email: emailInput.value,
                    department: departmentInput.value
                })
            });

            savedStudentId = result.studentId;
            fingerprintStatus.textContent = 'Details saved! Now register your fingerprint below.';
            fingerprintIcon.className = 'fingerprint-icon success';

            [matricNoInput, fullNameInput, emailInput, departmentInput].forEach(el => el.disabled = true);
            submitRegistrationBtn.textContent = 'Details Saved';
            scanFingerprintBtn.disabled = false;
            scanFingerprintBtn.textContent = 'Register Fingerprint';
        } catch (err) {
            fingerprintStatus.textContent = err.message || 'Could not save details.';
            fingerprintIcon.className = 'fingerprint-icon error';
            submitRegistrationBtn.textContent = 'Save Details';
            submitRegistrationBtn.disabled = false;
        }
    });

    // Step 2: trigger the real WebAuthn fingerprint registration prompt.
    scanFingerprintBtn.addEventListener('click', async () => {
        if (!savedStudentId) {
            fingerprintStatus.textContent = 'Please save your details first.';
            fingerprintIcon.className = 'fingerprint-icon error';
            return;
        }

        if (!window.SimpleWebAuthnBrowser) {
            fingerprintStatus.textContent = 'Fingerprint library failed to load. Check your internet connection.';
            fingerprintIcon.className = 'fingerprint-icon error';
            return;
        }

        fingerprintStatus.textContent = 'Follow the prompt on your device to scan your fingerprint...';
        fingerprintIcon.className = 'fingerprint-icon scanning';
        scanFingerprintBtn.disabled = true;

        try {
            const optionsResult = await apiRequest('/students/webauthn/register-options', {
                method: 'POST',
                body: JSON.stringify({ studentId: savedStudentId })
            });

            const attestationResponse = await window.SimpleWebAuthnBrowser.startRegistration({
                optionsJSON: optionsResult.options
            });

            const verifyResult = await apiRequest('/students/webauthn/register-verify', {
                method: 'POST',
                body: JSON.stringify({ studentId: savedStudentId, response: attestationResponse })
            });

            if (verifyResult.success) {
                fingerprintStatus.textContent = 'Registration complete! Your fingerprint is now saved.';
                fingerprintIcon.className = 'fingerprint-icon success';
                scanFingerprintBtn.textContent = 'Registered';
            } else {
                fingerprintStatus.textContent = verifyResult.message || 'Fingerprint registration failed.';
                fingerprintIcon.className = 'fingerprint-icon error';
                scanFingerprintBtn.disabled = false;
            }
        } catch (err) {
            console.error('WebAuthn registration error:', err);
            if (err.name === 'NotAllowedError') {
                fingerprintStatus.textContent = 'Fingerprint scan was cancelled or timed out. Please try again.';
            } else if (err.name === 'InvalidStateError') {
                fingerprintStatus.textContent = 'This device is already registered for this student.';
            } else {
                fingerprintStatus.textContent = err.message || 'Fingerprint registration failed. Please try again.';
            }
            fingerprintIcon.className = 'fingerprint-icon error';
            scanFingerprintBtn.disabled = false;
        }
    });
}

/* ==========================================================================
   4. EXAM VERIFICATION LOGIC (exam-verification.html)
   Uses real WebAuthn — student enters their matric number, then verifies
   using their own device's fingerprint sensor (the same one they registered
   with). Each student verifies on their own phone/laptop.
   ========================================================================== */
if (document.getElementById('mockScanButton') && document.getElementById('verifyMatricNo')) {

    const verificationStatusMessage = document.getElementById('verificationStatusMessage');
    const verificationIcon = document.getElementById('verificationIcon');
    const mockScanButton = document.getElementById('mockScanButton');
    const verifyMatricNoInput = document.getElementById('verifyMatricNo');

    function setStatus(message, state) {
        verificationStatusMessage.classList.remove('status-success', 'status-error', 'status-pending');
        verificationIcon.classList.remove('scanning', 'success', 'error');
        verificationStatusMessage.textContent = message;
        if (state) {
            verificationStatusMessage.classList.add(`status-${state}`);
            if (state !== 'pending') verificationIcon.classList.add(state);
        }
    }

    mockScanButton.addEventListener('click', async () => {
        const matricNo = verifyMatricNoInput.value.trim();
        if (!matricNo) {
            setStatus('Please enter your matric number first.', 'error');
            return;
        }

        if (!window.SimpleWebAuthnBrowser) {
            setStatus('Fingerprint library failed to load. Check your internet connection.', 'error');
            return;
        }

        setStatus('Looking up your registration...', 'pending');
        verificationIcon.classList.add('scanning');
        mockScanButton.disabled = true;

        try {
            const optionsResult = await apiRequest('/verify/options', {
                method: 'POST',
                body: JSON.stringify({ matricNo })
            });

            setStatus('Follow the prompt on your device to scan your fingerprint...', 'pending');

            const assertionResponse = await window.SimpleWebAuthnBrowser.startAuthentication({
                optionsJSON: optionsResult.options
            });

            const confirmResult = await apiRequest('/verify/confirm', {
                method: 'POST',
                body: JSON.stringify({ studentId: optionsResult.studentId, response: assertionResponse })
            });

            if (confirmResult.granted) {
                setStatus(confirmResult.message, 'success');
            } else {
                setStatus(confirmResult.message, 'error');
            }
        } catch (err) {
            console.error('WebAuthn verification error:', err);
            if (err.name === 'NotAllowedError') {
                setStatus('Fingerprint scan was cancelled or timed out. Please try again.', 'error');
            } else {
                setStatus(err.message || 'Verification failed. Please try again.', 'error');
            }
        } finally {
            mockScanButton.disabled = false;
            verificationIcon.classList.remove('scanning');
            setTimeout(() => {
                setStatus('Enter your matric number, then tap the button below.', 'pending');
            }, 5000);
        }
    });
}
