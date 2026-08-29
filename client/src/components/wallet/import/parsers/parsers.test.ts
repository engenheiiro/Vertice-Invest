import { describe, it, expect } from 'vitest';
import { parseDelimited } from './readSheet';
import { normalizeHeader, findColumn, parseNumber, parseSheetDate, parseSide, parseAssetType, looksLikeTicker, splitProductLabel } from './common';
import { parseB3Sheet } from './parseB3';
import { parseInvestidor10Paste } from './parseInvestidor10';
import { parseGenericSheet, buildTemplateCsv } from './parseGenericSheet';
import { ParseError } from '../types';

/**
 * Os parsers são a parte frágil da importação: dependem de layouts de terceiros
 * que ninguém nos garante. Estes testes fixam o comportamento que precisa
 * sobreviver a uma mudança de coluna, e o que precisa FALHAR alto em vez de
 * importar número trocado.
 */

describe('common — normalização de células', () => {
    it('compara cabeçalho ignorando acento, caixa e espaço extra', () => {
        expect(normalizeHeader('  Preço   Unitário ')).toBe('preco unitario');
        expect(normalizeHeader('Movimentação')).toBe('movimentacao');
    });

    it('casa coluna por nome, não por posição', () => {
        const headers = ['Instituição', 'Quantidade', 'Preço unitário', 'Produto'];
        expect(findColumn(headers, ['produto'])).toBe(3);
        expect(findColumn(headers, ['preco unitario'])).toBe(2);
        expect(findColumn(headers, ['coluna que nao existe'])).toBe(-1);
    });

    it('decide o separador decimal pelo ÚLTIMO separador, não por convenção fixa', () => {
        expect(parseNumber('1.234,56')).toBeCloseTo(1234.56);
        expect(parseNumber('1,234.56')).toBeCloseTo(1234.56);
        expect(parseNumber('R$ 30,50')).toBeCloseTo(30.5);
        expect(parseNumber('0,015')).toBeCloseTo(0.015);
        expect(parseNumber('')).toBe(0);
    });

    it('lê data em dd/mm/aaaa, ISO e serial do Excel', () => {
        expect(parseSheetDate('15/03/2024')).toBe('2024-03-15');
        expect(parseSheetDate('1/3/2024')).toBe('2024-03-01');
        expect(parseSheetDate('2024-03-15')).toBe('2024-03-15');
        // 45366 = 15/03/2024 na época 1899-12-30 do Excel.
        expect(parseSheetDate('45366')).toBe('2024-03-15');
    });

    it('recusa data implausível em vez de inventar uma', () => {
        expect(parseSheetDate('99/99/2024')).toBeNull();
        expect(parseSheetDate('texto')).toBeNull();
        expect(parseSheetDate('')).toBeNull();
        // Número pequeno é quantidade, não data.
        expect(parseSheetDate('100')).toBeNull();
    });

    it('reconhece o lado da operação nas grafias das duas fontes', () => {
        expect(parseSide('Compra')).toBe('BUY');
        expect(parseSide('Credito')).toBe('BUY');
        expect(parseSide('Crédito')).toBe('BUY');
        expect(parseSide('Venda')).toBe('SELL');
        expect(parseSide('Debito')).toBe('SELL');
        expect(parseSide('qualquer coisa')).toBeNull();
    });

    it('mapeia rótulos de classe escritos por humano', () => {
        expect(parseAssetType('FII')).toBe('FII');
        expect(parseAssetType('Fundo Imobiliário')).toBe('FII');
        expect(parseAssetType('Ação')).toBe('STOCK');
        expect(parseAssetType('Cripto')).toBe('CRYPTO');
        expect(parseAssetType('Exterior')).toBe('STOCK_US');
        expect(parseAssetType('')).toBeUndefined();
    });

    it('reconhece formato de ticker da B3', () => {
        expect(looksLikeTicker('PETR4')).toBe(true);
        expect(looksLikeTicker('MXRF11')).toBe(true);
        expect(looksLikeTicker('Total')).toBe(false);
        expect(looksLikeTicker('R$ 100')).toBe(false);
    });

    it('separa código e nome no rótulo de produto da B3', () => {
        expect(splitProductLabel('PETR4 - PETROLEO BRASILEIRO S.A. PETROBRAS'))
            .toEqual({ ticker: 'PETR4', name: 'PETROLEO BRASILEIRO S.A. PETROBRAS' });
        // Fracionário é o MESMO ativo do lote padrão.
        expect(splitProductLabel('MXRF11F - MAXI RENDA FDO INV IMOB').ticker).toBe('MXRF11');
        // Hífen do nome não é o separador de coluna.
        expect(splitProductLabel('SANB11 - BANCO SANTANDER-BRASIL').ticker).toBe('SANB11');
        expect(splitProductLabel('PETR4')).toEqual({ ticker: 'PETR4', name: undefined });
        expect(splitProductLabel('')).toEqual({ ticker: '' });
    });

    it('preserva o rótulo que não é código — dois títulos do Tesouro não podem virar um', () => {
        expect(splitProductLabel('Tesouro Selic 2029').ticker).toBe('TESOURO SELIC 2029');
        expect(splitProductLabel('Tesouro IPCA+ 2035').ticker).toBe('TESOURO IPCA+ 2035');
    });
});

