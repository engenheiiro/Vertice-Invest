import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../models/Course.js', () => ({ default: { find: vi.fn(), findById: vi.fn() } }));
vi.mock('../models/Lesson.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../models/UserProgress.js', () => ({ default: { find: vi.fn(), findOne: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../models/Quiz.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/QuizAttempt.js', () => ({ default: { find: vi.fn(), create: vi.fn(), findOne: vi.fn() } }));
vi.mock('../config/logger.js', () => ({ default: { error: vi.fn(), debug: vi.fn(), info: vi.fn() } }));

const Course = (await import('../models/Course.js')).default;
const UserProgress = (await import('../models/UserProgress.js')).default;
const Quiz = (await import('../models/Quiz.js')).default;
const QuizAttempt = (await import('../models/QuizAttempt.js')).default;
const { getCourses, getCourseProgress, getQuizByCourseId } = await import('../controllers/academyController.js');

const response = () => {
  const res = { statusCode: 200, body: null };
  res.status = (status) => { res.statusCode = status; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

describe('Academy — autenticação e gates de plano', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mantém o catálogo público sem associá-lo ao primeiro usuário do banco', async () => {
    Course.find.mockReturnValue({
      sort: vi.fn().mockResolvedValue([{ _id: 'course-pp', toObject: () => ({ _id: 'course-pp' }) }]),
    });
    const res = response();

    await getCourses({ user: undefined }, res, vi.fn());

    expect(UserProgress.find).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body[0].progress.completedLessons).toBe(0);
  });

  it('bloqueia o quiz de curso PRO para um usuário GUEST', async () => {
    Course.findById.mockResolvedValue({ _id: 'course-pro', requiredPlan: 'PRO', isLocked: false });
    const res = response();

    await getQuizByCourseId({ params: { courseId: 'course-pro' }, user: { plan: 'GUEST', role: 'USER' } }, res, vi.fn());

    expect(res.statusCode).toBe(403);
    expect(Quiz.findOne).not.toHaveBeenCalled();
    expect(res.body.requiredPlan).toBe('PRO');
  });

  it('consulta somente o progresso do usuário autenticado no catálogo', async () => {
    Course.find.mockReturnValue({
      sort: vi.fn().mockResolvedValue([{ _id: 'course-pp', toObject: () => ({ _id: 'course-pp' }) }]),
    });
    UserProgress.find.mockResolvedValue([{ userId: 'user-a', courseId: 'course-pp', completed: true }]);
    const res = response();

    await getCourses({ user: { _id: 'user-a' } }, res, vi.fn());

    expect(UserProgress.find).toHaveBeenCalledWith({ userId: 'user-a' });
    expect(res.body[0].progress.completedLessons).toBe(1);
  });

  it('não mistura progresso e tentativas de quiz entre usuários', async () => {
    Course.findById.mockResolvedValue({ _id: 'course-pp', requiredPlan: 'ESSENTIAL', isLocked: false });
    UserProgress.find.mockResolvedValue([{ userId: 'user-a', courseId: 'course-pp', completed: true }]);
    QuizAttempt.find.mockReturnValue({ sort: vi.fn().mockResolvedValue([{ userId: 'user-a', courseId: 'course-pp' }]) });
    const res = response();

    await getCourseProgress({
      params: { courseId: 'course-pp' },
      user: { _id: 'user-a', plan: 'ESSENTIAL', role: 'USER' },
    }, res, vi.fn());

    expect(UserProgress.find).toHaveBeenCalledWith({ userId: 'user-a', courseId: 'course-pp' });
    expect(QuizAttempt.find).toHaveBeenCalledWith({ userId: 'user-a', courseId: 'course-pp' });
    expect(res.statusCode).toBe(200);
  });
});
