import { describe, expect, it } from 'vitest';
import type { Asset } from '../contexts/WalletContext';
import { B3_SECTOR_BY_BASE } from '../data/b3Sectors';
import {
    ETF_SECTOR_LABEL,
    SECTOR_COLORS,
    SECTOR_MUTED_COLOR,
    UNKNOWN_SECTOR_LABEL,
    computeSectorAllocation,
    fiiSectorLabel,
    stockSectorLabel,
    stockSubsectorLabel,
} from './sectorAllocation';

const holding = (ticker: string, totalValue: number, sector?: string, type = 'FII'): Asset => ({
    id: ticker,
    ticker,
    type,
    quantity: 1,
    averagePrice: totalValue,
    currentPrice: totalValue,
    totalValue,
    totalCost: totalValue,
    profit: 0,
    profitPercent: 0,
    currency: 'BRL',
    sector,
} as unknown as Asset);

const fii = (ticker: string, totalValue: number, sector?: string) => holding(ticker, totalValue, sector, 'FII');
const stock = (ticker: string, totalValue: number, sector?: string) => holding(ticker, totalValue, sector, 'STOCK');

describe('fiiSectorLabel', () => {
    it('normaliza acento, caixa e sinônimos do Fundamentus', () => {
        expect(fiiSectorLabel('Títulos e Val. Mob.')).toBe('Papel (CRI)');
        expect(fiiSectorLabel('LOGÍSTICA')).toBe('Logística');
        expect(fiiSectorLabel('Lajes  Corporativas')).toBe('Lajes Corporativas');
        expect(fiiSectorLabel('Agências de Bancos')).toBe('Renda Urbana');
    });

    it('preserva segmento fora do canon em vez de colapsar em "Outros"', () => {
        expect(fiiSectorLabel('Data Centers')).toBe('Data Centers');
    });

    it('trata segmento ausente como não classificado', () => {
        expect(fiiSectorLabel(undefined)).toBe(UNKNOWN_SECTOR_LABEL);
        expect(fiiSectorLabel('   ')).toBe(UNKNOWN_SECTOR_LABEL);
    });
});

describe('stockSectorLabel', () => {
    it('agrupa setores correlacionados no mesmo macro-setor', () => {
        expect(stockSectorLabel(stock('ITUB4', 1, 'Bancos'))).toBe('Financeiro');
        expect(stockSectorLabel(stock('BBSE3', 1, 'Seguros'))).toBe('Financeiro');
        expect(stockSectorLabel(stock('TAEE11', 1, 'Energia Elétrica'))).toBe('Utilidade Pública');
        expect(stockSectorLabel(stock('VALE3', 1, 'Mineração'))).toBe('Commodities');
    });

    it('desambigua "Papel" (recebíveis) de "Papel e Celulose" (commodity)', () => {
        expect(stockSectorLabel(stock('X', 1, 'Papel'))).toBe('Financeiro');
        expect(stockSectorLabel(stock('KLBN11', 1, 'Papel e Celulose'))).toBe('Commodities');
    });

    it('entende setor em inglês vindo do Yahoo', () => {
        expect(stockSectorLabel(stock('X', 1, 'Consumer Cyclical'))).toBe('Consumo');
        expect(stockSectorLabel(stock('Y', 1, 'Basic Materials'))).toBe('Commodities');
    });

    it('não força um ETF de índice dentro de um setor', () => {
        expect(stockSectorLabel(holding('BOVA11', 1, 'Índice Amplo', 'ETF'))).toBe(ETF_SECTOR_LABEL);
    });

    it('cai em não classificado quando o setor é desconhecido ou ausente', () => {
        expect(stockSectorLabel(stock('X', 1))).toBe(UNKNOWN_SECTOR_LABEL);
        expect(stockSectorLabel(stock('X', 1, 'Setor Inexistente'))).toBe(UNKNOWN_SECTOR_LABEL);
    });

    it('conhece o vocabulário novo do lote de agosto/2026', () => {
        // O espelho do MACRO_SECTORS do servidor: sem estas entradas, quem tem
        // WHRL4 ou MOAR3 na carteira vê a posição em 'Não classificado'.
        expect(stockSectorLabel(stock('WHRL4', 1, 'Utilidades Domésticas'))).toBe('Consumo');
        expect(stockSectorLabel(stock('BOBR4', 1, 'Produtos de Limpeza'))).toBe('Consumo');
        expect(stockSectorLabel(stock('HOOT4', 1, 'Hotelaria'))).toBe('Consumo');
        expect(stockSectorLabel(stock('MOAR3', 1, 'Holdings Diversificadas'))).toBe('Financeiro');
    });
});

