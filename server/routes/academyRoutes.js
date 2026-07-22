import express from 'express';
import { authenticateToken, optionalAuthenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import validate from '../middleware/validateResource.js';
import {
    academyCourseParamSchema,
    academyLessonParamSchema,
    academyProgressSchema,
    academyQuizSubmitSchema,
} from '../schemas/academySchemas.js';
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
router.get('/courses', optionalAuthenticateToken, getCourses);
router.get('/courses/:id', optionalAuthenticateToken, validate(academyCourseParamSchema), getCourseById);

// Todas as rotas abaixo exigem autenticação
router.use(authenticateToken);

router.get('/lessons/:id', validate(academyLessonParamSchema), getLessonById);
router.get('/progress/:courseId', validate(academyCourseParamSchema), getCourseProgress);
router.post('/progress', validate(academyProgressSchema), updateProgress);
router.get('/certificate/:courseId', validate(academyCourseParamSchema), generateCertificate);
router.get('/quiz/:courseId', validate(academyCourseParamSchema), getQuizByCourseId);
router.post('/quiz/submit', validate(academyQuizSubmitSchema), submitQuiz);

// Rota de seed: apenas admins, apenas fora de produção
router.post('/seed', requireAdmin, (req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ message: 'Não disponível em produção.' });
    }
    next();
}, seedAcademy);

export default router;