describe('parseDelimited — CSV', () => {
    it('fareja o ponto-e-vírgula do Excel brasileiro', () => {
        // Assumir vírgula aqui partiria "1.234,56" em duas colunas.
        const grid = parseDelimited('Ticker;Quantidade;Preço\nPETR4;100;1.234,56');
        expect(grid[1]).toEqual(['PETR4', '100', '1.234,56']);
    });

    it('respeita aspas e aspas escapadas', () => {
        const grid = parseDelimited('a,b\n"tem, vírgula","aspa "" dentro"');
        expect(grid[1]).toEqual(['tem, vírgula', 'aspa " dentro']);
    });
});

describe('parseB3Sheet — extrato de Movimentação', () => {
    const movimentacao = (linhas: string[][]) => [
        ['Entrada/Saída', 'Data', 'Movimentação', 'Produto', 'Instituição', 'Quantidade', 'Preço unitário', 'Valor da Operação'],
        ...linhas,
    ];

    it('lê uma compra e uma venda de liquidação', () => {
        const { rows, source } = parseB3Sheet(movimentacao([
            ['Credito', '15/03/2024', 'Transferência - Liquidação', 'PETR4 - PETROLEO BRASILEIRO S.A.', 'CORRETORA X', '100', '30,50', '3.050,00'],
            ['Debito', '20/08/2024', 'Transferência - Liquidação', 'PETR4 - PETROLEO BRASILEIRO S.A.', 'CORRETORA X', '50', '38,10', '1.905,00'],
        ]));

        expect(source).toBe('B3_MOVIMENTACAO');
        // A coluna Produto vira ticker + nome; mandar o rótulo inteiro como
        // ticker era o que o servidor recusava com "Ticker muito longo".
        expect(rows).toEqual([
            { ticker: 'PETR4', name: 'PETROLEO BRASILEIRO S.A.', side: 'BUY', quantity: 100, price: 30.5, date: '2024-03-15', currency: 'BRL' },
            { ticker: 'PETR4', name: 'PETROLEO BRASILEIRO S.A.', side: 'SELL', quantity: 50, price: 38.1, date: '2024-08-20', currency: 'BRL' },
        ]);
    });

    it('IGNORA proventos — quem busca dividendo é o próprio Vértice', () => {
        // Importar aqui duplicaria a renda contra a ingestão de DividendEvent.
        const { rows, warnings } = parseB3Sheet(movimentacao([
            ['Credito', '15/03/2024', 'Transferência - Liquidação', 'PETR4', 'X', '100', '30,50', '3.050,00'],
            ['Credito', '01/04/2024', 'Dividendo', 'PETR4', 'X', '100', '0,85', '85,00'],
            ['Credito', '01/05/2024', 'Juros Sobre Capital Próprio', 'PETR4', 'X', '100', '0,40', '40,00'],
            ['Credito', '10/05/2024', 'Rendimento', 'MXRF11', 'X', '200', '0,10', '20,00'],
        ]));

        expect(rows).toHaveLength(1);
        expect(warnings.some((w) => /provento/i.test(w))).toBe(true);
    });

    it('IGNORA desdobramento e bonificação — não são negócios', () => {
        const { rows } = parseB3Sheet(movimentacao([
            ['Credito', '15/03/2024', 'Transferência - Liquidação', 'PETR4', 'X', '100', '30,50', '3.050,00'],
            ['Credito', '02/06/2024', 'Desdobro', 'PETR4', 'X', '100', '0,00', '0,00'],
            ['Credito', '03/06/2024', 'Bonificação em Ativos', 'PETR4', 'X', '10', '0,00', '0,00'],
        ]));

        expect(rows).toHaveLength(1);
    });

    it('deriva o preço unitário do valor total quando a coluna vem vazia', () => {
        const { rows } = parseB3Sheet(movimentacao([
            ['Credito', '15/03/2024', 'Transferência - Liquidação', 'PETR4', 'X', '100', '', '3.050,00'],
        ]));

        expect(rows[0].price).toBeCloseTo(30.5);
    });

    it('sobrevive a coluna nova inserida no meio do arquivo', () => {
        // O casamento é por nome; posição fixa quebraria aqui.
        const { rows } = parseB3Sheet([
            ['Entrada/Saída', 'Data', 'COLUNA NOVA', 'Movimentação', 'Produto', 'Quantidade', 'Preço unitário'],
            ['Credito', '15/03/2024', 'lixo', 'Transferência - Liquidação', 'VALE3', '10', '60,00'],
        ]);

        expect(rows[0]).toMatchObject({ ticker: 'VALE3', quantity: 10, price: 60 });
    });

    it('encontra o cabeçalho abaixo de linhas de título', () => {
        const { rows } = parseB3Sheet([
            ['Extrato de Movimentação'],
            ['Período: 01/01/2024 a 31/12/2024'],
            [],
            ['Entrada/Saída', 'Data', 'Movimentação', 'Produto', 'Quantidade', 'Preço unitário'],
            ['Credito', '15/03/2024', 'Transferência - Liquidação', 'VALE3', '10', '60,00'],
        ]);

        expect(rows).toHaveLength(1);
    });

    it('falha com mensagem clara quando o arquivo não é um extrato', () => {
        expect(() => parseB3Sheet([['foo', 'bar'], ['1', '2']])).toThrow(ParseError);
        expect(() => parseB3Sheet([['foo', 'bar'], ['1', '2']])).toThrow(/extrato da B3/);
    });

    it('falha quando o extrato é válido mas não tem negócio nenhum', () => {
        expect(() => parseB3Sheet(movimentacao([
            ['Credito', '01/04/2024', 'Dividendo', 'PETR4', 'X', '100', '0,85', '85,00'],
        ]))).toThrow(/nenhuma compra ou venda/);
    });
});