describe('stockSubsectorLabel — granularidade das listas de seleção', () => {
    it('mantém o setor do ATIVO em vez de colapsar no macro-setor', () => {
        // A leitura que a Carteira faz (banco + seguradora = 'Financeiro') é a
        // certa para risco sistêmico e a errada para reconhecer o ativo na lista.
        expect(stockSubsectorLabel(stock('ITUB4', 1, 'Bancos'))).toBe('Bancos');
        expect(stockSubsectorLabel(stock('BBSE3', 1, 'Seguros'))).toBe('Seguros');
    });

    it('separa energia elétrica de saneamento — os dois eram Utilidade Pública', () => {
        expect(stockSubsectorLabel(stock('CPFE3', 1, 'Elétricas'))).toBe('Energia Elétrica');
        expect(stockSubsectorLabel(stock('TAEE11', 1, 'Energia Elétrica'))).toBe('Energia Elétrica');
        expect(stockSubsectorLabel(stock('SAPR11', 1, 'Saneamento'))).toBe('Saneamento Básico');
    });

    it('telefonia não é Tecnologia', () => {
        expect(stockSubsectorLabel(stock('VIVT3', 1, 'Telecom'))).toBe('Telecomunicações');
    });

    it('junta sinônimos da mesma coisa, sem inventar balde novo', () => {
        expect(stockSubsectorLabel(stock('AGRO3', 1, 'Agro'))).toBe('Agronegócio');
        expect(stockSubsectorLabel(stock('SLCE3', 1, 'Agropecuária'))).toBe('Agronegócio');
        expect(stockSubsectorLabel(stock('PETR4', 1, 'Petróleo'))).toBe('Petróleo e Gás');
    });

    it('setor desconhecido preserva o texto da fonte em vez de sumir', () => {
        // 'Não classificado' aqui seria pior que o nome real: um setor novo do
        // Fundamentus apareceria como buraco cinza na primeira apuração.
        expect(stockSubsectorLabel(stock('X', 1, 'Setor Inexistente'))).toBe('Setor Inexistente');
    });

    it('"Outros" e vazio continuam não classificados', () => {
        // 'Outros' é o default do resolver quando não se sabe o setor — deixá-lo
        // passar criaria uma fatia que se confunde com a dobra da cauda.
        expect(stockSubsectorLabel(stock('X', 1, 'Outros'))).toBe(UNKNOWN_SECTOR_LABEL);
        expect(stockSubsectorLabel(stock('X', 1))).toBe(UNKNOWN_SECTOR_LABEL);
    });

    it('setor em inglês cai no macro traduzido, não no texto cru', () => {
        expect(stockSubsectorLabel(stock('AAPL', 1, 'Technology'))).toBe('Tecnologia');
    });

    it('ETF de índice segue fora de qualquer setor', () => {
        expect(stockSubsectorLabel(holding('BOVA11', 1, 'Índice Amplo', 'ETF'))).toBe(ETF_SECTOR_LABEL);
    });
});

