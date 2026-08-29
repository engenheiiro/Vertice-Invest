import { ParseError, type ImportRow, type ParseResult } from '../types';
import { findColumn, looksLikeTicker, parseAssetType, parseNumber } from './common';

/**
 * Colagem da tabela de carteira do Investidor10.
 *
 * ## Por que colar, e não exportar
 *
 * O Investidor10 não tem porta de saída: sem API pública, sem link público de
 * carteira, e a exportação para Excel foi removida na versão nova do
 * gerenciador. O suporte deles confirma que não importam nem exportam planilha.
 * Sobrou o que o navegador sempre permite: selecionar a tabela e copiar.
 *
 * ## O que essa fonte NÃO traz
 *
 * A tabela mostra a POSIÇÃO (ticker, quantidade, preço médio), não o histórico
 * de negócios. Não há datas de compra. Por isso o chamador informa uma data de
 * início única para a carteira, e todos os lançamentos entram como uma compra
 * nessa data pelo preço médio. O patrimônio e o lucro/prejuízo acumulado ficam
 * corretos; a curva de evolução antes dessa data não existe, e a tela avisa isso.
 *
 * Quem quiser a rentabilidade histórica de verdade usa o extrato da B3.
 *
 * ## Por que o parser é tolerante a ponto de ter um plano B
 *
 * Não temos contrato nenhum com o layout deles — eles podem renomear colunas
 * amanhã sem avisar. Então tentamos primeiro casar cabeçalho por nome e, se não
 * houver cabeçalho reconhecível, caímos numa leitura posicional guiada pelo
 * formato do ticker. Um dos dois costuma funcionar.
 */

const COL = {
    ticker: ['ativo', 'ticker', 'codigo', 'código', 'papel'],
    quantidade: ['quantidade', 'saldo', 'qtd', 'qtde', 'cotas', 'quantidade total'],
    precoMedio: ['preco medio', 'preço médio', 'pm', 'preco medio de compra', 'preço médio de compra'],
    classe: ['tipo', 'classe', 'categoria'],
    total: ['valor aplicado', 'total aplicado', 'valor investido', 'custo total'],
};

/** Quebra a colagem em células: tabulação (cópia de tabela) ou 2+ espaços. */
const splitCells = (line: string): string[] => {
    if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
    return line.split(/\s{2,}/).map((c) => c.trim());
};

/**
 * Plano B: lê a linha pelo FORMATO em vez do cabeçalho.
 *
 * A regra é o que sobrevive a qualquer redesenho da tela deles: o primeiro token
 * que parece um código de negociação é o ticker, e os números da linha, em
 * ordem, são quantidade e preço médio. Só aceita a linha quando os dois números
 * fazem sentido — o resto é descartado em silêncio, porque uma colagem sempre
 * arrasta cabeçalho, rodapé e totais junto.
 */
const parsePositionally = (cells: string[]): ImportRow | null => {
    const tickerCell = cells.find((cell) => looksLikeTicker(cell.split(/\s+/)[0]));
    if (!tickerCell) return null;

    const ticker = tickerCell.split(/\s+/)[0].toUpperCase();

    const numbers = cells
        .filter((cell) => cell !== tickerCell)
        .map(parseNumber)
        .filter((n) => Number.isFinite(n) && n > 0);

    // Quantidade e preço médio são os dois primeiros números úteis da linha.
    const [quantity, price] = numbers;
    if (!(quantity > 0) || !(price > 0)) return null;

    return { ticker, side: 'BUY', quantity, price, date: '', currency: 'BRL' };
};

/**
 * @param text  O conteúdo colado pelo usuário.
 * @param startDate  Data de início da carteira (`YYYY-MM-DD`), aplicada a todas
 *                   as linhas — a fonte não traz datas.
 */
export const parseInvestidor10Paste = (text: string, startDate: string): ParseResult => {
    const lines = String(text ?? '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

    if (lines.length === 0) {
        throw new ParseError('Nada foi colado. Selecione a tabela da sua carteira no Investidor10 e copie.');
    }

    const grid = lines.map(splitCells);
    const rows: ImportRow[] = [];
    const warnings: string[] = [];

    // --- Caminho 1: existe cabeçalho reconhecível ---
    let headerRow = -1;
    for (let i = 0; i < Math.min(grid.length, 10); i += 1) {
        const temTicker = findColumn(grid[i], COL.ticker) !== -1;
        const temQuantidade = findColumn(grid[i], COL.quantidade) !== -1;
        if (temTicker && temQuantidade) { headerRow = i; break; }
    }

    if (headerRow !== -1) {
        const headers = grid[headerRow];
        const idx = {
            ticker: findColumn(headers, COL.ticker),
            quantidade: findColumn(headers, COL.quantidade),
            precoMedio: findColumn(headers, COL.precoMedio),
            classe: findColumn(headers, COL.classe),
            total: findColumn(headers, COL.total),
        };

        for (let i = headerRow + 1; i < grid.length; i += 1) {
            const line = grid[i];
            const at = (index: number) => (index === -1 ? '' : (line[index] ?? ''));

            const rawTicker = at(idx.ticker);
            if (!rawTicker) continue;
            const ticker = rawTicker.split(/\s+/)[0].toUpperCase();
            if (!looksLikeTicker(ticker)) continue;

            const quantity = parseNumber(at(idx.quantidade));
            if (!(quantity > 0)) continue;

            // Preço médio direto; se a coluna não veio, deriva do valor aplicado.
            let price = parseNumber(at(idx.precoMedio));
            if (!(price > 0)) {
                const total = parseNumber(at(idx.total));
                price = total > 0 ? total / quantity : 0;
            }
            if (!(price > 0)) continue;

            rows.push({
                ticker,
                type: parseAssetType(at(idx.classe)),
                side: 'BUY',
                quantity,
                price,
                date: startDate,
                currency: 'BRL',
            });
        }
    }

    // --- Caminho 2: sem cabeçalho utilizável, lê pelo formato ---
    if (rows.length === 0) {
        for (const line of grid) {
            const row = parsePositionally(line);
            if (row) rows.push({ ...row, date: startDate });
        }
        if (rows.length > 0) {
            warnings.push(
                'Não encontrei o cabeçalho da tabela, então li os dados pelo formato das linhas. Confira quantidade e preço médio de cada ativo com atenção.'
            );
        }
    }

    if (rows.length === 0) {
        throw new ParseError(
            'Não consegui identificar nenhum ativo no texto colado. Selecione a tabela inteira da carteira, incluindo o cabeçalho das colunas.'
        );
    }

    warnings.push(
        'O Investidor10 não expõe as datas de compra, então todos os ativos entraram como uma compra na data de início que você informou. O patrimônio e o resultado ficam corretos; a evolução antes dessa data não existe. Para a rentabilidade histórica completa, use o extrato da B3.'
    );

    return { rows, warnings, source: 'INVESTIDOR10' };
};