describe('parseB3Sheet — extrato de Negociação', () => {
    it('usa Tipo de Movimentação como lado e detecta a fonte', () => {
        const { rows, source } = parseB3Sheet([
            ['Data do Negócio', 'Tipo de Movimentação', 'Mercado', 'Instituição', 'Código de Negociação', 'Quantidade', 'Preço', 'Valor'],
            ['15/03/2024', 'Compra', 'Mercado à Vista', 'CORRETORA X', 'PETR4', '100', '30,50', '3.050,00'],
            ['20/08/2024', 'Venda', 'Mercado à Vista', 'CORRETORA X', 'PETR4', '50', '38,10', '1.905,00'],
        ]);

        expect(source).toBe('B3_NEGOCIACAO');
        expect(rows.map((r) => r.side)).toEqual(['BUY', 'SELL']);
        expect(rows[0].ticker).toBe('PETR4');
    });
});

describe('parseInvestidor10Paste — colagem da carteira', () => {
    const DATA = '2023-03-01';

    it('lê a tabela colada com cabeçalho', () => {
        const texto = [
            'Ativo\tQuantidade\tPreço Médio\tValor Atual',
            'PETR4\t100\tR$ 30,50\tR$ 3.800,00',
            'MXRF11\t200\tR$ 10,45\tR$ 2.100,00',
        ].join('\n');

        const { rows } = parseInvestidor10Paste(texto, DATA);

        expect(rows).toEqual([
            { ticker: 'PETR4', type: undefined, side: 'BUY', quantity: 100, price: 30.5, date: DATA, currency: 'BRL' },
            { ticker: 'MXRF11', type: undefined, side: 'BUY', quantity: 200, price: 10.45, date: DATA, currency: 'BRL' },
        ]);
    });

    it('aproveita a coluna de classe quando ela existe', () => {
        const texto = [
            'Ativo\tTipo\tQuantidade\tPreço Médio',
            'MXRF11\tFII\t200\t10,45',
        ].join('\n');

        expect(parseInvestidor10Paste(texto, DATA).rows[0].type).toBe('FII');
    });

    it('deriva o preço médio do valor aplicado quando não há coluna de PM', () => {
        const texto = [
            'Ativo\tQuantidade\tValor Aplicado',
            'PETR4\t100\t3.050,00',
        ].join('\n');

        expect(parseInvestidor10Paste(texto, DATA).rows[0].price).toBeCloseTo(30.5);
    });

    it('cai na leitura por formato quando não há cabeçalho reconhecível', () => {
        // É o que faz a colagem sobreviver a um redesenho da tela deles.
        const texto = [
            'PETR4  100  30,50  3.800,00',
            'MXRF11  200  10,45  2.100,00',
        ].join('\n');

        const { rows, warnings } = parseInvestidor10Paste(texto, DATA);

        expect(rows.map((r) => r.ticker)).toEqual(['PETR4', 'MXRF11']);
        expect(rows[0].quantity).toBe(100);
        expect(rows[0].price).toBeCloseTo(30.5);
        expect(warnings.some((w) => /pelo formato/i.test(w))).toBe(true);
    });

    it('descarta linhas de total e rodapé arrastadas na cópia', () => {
        const texto = [
            'Ativo\tQuantidade\tPreço Médio',
            'PETR4\t100\t30,50',
            'Total\t\tR$ 5.900,00',
            'Mostrando 1 de 1 página',
        ].join('\n');

        expect(parseInvestidor10Paste(texto, DATA).rows).toHaveLength(1);
    });

    it('avisa SEMPRE que a fonte não tem datas de compra', () => {
        const texto = 'Ativo\tQuantidade\tPreço Médio\nPETR4\t100\t30,50';
        const { warnings } = parseInvestidor10Paste(texto, DATA);
        expect(warnings.some((w) => /datas de compra/i.test(w))).toBe(true);
    });

    it('aplica a data de início informada em todas as linhas', () => {
        const texto = 'Ativo\tQuantidade\tPreço Médio\nPETR4\t100\t30,50\nVALE3\t50\t60,00';
        const { rows } = parseInvestidor10Paste(texto, DATA);
        expect(rows.every((r) => r.date === DATA)).toBe(true);
    });

    it('falha com mensagem útil quando nada foi colado ou nada é ativo', () => {
        expect(() => parseInvestidor10Paste('', DATA)).toThrow(/Nada foi colado/);
        expect(() => parseInvestidor10Paste('texto qualquer\nsem ativo nenhum', DATA)).toThrow(/nenhum ativo/);
    });
});

