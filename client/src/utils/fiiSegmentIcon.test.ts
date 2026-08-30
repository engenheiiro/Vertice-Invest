import { describe, it, expect } from 'vitest';
import { getFiiSegmentIcon } from './fiiSegmentIcon';

// O mapa de ícones é indexado pelo RÓTULO de `fiiSectorLabel`, não pelo texto da
// fonte. É o acoplamento frágil do desenho: renomear um rótulo em
// FII_SEGMENT_LABELS apagaria o ícone daquele segmento em silêncio. Estes casos
// entram pelo texto CRU do Fundamentus e cobrem os 15 segmentos do canon.
describe('getFiiSegmentIcon', () => {
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
