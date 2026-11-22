/**
 * Rotas que entravam sem schema (ou com o limiter errado):
 *  - notificações: escrita no balde de LEITURA e :id sem validação (CastError → 500);
 *  - admin de research: backtest/narrative/generate-explainable/errors sem schema;
 *  - seed da Academy: sem limiter além do global por IP.
 * Lê as rotas montadas (sem banco) e confere a cadeia de middleware.
 */
import fs from 'fs';
import { describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const limiters = await import('../middleware/rateLimiters.js');
const { notificationIdParamSchema, readAllNotificationsSchema } = await import('../schemas/notificationSchemas.js');
const {
  backtestConfigSchema, narrativeSchema, explainableSchema, errorIdParamSchema,
} = await import('../schemas/researchSchemas.js');
const { academySeedSchema } = await import('../schemas/academySchemas.js');

const HEX = 'a'.repeat(24);

const stackOf = (router, method, path) => {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  return layer ? layer.route.stack.map((s) => s.handle) : null;
};

describe('schemas', () => {
  it('notificação: :id precisa ser ObjectId; read-all sem corpo extra', () => {
    expect(notificationIdParamSchema.safeParse({ params: { id: HEX } }).success).toBe(true);
    expect(notificationIdParamSchema.safeParse({ params: { id: 'abc' } }).success).toBe(false);
    expect(readAllNotificationsSchema.safeParse({ body: {} }).success).toBe(true);
    expect(readAllNotificationsSchema.safeParse({ body: undefined }).success).toBe(true);
    expect(readAllNotificationsSchema.safeParse({ body: { x: 1 } }).success).toBe(false);
  });

  it('backtest: inteiro entre 1 e 90, corpo estrito', () => {
    for (const days of [3, 7, 15, 30]) expect(backtestConfigSchema.safeParse({ body: { days } }).success).toBe(true);
    expect(backtestConfigSchema.safeParse({ body: { days: '7' } }).success).toBe(false);
    expect(backtestConfigSchema.safeParse({ body: { days: 0 } }).success).toBe(false);
    expect(backtestConfigSchema.safeParse({ body: { days: 7.5 } }).success).toBe(false);
    expect(backtestConfigSchema.safeParse({ body: { days: 7, x: 1 } }).success).toBe(false);
  });

  it('narrative / explainable: analysisId ObjectId; customText e profile opcionais', () => {
    expect(narrativeSchema.safeParse({ body: { analysisId: HEX } }).success).toBe(true);
    expect(narrativeSchema.safeParse({ body: { analysisId: { $ne: null } } }).success).toBe(false);
    expect(explainableSchema.safeParse({ body: { analysisId: HEX, customText: 'oi' } }).success).toBe(true);
    expect(explainableSchema.safeParse({ body: { analysisId: HEX, profile: 'BOLD' } }).success).toBe(true);
    expect(explainableSchema.safeParse({ body: { analysisId: HEX, profile: 'X' } }).success).toBe(false);
    expect(explainableSchema.safeParse({ body: { analysisId: HEX, customText: 'x'.repeat(20_001) } }).success).toBe(false);
  });

  it('errors/:id e academy/seed', () => {
    expect(errorIdParamSchema.safeParse({ params: { id: HEX } }).success).toBe(true);
    expect(errorIdParamSchema.safeParse({ params: { id: 'zz' } }).success).toBe(false);
    expect(academySeedSchema.safeParse({ body: {} }).success).toBe(true);
    expect(academySeedSchema.safeParse({ body: { reset: true } }).success).toBe(false);
  });
});

describe('cadeia de middleware', () => {
  it('notificações: escrita usa o limiter de escrita, não o de leitura', async () => {
    const router = (await import('../routes/notificationRoutes.js')).default;
    for (const [method, path] of [['put', '/:id/read'], ['post', '/read-all']]) {
      const stack = stackOf(router, method, path);
      expect(stack).toContain(limiters.notificationWriteLimiter);
      expect(stack).not.toContain(limiters.researchReadLimiter);
      expect(stack.length).toBeGreaterThanOrEqual(3); // limiter → validate → handler
    }
  });

  it('academy/seed tem limiter por usuário', async () => {
    const router = (await import('../routes/academyRoutes.js')).default;
    expect(stackOf(router, 'post', '/seed')).toContain(limiters.adminWriteLimiter);
  });

  it('research admin: schema em todas e generate-explainable no balde pesado (chama IA)', () => {
    // Lido do fonte: importar o router puxa o cliente do Gemini e os serviços de mercado.
    const src = fs.readFileSync(new URL('../routes/researchRoutes.js', import.meta.url), 'utf8');
    expect(src).toContain("router.post('/generate-explainable', researchHeavyLimiter, requireAdmin, validate(explainableSchema)");
    expect(src).toContain("router.post('/config/backtest', adminLimiter, requireAdmin, validate(backtestConfigSchema)");
    expect(src).toContain("router.post('/narrative', researchHeavyLimiter, requireAdmin, validate(narrativeSchema)");
    expect(src).toContain("router.post('/errors/:id/resolve', adminLimiter, requireAdmin, validate(errorIdParamSchema)");
  });
});
