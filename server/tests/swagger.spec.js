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

  it('marca rotas públicas (login/register) com security: []', () => {
    expect(swaggerSpec.paths['/login'].post.security).toEqual([]);
    expect(swaggerSpec.paths['/register'].post.security).toEqual([]);
  });

  it('aplica Bearer por padrão no nível raiz', () => {
    expect(swaggerSpec.security).toEqual([{ bearerAuth: [] }]);
  });
});
