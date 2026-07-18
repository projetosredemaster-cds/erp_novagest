const express = require('express');
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/authMiddleware');

const router = express.Router();

// POST /api/auth/login  (pública)
router.post('/login', authController.login);

// GET  /api/auth/me  (protegida por authMiddleware)
router.get('/me', authMiddleware, authController.me);

module.exports = router;
