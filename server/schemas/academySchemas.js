import { z } from 'zod';

const resourceId = z.string()
  .trim()
  .min(1, 'Identificador é obrigatório.')
  .max(128, 'Identificador inválido.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Identificador inválido.');

export const academyCourseParamSchema = z.object({
  params: z.object({ courseId: resourceId.or(z.undefined()), id: resourceId.or(z.undefined()) })
    .refine((params) => params.courseId || params.id, 'Identificador do curso é obrigatório.'),
});

export const academyLessonParamSchema = z.object({
  params: z.object({ id: resourceId }),
});

export const academyProgressSchema = z.object({
  body: z.object({
    lessonId: resourceId,
    watchTime: z.coerce.number().finite().min(0).max(86_400),
    completed: z.boolean(),
  }).strict(),
});

export const academyQuizSubmitSchema = z.object({
  body: z.object({
    courseId: resourceId,
    answers: z.array(z.number().int().min(0).max(99)).min(1).max(100),
  }).strict(),
});

// Seed da Academy (admin, fora de produção): não recebe nada. Corpo extra é
// recusado em vez de ignorado — nenhuma opção escondida chega ao seed.
export const academySeedSchema = z.object({
  body: z.object({}).strict().optional(),
});
