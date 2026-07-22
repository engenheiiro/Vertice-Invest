import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve('services/macroDataService.js'), 'utf8');

describe('macroDataService — segurança de transporte', () => {
  it('não contém escape hatch de TLS inseguro nem fallback HTTP', () => {
    expect(source).not.toContain('ALLOW_INSECURE_TLS');
    expect(source).not.toContain("from 'http'");
    expect(source).not.toMatch(/axios\.get\(\s*`http:\/\//);
    expect(source).toContain('rejectUnauthorized: true');
  });
});
