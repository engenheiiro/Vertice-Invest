import type { Asset, AssetType } from '../contexts/WalletContext';
import { computeSectorAllocation, sectorLabelFor, type SectorAllocationInput, type SectorKind, type SectorSlice } from './sectorAllocation';

// ---------------------------------------------------------------------------
// Leitura SETORIAL do Aporte Inteligente.
//
// A sugestão de compra é uma lista de tickers e valores — ela não diz nada sobre
// o risco que o usuário está comprando. Duas sugestões de mesmo valor podem ser
// 6 FIIs de papel (um único risco de crédito) ou 6 segmentos distintos. Por isso
// o aporte é repartido pela MESMA chave de concentração usada pelo backend
// (`sectorAllocation`), e não por um agrupamento próprio: o que a UI mostra é o
// mesmo balde que o draft usa para limitar concentração.
//
// Duas perguntas, dois recortes:
//   1. "o aporte em si está diversificado?"  → repartição das compras;
//   2. "e a minha carteira, como fica?"       → posição atual + compras.
//
// (2) é a que decide de fato: um aporte perfeitamente repartido ainda pode
// agravar a concentração de quem já tem 70% em shoppings.
// ---------------------------------------------------------------------------

/** Uma linha da sugestão de compra (ticker + setor do ranking + valor alocado). */
export interface AporteLine {
    ticker: string;
    sector?: string;
    type?: AssetType | string;
    /** Valor da compra sugerida, na moeda da classe. */
    cost: number;
}

export interface AporteSectorView {
    /** Repartição do próprio aporte por setor. */
    aporte: SectorSlice[];
    /** Cor da fatia por ticker — liga cada linha da sugestão ao donut. */
    colorByTicker: Map<string, string>;
    /** Repartição da classe na carteira DEPOIS do aporte. */
    after: SectorSlice[];
    /**
     * % da MESMA fatia antes do aporte. Casado por ticker (não por rótulo) para
     * que a dobra "Outros" do depois some exatamente os mesmos ativos no antes —
     * comparar rótulo com rótulo daria percentuais de conjuntos diferentes.
     */
    beforePctByKey: Map<string, number>;
    /** Saldo da classe na carteira hoje (0 = usuário ainda não tem a classe). */
    currentTotal: number;
    /** Saldo da classe depois do aporte. */
    afterTotal: number;
    /**
     * Setores DISTINTOS antes da dobra. `aporte.length` é o nº de fatias — com mais
     * de MAX_SECTOR_SLICES a cauda vira uma só, e usar o nº de fatias como "quantos
     * setores" contaria menos do que o usuário está comprando de fato.
     */
    aporteSectorCount: number;
    afterSectorCount: number;
    /** Rótulo do setor por ticker do aporte — o mesmo usado nas fatias. */
    labelByTicker: Map<string, string>;
}

const positive = (n: unknown): number => {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? v : 0;
};

/**
 * Monta os dois recortes setoriais a partir da sugestão e das posições atuais
 * da MESMA classe (o chamador filtra a classe — misturar FII com ação num donut
 * de segmento não teria significado).
 */
export const computeAporteSectorView = (
    lines: AporteLine[],
    holdings: Pick<Asset, 'ticker' | 'sector' | 'type' | 'totalValue'>[],
    kind: SectorKind,
): AporteSectorView => {
    const buys = (lines || []).filter((l) => positive(l.cost) > 0);

    const buyRows: SectorAllocationInput[] = buys.map((l) => ({
        ticker: l.ticker,
        sector: l.sector,
        type: l.type as AssetType | undefined,
        totalValue: positive(l.cost),
    }));

    const aporte = computeSectorAllocation(buyRows, kind);

    const labelByTicker = new Map<string, string>();
    buyRows.forEach((row) => labelByTicker.set(row.ticker, sectorLabelFor(row, kind)));
    const aporteSectorCount = new Set(labelByTicker.values()).size;

    const colorByTicker = new Map<string, string>();
    aporte.forEach((slice) => slice.tickers.forEach((t) => colorByTicker.set(t, slice.color)));

    // Posição atual por ticker — base do "antes" e ponto de partida do "depois".
    const beforeByTicker = new Map<string, number>();
    const merged = new Map<string, SectorAllocationInput>();
    (holdings || []).forEach((h) => {
        const value = positive(h.totalValue);
        if (value <= 0) return;
        beforeByTicker.set(h.ticker, (beforeByTicker.get(h.ticker) || 0) + value);
        const current = merged.get(h.ticker);
        merged.set(h.ticker, {
            ticker: h.ticker,
            sector: current?.sector || h.sector,
            type: current?.type || h.type,
            totalValue: (current?.totalValue || 0) + value,
        });
    });

    const currentTotal = [...beforeByTicker.values()].reduce((acc, v) => acc + v, 0);

    buys.forEach((l) => {
        const current = merged.get(l.ticker);
        merged.set(l.ticker, {
            // Ativo novo herda o setor do ranking; ativo já em carteira mantém o da
            // posição, com o ranking cobrindo o caso de holding sem setor gravado.
            ticker: l.ticker,
            sector: current?.sector || l.sector,
            type: (current?.type || l.type) as AssetType | undefined,
            totalValue: (current?.totalValue || 0) + positive(l.cost),
        });
    });

    const mergedRows = [...merged.values()];
    const after = computeSectorAllocation(mergedRows, kind);
    const afterTotal = mergedRows.reduce((acc, m) => acc + m.totalValue, 0);
    const afterSectorCount = new Set(mergedRows.map((row) => sectorLabelFor(row, kind))).size;

    const beforePctByKey = new Map<string, number>();
    after.forEach((slice) => {
        const value = slice.tickers.reduce((acc, t) => acc + (beforeByTicker.get(t) || 0), 0);
        beforePctByKey.set(slice.key, currentTotal > 0 ? (value / currentTotal) * 100 : 0);
    });

    return {
        aporte,
        colorByTicker,
        after,
        beforePctByKey,
        currentTotal,
        afterTotal,
        aporteSectorCount,
        afterSectorCount,
        labelByTicker,
    };
};
