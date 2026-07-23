import fs from 'fs';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

// Resolve relativo ao próprio spec (server/tests/), não ao CWD — rodar da raiz do
// repo apontava para <root>/services/... (inexistente) e quebrava o arquivo inteiro.
const source = fs.readFileSync(fileURLToPath(new URL('../services/macroDataService.js', import.meta.url)), 'utf8');

describe('macroDataService — segurança de transporte', () => {
  it('não contém escape hatch de TLS inseguro nem fallback HTTP', () => {
    expect(source).not.toContain('ALLOW_INSECURE_TLS');
    expect(source).not.toContain("from 'http'");
    expect(source).not.toMatch(/axios\.get\(\s*`http:\/\//);
    expect(source).toContain('rejectUnauthorized: true');
  });
});
