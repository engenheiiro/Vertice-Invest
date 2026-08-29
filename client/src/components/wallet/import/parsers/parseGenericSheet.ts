import { ParseError, type ImportRow, type ParseResult } from '../types';
import { findColumn, locateHeaderRow, parseAssetType, parseNumber, parseSheetDate, parseSide } from './common';

/**
 * Planilha modelo do Vértice.
 *
 * É a rede de segurança das outras duas portas: cripto e ativos no exterior não
 * passam pela B3, e quem já mantinha a própria planilha não precisa colar nada
 * de lugar nenhum. Como o formato é NOSSO, aqui podemos exigir as colunas certas
 * em vez de adivinhar — mas ainda casamos por nome, porque o usuário vai editar
 * o arquivo no Excel e reordenar coluna é a primeira coisa que se faz.
 */

const COL = {
    ticker: ['ticker', 'ativo', 'codigo', 'código', 'papel'],
    classe: ['classe', 'tipo', 'categoria'],
    operacao: ['operacao', 'operação', 'tipo de operacao', 'compra/venda', 'lado'],
    quantidade: ['quantidade', 'qtd', 'qtde', 'cotas'],
    preco: ['preco', 'preço', 'preco unitario', 'preço unitário', 'preco medio', 'preço médio'],
    data: ['data', 'data da operacao', 'data da operação'],
    moeda: ['moeda', 'currency'],
};

/** Cabeçalho da planilha modelo que o usuário baixa. */
export const TEMPLATE_HEADERS = ['Ticker', 'Classe', 'Operação', 'Quantidade', 'Preço', 'Data', 'Moeda'];

/**
 * Conteúdo do arquivo modelo oferecido para download.
 *
 * Separador `;` de propósito: é o que o Excel em português usa por padrão, e um
 * CSV com vírgula abre como coluna única na máquina do usuário brasileiro.
 * BOM no início pelo mesmo motivo — sem ele o Excel come os acentos.
 */
export const buildTemplateCsv = (): string => {
    const exemplos = [
        ['PETR4', 'Ação', 'Compra', '100', '30,50', '15/03/2024', 'BRL'],
        ['MXRF11', 'FII', 'Compra', '200', '10,45', '20/04/2024', 'BRL'],
        ['AAPL', 'Exterior', 'Compra', '5', '180.25', '10/05/2024', 'USD'],
        ['BTC', 'Cripto', 'Compra', '0,015', '350000', '01/06/2024', 'BRL'],
        ['PETR4', 'Ação', 'Venda', '50', '38,10', '12/08/2024', 'BRL'],
    ];
    const linhas = [TEMPLATE_HEADERS, ...exemplos].map((l) => l.join(';'));
    return `\ufeff${linhas.join('\r\n')}\r\n`;
};

export const parseGenericSheet = (grid: string[][]): ParseResult => {
    const headerRow = locateHeaderRow(grid, [COL.ticker, COL.quantidade, COL.preco]);
    if (headerRow === -1) {
        throw new ParseError(
            'Não encontrei as colunas obrigatórias (Ticker, Quantidade e Preço). Baixe a planilha modelo e use o mesmo cabeçalho.'
        );
    }

    const headers = grid[headerRow];
    const idx = {
        ticker: findColumn(headers, COL.ticker),
        classe: findColumn(headers, COL.classe),
        operacao: findColumn(headers, COL.operacao),
        quantidade: findColumn(headers, COL.quantidade),
        preco: findColumn(headers, COL.preco),
        data: findColumn(headers, COL.data),
        moeda: findColumn(headers, COL.moeda),
    };

    const rows: ImportRow[] = [];
    const warnings: string[] = [];
    let semData = 0;

    for (let i = headerRow + 1; i < grid.length; i += 1) {
        const line = grid[i];
        if (!line || line.every((cell) => !cell)) continue;

        const at = (index: number) => (index === -1 ? '' : (line[index] ?? ''));

        const ticker = at(idx.ticker).trim().toUpperCase();
        if (!ticker) continue;

        const quantity = parseNumber(at(idx.quantidade));
        const price = parseNumber(at(idx.preco));
        if (!(quantity > 0)) continue;

        const date = parseSheetDate(at(idx.data));
        if (!date) { semData += 1; continue; }

        const moeda = at(idx.moeda).trim().toUpperCase();

        rows.push({
            ticker,
            type: parseAssetType(at(idx.classe)),
            // Sem coluna de operação, a linha é uma compra — é o caso esmagador
            // numa planilha de carteira, e a venda é sempre explícita.
            side: parseSide(at(idx.operacao)) ?? 'BUY',
            quantity,
            price,
            date,
            currency: moeda === 'USD' ? 'USD' : 'BRL',
        });
    }

    if (rows.length === 0) {
        throw new ParseError('A planilha foi lida, mas nenhuma linha tinha ticker, quantidade e data válidos.');
    }

    if (semData > 0) {
        warnings.push(`${semData} linha(s) foram puladas por não ter data válida (use dd/mm/aaaa).`);
    }

    return { rows, warnings, source: 'SHEET' };
};
