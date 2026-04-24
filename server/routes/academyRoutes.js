import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import {
    getCourses,
    getCourseById,
    getLessonById,
    updateProgress,
    getCourseProgress,
    seedAcademy,
    generateCertificate,
    getQuizByCourseId,
    submitQuiz
} from '../controllers/academyController.js';

const router = express.Router();

// Rotas públicas (preview de catálogo)
router.get('/courses', getCourses);
router.get('/courses/:id', getCourseById);

// Todas as rotas abaixo exigem autenticação
router.use(authenticateToken);

router.get('/lessons/:id', getLessonById);
router.get('/progress/:courseId', getCourseProgress);
router.post('/progress', updateProgress);
router.get('/certificate/:courseId', generateCertificate);
router.get('/quiz/:courseId', getQuizByCourseId);
router.post('/quiz/submit', submitQuiz);

// Rota de seed: apenas admins, apenas fora de produção
router.post('/seed', requireAdmin, (req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ message: 'Não disponível em produção.' });
    }
    next();
}, seedAcademy);

export default router;
