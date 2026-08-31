import { describe, it, expect } from 'vitest';
import { getFiiSegmentIcon, getFiiSegmentStyle } from './fiiSegmentIcon';

// O mapa de ícones é indexado pelo RÓTULO de `fiiSectorLabel`, não pelo texto da
// fonte. É o acoplamento frágil do desenho: renomear um rótulo em
// FII_SEGMENT_LABELS apagaria o ícone daquele segmento em silêncio. Estes casos
// entram pelo texto CRU do Fundamentus e cobrem os 15 segmentos do canon.
const CANON = [
        'Shoppings',
        'Logistica',
        'Imoveis Industriais e Logisticos',
        'Lajes Corporativas',
        'Escritorios',
        'Renda Urbana',
        'Agencias de Bancos',
        'Hoteis',
        'Hibrido',
        'Papel',
        'Recebiveis',
        'Titulos e Val. Mob.',
        'Fundo de Fundos',
        'Multiestrategia',
        'Fiagro',
        'Infraestrutura',
        'Desenvolvimento',
        'Residencial',
        'Imobiliario',
        'Exploracao de Imoveis',
        'Hospital',
        'Saude',
];

describe('getFiiSegmentIcon', () => {
    it.each(CANON)('resolve um ícone para "%s"', (sector) => {
        expect(getFiiSegmentIcon(sector)).toBeTruthy();
    });

    it('dá ícones distintos a segmentos de risco distinto', () => {
        // O caso que motivou a troca: HGCR11 (papel) e HGBS11 (shoppings) tinham
        // o mesmo chip "HG".
        expect(getFiiSegmentIcon('Papel')).not.toBe(getFiiSegmentIcon('Shoppings'));
    });

    it('trata sinônimos da mesma coisa como o mesmo ícone', () => {
        expect(getFiiSegmentIcon('Recebiveis')).toBe(getFiiSegmentIcon('Papel'));
        expect(getFiiSegmentIcon('Escritorios')).toBe(getFiiSegmentIcon('Lajes Corporativas'));
    });

    it('devolve null sem segmento ou fora do canon — a linha cai nas iniciais', () => {
        expect(getFiiSegmentIcon('')).toBeNull();
        expect(getFiiSegmentIcon(undefined)).toBeNull();
        expect(getFiiSegmentIcon(null)).toBeNull();
        expect(getFiiSegmentIcon('Segmento Novo do Fundamentus')).toBeNull();
    });
});

// A cor é da FAMÍLIA de risco, não do segmento: o que se testa aqui é que todo
// segmento do canon tem tom, que verde e vermelho — reservados ao resultado da
// linha — não aparecem, e que as classes vêm escritas por extenso (o Tailwind
// varre o fonte; `bg-${tone}/10` sumiria do build em silêncio).
describe('getFiiSegmentStyle', () => {
    it.each(CANON)('resolve ícone e tom para "%s"', (sector) => {
        const style = getFiiSegmentStyle(sector);
        expect(style?.icon).toBeTruthy();
        expect(style?.chip).toMatch(/^bg-[a-z]+-\d{3}\/10 border-[a-z]+-\d{3}\/30 text-[a-z]+-\d{3}$/);
    });

    it('nunca usa o verde nem o vermelho, que são do resultado da linha', () => {
        CANON.forEach((sector) => {
            expect(getFiiSegmentStyle(sector)?.chip).not.toMatch(/emerald|green|lime|red|rose/);
        });
    });

    it('agrupa por família: papel e híbrido no violeta, shopping e loja no laranja', () => {
        expect(getFiiSegmentStyle('Papel')?.chip).toContain('violet');
        expect(getFiiSegmentStyle('Hibrido')?.chip).toContain('violet');
        expect(getFiiSegmentStyle('Shoppings')?.chip).toContain('orange');
        expect(getFiiSegmentStyle('Renda Urbana')?.chip).toContain('orange');
    });

    it('dá tons distintos a riscos distintos — papel não se parece com shopping', () => {
        expect(getFiiSegmentStyle('Papel')?.chip).not.toBe(getFiiSegmentStyle('Shoppings')?.chip);
    });

    it('devolve null fora do canon', () => {
        expect(getFiiSegmentStyle('Segmento Novo do Fundamentus')).toBeNull();
        expect(getFiiSegmentStyle(null)).toBeNull();
    });
});
