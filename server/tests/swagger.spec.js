/**
 * I7 — geração do spec OpenAPI.
 * Garante que o documento é construído (swagger-jsdoc) e tem a forma esperada:
 * versão OpenAPI, security scheme Bearer, tags e rotas-chave documentadas.
 */
import { describe, it, expect } from 'vitest';
import { swaggerSpec } from '../config/swagger.js';

describe('swaggerSpec (OpenAPI)', () => {
  it('é um documento OpenAPI 3 válido com info', () => {
    expect(swaggerSpec.openapi).toMatch(/^3\./);
    expect(swaggerSpec.info.title).toBe('Vértice Invest API');
    expect(swaggerSpec.info.version).toBeTruthy();
  });

  it('define o esquema de segurança Bearer JWT', () => {
    const scheme = swaggerSpec.components.securitySchemes.bearerAuth;
    expect(scheme).toMatchObject({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  });

  it('documenta as rotas principais', () => {
    const paths = Object.keys(swaggerSpec.paths);
    expect(paths).toEqual(expect.arrayContaining(['/login', '/register', '/wallet', '/wallet/add', '/research/latest']));
  });

  it('cobre todas as áreas da API (auth/mfa/wallet/research/market/subscription/goals/academy/notifications/webhooks)', () => {
    const paths = Object.keys(swaggerSpec.paths);
    expect(paths).toEqual(expect.arrayContaining([
      '/forgot-password', '/reset-password', '/me/avatar', '/change-password', // auth
      '/mfa/status', '/mfa/enable', // mfa
      '/wallet/history', '/wallet/dividends', '/wallet/transactions/{ticker}', '/wallet/rebalance', // wallet
      '/research/discard-logs', '/research/config/tunables', '/research/accuracy', // research
      '/market/landing', '/market/price', // market
      '/subscription/check-access', '/subscription/register-usage', // subscription
      '/goals', '/goals/{id}/contributions', // goals
      '/academy/courses', '/academy/quiz/submit', // academy
      '/notifications', '/notifications/read-all', // notifications
      '/webhooks/mercadopago', // webhooks
    ]));
  });

  it('declara as tags por área', () => {
    const tagNames = swaggerSpec.tags.map((t) => t.name);
    expect(tagNames).toEqual(expect.arrayContaining([
      'Auth', 'MFA', 'Wallet', 'Research', 'Research (Admin)', 'Market',
      'Subscription', 'Goals', 'Academy', 'Notifications', 'Webhooks',
    ]));
  });

  it('marca como públicas (security: []) as rotas sem JWT', () => {
    expect(swaggerSpec.paths['/forgot-password'].post.security).toEqual([]);
    expect(swaggerSpec.paths['/market/landing'].get.security).toEqual([]);
    expect(swaggerSpec.paths['/academy/courses'].get.security).toEqual([]);
    expect(swaggerSpec.paths['/webhooks/mercadopago'].post.security).toEqual([]);
  });

  it('marca rotas públicas (login/register) com security: []', () => {
    expect(swaggerSpec.paths['/login'].post.security).toEqual([]);
    expect(swaggerSpec.paths['/register'].post.security).toEqual([]);
  });

  it('aplica Bearer por padrão no nível raiz', () => {
    expect(swaggerSpec.security).toEqual([{ bearerAuth: [] }]);
  });
});