describe('parseGenericSheet — planilha modelo', () => {
    const modelo = (linhas: string[][]) => [
        ['Ticker', 'Classe', 'Operação', 'Quantidade', 'Preço', 'Data', 'Moeda'],
        ...linhas,
    ];

    it('lê compra e venda com classe e moeda', () => {
        const { rows } = parseGenericSheet(modelo([
            ['PETR4', 'Ação', 'Compra', '100', '30,50', '15/03/2024', 'BRL'],
            ['AAPL', 'Exterior', 'Compra', '5', '180.25', '10/05/2024', 'USD'],
            ['PETR4', 'Ação', 'Venda', '50', '38,10', '12/08/2024', 'BRL'],
        ]));

        expect(rows).toEqual([
            { ticker: 'PETR4', type: 'STOCK', side: 'BUY', quantity: 100, price: 30.5, date: '2024-03-15', currency: 'BRL' },
            { ticker: 'AAPL', type: 'STOCK_US', side: 'BUY', quantity: 5, price: 180.25, date: '2024-05-10', currency: 'USD' },
            { ticker: 'PETR4', type: 'STOCK', side: 'SELL', quantity: 50, price: 38.1, date: '2024-08-12', currency: 'BRL' },
        ]);
    });

    it('trata linha sem coluna de operação como compra', () => {
        const { rows } = parseGenericSheet([
            ['Ticker', 'Quantidade', 'Preço', 'Data'],
            ['PETR4', '100', '30,50', '15/03/2024'],
        ]);

        expect(rows[0].side).toBe('BUY');
    });

    it('pula linha sem data válida e avisa quantas foram', () => {
        const { rows, warnings } = parseGenericSheet(modelo([
            ['PETR4', 'Ação', 'Compra', '100', '30,50', '15/03/2024', 'BRL'],
            ['VALE3', 'Ação', 'Compra', '50', '60,00', '', 'BRL'],
        ]));

        expect(rows).toHaveLength(1);
        expect(warnings[0]).toMatch(/1 linha\(s\) foram puladas/);
    });

    it('aceita as colunas em qualquer ordem', () => {
        const { rows } = parseGenericSheet([
            ['Data', 'Preço', 'Ticker', 'Quantidade'],
            ['15/03/2024', '30,50', 'PETR4', '100'],
        ]);

        expect(rows[0]).toMatchObject({ ticker: 'PETR4', quantity: 100, price: 30.5, date: '2024-03-15' });
    });

    it('exige as colunas obrigatórias em vez de adivinhar', () => {
        expect(() => parseGenericSheet([['Nome', 'Valor'], ['x', '1']])).toThrow(/colunas obrigatórias/);
    });
});

describe('planilha modelo — o arquivo que o usuário baixa', () => {
    it('é lido de volta pelo próprio parser (ida e volta)', () => {
        // O modelo que entregamos tem que passar pela nossa própria régua.
        const { rows } = parseGenericSheet(parseDelimited(buildTemplateCsv()));
        expect(rows).toHaveLength(5);
        expect(rows.map((r) => r.ticker)).toEqual(['PETR4', 'MXRF11', 'AAPL', 'BTC', 'PETR4']);
        expect(rows[3].quantity).toBeCloseTo(0.015);
        expect(rows[4].side).toBe('SELL');
    });

    it('sai com BOM e ponto-e-vírgula para o Excel em português', () => {
        const csv = buildTemplateCsv();
        expect(csv.charCodeAt(0)).toBe(0xfeff);
        expect(csv.split('\r\n')[0]).toBe('\ufeffTicker;Classe;Operação;Quantidade;Preço;Data;Moeda');
    });
});
