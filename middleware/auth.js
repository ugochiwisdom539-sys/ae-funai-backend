// middleware/auth.js
// Simple session-based auth guard for admin-only routes.

function requireAdminAuth(req, res, next) {
    if (req.session && req.session.adminId) {
        return next();
    }
    return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });
}

module.exports = { requireAdminAuth };
