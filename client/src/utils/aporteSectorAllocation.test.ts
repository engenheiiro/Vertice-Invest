/**
 * computeAporteSectorView — leitura setorial do Aporte Inteligente.
 *
 * O que os testes protegem:
 *  - a repartição do aporte usa a MESMA chave de setor da carteira (sinônimos do
 *    Fundamentus colapsam numa fatia só);
 *  - o "depois" soma posição atual + compras, e o "antes" de cada fatia é medido
 *    pelos MESMOS tickers da fatia (não por rótulo), para a dobra "Outros" bater;
 *  - a contagem de setores não é o nº de fatias — a dobra não pode encolher o
 *    número de setores que o usuário está comprando.
 */
import { describe, expect, it } from 'vitest';
import { computeAporteSectorView, type AporteLine } from './aporteSectorAllocation';
import type { Asset } from '../contexts/WalletContext';

const line = (ticker: string, sector: string, cost: number): AporteLine => ({ ticker, sector, cost, type: 'FII' });

const holding = (ticker: string, totalValue: number, sector?: string): Pick<Asset, 'ticker' | 'sector' | 'type' | 'totalValue'> =>
    ({ ticker, sector, type: 'FII', totalValue });

const pctOf = (slices: { label: string; pct: number }[], label: string) =>
    slices.find((s) => s.label === label)?.pct;

describe('computeAporteSectorView — repartição do aporte', () => {
    it('reparte as compras por segmento e casa cor com ticker', () => {
        const view = computeAporteSectorView(
            [line('VISC11', 'Shoppings', 200), line('KNCR11', 'Papel', 100), line('HGLG11', 'Logística', 100)],
            [],
            'FII',
        );

        expect(pctOf(view.aporte, 'Shoppings')).toBeCloseTo(50, 5);
        expect(pctOf(view.aporte, 'Papel (CRI)')).toBeCloseTo(25, 5);
        expect(pctOf(view.aporte, 'Logística')).toBeCloseTo(25, 5);

        const shoppings = view.aporte.find((s) => s.label === 'Shoppings')!;
        expect(view.colorByTicker.get('VISC11')).toBe(shoppings.color);
        expect(view.labelByTicker.get('KNCR11')).toBe('Papel (CRI)');
    });

    it('colapsa sinônimos do Fundamentus numa única fatia', () => {
        // "Títulos e Val. Mob." e "Papel" são o mesmo risco de crédito (CRI).
        const view = computeAporteSectorView(
            [line('KNCR11', 'Títulos e Val. Mob.', 100), line('KNSC11', 'Papel', 100)],
            [],
            'FII',
        );

        expect(view.aporte).toHaveLength(1);
        expect(view.aporte[0].label).toBe('Papel (CRI)');
        expect(view.aporteSectorCount).toBe(1);
    });

    it('conta setores distintos, não fatias, quando a cauda dobra', () => {
        const sectors = ['Shoppings', 'Logística', 'Lajes Corporativas', 'Papel', 'Fiagro', 'Hotéis', 'Residencial'];
        const view = computeAporteSectorView(
            sectors.map((s, i) => line(`F${i}11`, s, 100)),
            [],
            'FII',
        );

        // 7 segmentos > MAX_SECTOR_SLICES: a cauda vira "Outros segmentos".
        expect(view.aporte.length).toBeLessThan(sectors.length);
        expect(view.aporte.some((s) => s.label === 'Outros segmentos')).toBe(true);
        expect(view.aporteSectorCount).toBe(sectors.length);
    });

    it('ignora linhas sem valor', () => {
        const view = computeAporteSectorView(
            [line('VISC11', 'Shoppings', 100), line('XPML11', 'Shoppings', 0)],
            [],
            'FII',
        );
        expect(view.aporte[0].tickers).toEqual(['VISC11']);
    });
});

describe('computeAporteSectorView — carteira depois do aporte', () => {
    const holdings = [holding('VISC11', 600, 'Shoppings'), holding('HGLG11', 400, 'Logística')];

    it('soma posição atual + compras e expõe o antes de cada fatia', () => {
        const view = computeAporteSectorView(
            [line('VISC11', 'Shoppings', 200), line('HGLG11', 'Logística', 100), line('KNCR11', 'Papel', 100)],
            holdings,
            'FII',
        );

        expect(view.currentTotal).toBe(1000);
        expect(view.afterTotal).toBe(1400);

        // 800 / 1400, 500 / 1400, 100 / 1400
        expect(pctOf(view.after, 'Shoppings')).toBeCloseTo(57.142857, 4);
        expect(pctOf(view.after, 'Logística')).toBeCloseTo(35.714286, 4);
        expect(pctOf(view.after, 'Papel (CRI)')).toBeCloseTo(7.142857, 4);

        expect(view.beforePctByKey.get('Shoppings')).toBeCloseTo(60, 5);
        expect(view.beforePctByKey.get('Logística')).toBeCloseTo(40, 5);
        // Segmento novo na carteira: existia 0% antes.
        expect(view.beforePctByKey.get('Papel (CRI)')).toBeCloseTo(0, 5);
        expect(view.afterSectorCount).toBe(3);
    });

    it('carteira sem a classe: currentTotal zero e nenhum "antes" positivo', () => {
        const view = computeAporteSectorView([line('VISC11', 'Shoppings', 200)], [], 'FII');
        expect(view.currentTotal).toBe(0);
        expect([...view.beforePctByKey.values()].every((v) => v === 0)).toBe(true);
    });

    it('holding sem setor gravado herda o setor do ranking', () => {
        const view = computeAporteSectorView(
            [line('VISC11', 'Shoppings', 100)],
            [holding('VISC11', 400, undefined)],
            'FII',
        );

        expect(view.after).toHaveLength(1);
        expect(view.after[0].label).toBe('Shoppings');
        expect(view.beforePctByKey.get('Shoppings')).toBeCloseTo(100, 5);
    });

    it('holding fora da sugestão continua pesando no depois', () => {
        // Comprar só papel não faz o shopping sumir da carteira.
        const view = computeAporteSectorView(
            [line('KNCR11', 'Papel', 100)],
            [holding('VISC11', 900, 'Shoppings')],
            'FII',
        );

        expect(pctOf(view.after, 'Shoppings')).toBeCloseTo(90, 5);
        expect(pctOf(view.after, 'Papel (CRI)')).toBeCloseTo(10, 5);
        expect(view.beforePctByKey.get('Shoppings')).toBeCloseTo(100, 5);
    });
});