describe('todo setor exibível tem casa no donut', () => {
    // A invariante que impede a divergência de voltar: se a linha consegue exibir
    // um setor, a agregação PRECISA saber em que fatia colocá-lo. Um rótulo novo
    // que não case com nenhum macro-setor cai aqui, e não na tela do usuário.
    it('nenhum setor do fallback por ticker cai em "Não classificado"', () => {
        const orfaos = Object.entries(B3_SECTOR_BY_BASE)
            .filter(([, setor]) => stockSectorLabel({ sector: setor, type: 'STOCK' }) === UNKNOWN_SECTOR_LABEL)
            .map(([base, setor]) => `${base} (${setor})`);
        expect(orfaos).toEqual([]);
    });

    it('o fallback por ticker alimenta a AGREGAÇÃO, não só a sublinha', () => {
        // KLBN4 sem setor no banco: a linha sempre soube dizer "Papel e Celulose"
        // pelo ticker. Enquanto o donut não sabia, o mesmo ativo aparecia com setor
        // na lista e como "Não classificado" na fatia ao lado.
        expect(stockSubsectorLabel({ ticker: 'KLBN4', sector: '', type: 'STOCK' })).toBe('Papel e Celulose');
        const [slice] = computeSectorAllocation(
            [{ ticker: 'KLBN4', sector: '', type: 'STOCK', totalValue: 1000 }],
            'STOCK',
        );
        expect(slice.label).toBe('Commodities');
    });

    it('setor genérico do backend não vira rótulo — nem na linha, nem na fatia', () => {
        expect(stockSubsectorLabel({ ticker: 'XPTO3', sector: 'Outros', type: 'STOCK' })).toBe(UNKNOWN_SECTOR_LABEL);
        expect(stockSectorLabel({ ticker: 'XPTO3', sector: 'Outros', type: 'STOCK' })).toBe(UNKNOWN_SECTOR_LABEL);
    });
});

describe('computeSectorAllocation — FII', () => {
    it('agrega por segmento, ordena por saldo e soma 100%', () => {
        const slices = computeSectorAllocation([
            fii('HGLG11', 300, 'Logística'),
            fii('XPLG11', 100, 'Imóveis Industriais e Logísticos'),
            fii('VISC11', 600, 'Shoppings'),
        ], 'FII');

        expect(slices.map((s) => [s.label, s.value, s.tickers])).toEqual([
            ['Shoppings', 600, ['VISC11']],
            ['Logística', 400, ['HGLG11', 'XPLG11']],
        ]);
        expect(slices.map((s) => s.pct)).toEqual([60, 40]);
        expect(slices.map((s) => s.color)).toEqual([SECTOR_COLORS[0], SECTOR_COLORS[1]]);
    });

    it('ignora saldo zerado/negativo e carteira sem posição', () => {
        expect(computeSectorAllocation([], 'FII')).toEqual([]);
        expect(computeSectorAllocation([fii('KNCR11', 0, 'Papel')], 'FII')).toEqual([]);
    });

    it('joga o não classificado para o fim, em cinza, sem gastar cor de setor real', () => {
        const slices = computeSectorAllocation([
            fii('SEM11', 900),
            fii('VISC11', 100, 'Shoppings'),
        ], 'FII');

        expect(slices.map((s) => s.label)).toEqual(['Shoppings', UNKNOWN_SECTOR_LABEL]);
        expect(slices[0].color).toBe(SECTOR_COLORS[0]);
        expect(slices[1].color).toBe(SECTOR_MUTED_COLOR);
    });

    it('dobra a cauda em "Outros segmentos" acima do teto de fatias', () => {
        const slices = computeSectorAllocation([
            fii('A11', 100, 'Shoppings'),
            fii('B11', 90, 'Logística'),
            fii('C11', 80, 'Lajes Corporativas'),
            fii('D11', 70, 'Papel'),
            fii('E11', 60, 'Fiagro'),
            fii('F11', 50, 'Hotéis'),
            fii('G11', 40, 'Residencial'),
            fii('H11', 10),
        ], 'FII');

        expect(slices).toHaveLength(6);
        expect(slices[5].label).toBe('Outros segmentos');
        // Hotéis + Residencial + não classificado.
        expect(slices[5].value).toBe(100);
        expect(slices[5].tickers).toEqual(['F11', 'G11', 'H11']);
        expect(slices[5].color).toBe(SECTOR_MUTED_COLOR);
        expect(slices.reduce((acc, s) => acc + s.pct, 0)).toBeCloseTo(100, 10);
    });
});

