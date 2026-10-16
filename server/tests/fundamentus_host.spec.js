import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    FUNDAMENTUS_BASE_URL,
    FUNDAMENTUS_STOCKS_LAYOUT,
    FUNDAMENTUS_FIIS_LAYOUT,
} from '../config/scraperSchemas.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Em 16/10/2026 o certificado do Fundamentus deixou de cobrir o `www`, e a URL
// estava copiada em três arquivos: ações, FIIs e full-sync caíram juntos.
describe('host do Fundamentus', () => {
    it('as páginas raspadas derivam do host único', () => {
        expect(FUNDAMENTUS_STOCKS_LAYOUT.source.startsWith(`${FUNDAMENTUS_BASE_URL}/`)).toBe(true);
        expect(FUNDAMENTUS_FIIS_LAYOUT.source.startsWith(`${FUNDAMENTUS_BASE_URL}/`)).toBe(true);
    });

    it('nenhum serviço escreve o host por conta própria', () => {
        for (const rel of ['services/fundamentusService.js', 'services/dividendPaymentDateService.js']) {
            const src = fs.readFileSync(path.join(serverDir, rel), 'utf8');
            expect(src, rel).not.toMatch(/fundamentus\.com\.br/);
        }
    });
});