describe('computeSectorAllocation — Ações', () => {
    it('junta bancos e seguros num único macro-setor', () => {
        const slices = computeSectorAllocation([
            stock('ITUB4', 300, 'Bancos'),
            stock('BBSE3', 200, 'Seguros'),
            stock('TAEE11', 500, 'Energia Elétrica'),
        ], 'STOCK');

        // Empate em saldo desempata pelo rótulo, não pela ordem que a API devolveu.
        expect(slices.map((s) => [s.label, s.pct])).toEqual([
            ['Financeiro', 50],
            ['Utilidade Pública', 50],
        ]);
        expect(slices[0].tickers).toEqual(['ITUB4', 'BBSE3']);
    });

    it('separa ETFs de índice das ações individuais', () => {
        const slices = computeSectorAllocation([
            stock('PETR4', 400, 'Petróleo, Gás e Biocombustíveis'),
            holding('BOVA11', 600, 'Índice Amplo', 'ETF'),
        ], 'STOCK');

        expect(slices.map((s) => [s.label, s.pct])).toEqual([
            [ETF_SECTOR_LABEL, 60],
            ['Commodities', 40],
        ]);
    });

    it('dobra a cauda em "Outros setores" acima do teto de fatias', () => {
        const slices = computeSectorAllocation([
            stock('A3', 100, 'Bancos'),
            stock('B3', 90, 'Energia Elétrica'),
            stock('C3', 80, 'Mineração'),
            stock('D3', 70, 'Varejo'),
            stock('E3', 60, 'Bens Industriais'),
            stock('F3', 50, 'Tecnologia'),
            stock('G3', 40, 'Saúde'),
        ], 'STOCK');

        expect(slices).toHaveLength(6);
        expect(slices[5].label).toBe('Outros setores');
        expect(slices[5].value).toBe(90);
        expect(slices[5].tickers).toEqual(['F3', 'G3']);
    });
});

describe('computeSectorAllocation — Renda Fixa', () => {
    const rf = (ticker: string, totalValue: number, extra: Record<string, unknown>): Asset => ({
        ...holding(ticker, totalValue, undefined, 'FIXED_INCOME'),
        ...extra,
    } as unknown as Asset);

    it('reparte por indexador — o eixo de risco da classe', () => {
        const slices = computeSectorAllocation([
            rf('TESOURO IPCA+ 2035', 500, { fixedIncomeIndex: 'IPCA' }),
            rf('TESOURO SELIC 2029', 300, { fixedIncomeIndex: 'SELIC' }),
            rf('TESOURO PREFIXADO 2027', 200, { fixedIncomeIndex: 'PRE' }),
        ], 'FIXED_INCOME');

        expect(slices.map((s) => [s.label, s.pct])).toEqual([
            ['IPCA', 50],
            ['Pós-fixado', 30],
            ['Prefixado', 20],
        ]);
    });

    it('junta Selic e CDI num único balde pós-fixado', () => {
        const slices = computeSectorAllocation([
            rf('TESOURO SELIC 2029', 500, { fixedIncomeIndex: 'SELIC' }),
            rf('CDB BANCO X', 500, { fixedIncomeIndex: 'CDI' }),
        ], 'FIXED_INCOME');

        expect(slices).toHaveLength(1);
        expect(slices[0].label).toBe('Pós-fixado');
        expect(slices[0].tickers).toEqual(['TESOURO SELIC 2029', 'CDB BANCO X']);
    });

    // A régua é a de `fixedIncomeSubKey`: um "110% do CDI" cadastrado sem índice é
    // pós-fixado, não prefixado — do mesmo jeito que o accrual o remunera.
    it('classifica o legado sem índice pela mesma convenção do accrual', () => {
        const slices = computeSectorAllocation([
            rf('CDB LEGADO', 600, { fixedIncomeRate: 110 }),
            rf('LCI LEGADO', 400, { fixedIncomeRate: 12 }),
        ], 'FIXED_INCOME');

        expect(slices.map((s) => [s.label, s.pct])).toEqual([
            ['Pós-fixado', 60],
            ['Prefixado', 40],
        ]);
    });
});
