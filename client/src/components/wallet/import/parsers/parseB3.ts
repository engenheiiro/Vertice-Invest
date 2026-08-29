import { ParseError, type ImportRow, type ImportSource, type ParseResult } from '../types';
import { findColumn, locateHeaderRow, parseNumber, parseSheetDate, parseSide } from './common';

/**
 * Extratos da Área do Investidor da B3 (`investidor.b3.com.br`).
 *
 * Esta é a melhor fonte disponível, e por um motivo específico: é a MESMA fonte
 * que alimenta o Investidor10 (a integração B3 deles), só que aberta para
 * qualquer pessoa e de graça. E ela traz o que o Investidor10 não exporta — o
 * histórico de negócios com datas reais, que é o que faz TWRR, curva de evolução
 * e apuração de IR nascerem corretos em vez de zerados.
 *
 * Dois extratos servem, com layouts diferentes:
 *  - **Movimentação**: todos os eventos de custódia. Os negócios aparecem como
 *    `Transferência - Liquidação`, com o lado em `Entrada/Saída`.
 *  - **Negociação**: só os negócios, com o lado já explícito em
 *    `Tipo de Movimentação`.
 *
 * Os cabeçalhos abaixo foram montados a partir da documentação pública dos
 * importadores que já consomem esses arquivos. O casamento é por NOME e tolera
 * variação, mas se a B3 renomear uma coluna obrigatória o parser falha com
 * mensagem clara em vez de importar número trocado.
 */

// --- Cabeçalhos aceitos, em ordem de preferência ---
const COL = {
    entradaSaida: ['entrada/saida', 'entrada saida', 'entrada/saída'],
    data: ['data do negocio', 'data do negócio', 'data'],
    movimentacao: ['movimentacao', 'movimentação', 'tipo de movimentacao', 'tipo de movimentação'],
    produto: ['produto', 'codigo de negociacao', 'código de negociação', 'ativo'],
    quantidade: ['quantidade', 'qtd', 'quantidade negociada'],
    preco: ['preco unitario', 'preço unitário', 'preco', 'preço'],
    valor: ['valor da operacao', 'valor da operação', 'valor'],
};

/**
 * Eventos que NÃO viram lançamento de compra/venda, e por quê.
 *
 * Proventos ficam de fora porque nossa própria ingestão já popula
 * `DividendEvent` com dedup por (ticker, data-ex, tipo) — importar aqui
 * duplicaria a renda na carteira. Desdobro/grupamento ficam de fora porque
 * viram evento de quantidade, não negócio; a tela de conferência compara a
 * posição resultante com a real justamente para expor esse caso.
 */
const IGNORED_EVENTS = /(dividendo|juros sobre capital|jcp|rendimento|desdobr|grupament|bonificac|fracao|fração|subscric|subscriç|atualizac|atualizaç|emprestim|empréstim|cessao|cessão|transferencia -? ?transfer|leilao|leilão)/i;

/** Um negócio de fato — o único evento que vira lançamento. */
const isTrade = (movimentacao: string): boolean =>
    /liquidac|liquidaç/i.test(movimentacao) || /^(compra|venda)$/i.test(movimentacao.trim());

export const parseB3Sheet = (grid: string[][]): ParseResult => {
    // O cabeçalho obrigatório mínimo: produto, quantidade e data. Sem os três não
    // há como montar um lançamento, e é melhor dizer isso do que adivinhar.
    const headerRow = locateHeaderRow(grid, [COL.produto, COL.quantidade, COL.data]);
    if (headerRow === -1) {
        throw new ParseError(
            'Não reconheci este arquivo como um extrato da B3. Baixe em Extratos → Movimentação (ou Negociação) e escolha o formato Excel.'
        );
    }

    const headers = grid[headerRow];
    const idx = {
        entradaSaida: findColumn(headers, COL.entradaSaida),
        data: findColumn(headers, COL.data),
        movimentacao: findColumn(headers, COL.movimentacao),
        produto: findColumn(headers, COL.produto),
        quantidade: findColumn(headers, COL.quantidade),
        preco: findColumn(headers, COL.preco),
        valor: findColumn(headers, COL.valor),
    };

    // Qual dos dois extratos temos em mãos: o de Movimentação tem `Entrada/Saída`.
    const source: ImportSource = idx.entradaSaida !== -1 ? 'B3_MOVIMENTACAO' : 'B3_NEGOCIACAO';

    const rows: ImportRow[] = [];
    const warnings: string[] = [];
    const ignoredCount = new Map<string, number>();
    let semPreco = 0;

    for (let i = headerRow + 1; i < grid.length; i += 1) {
        const line = grid[i];
        if (!line || line.every((cell) => !cell)) continue;

        const at = (index: number) => (index === -1 ? '' : (line[index] ?? ''));

        const produto = at(idx.produto);
        if (!produto) continue;

        const movimentacao = at(idx.movimentacao);

        // No extrato de Movimentação tudo que não é negócio é ruído para nós.
        // No de Negociação a coluna já é o lado (Compra/Venda), então a ausência
        // de "liquidação" ali não significa evento ignorável.
        if (source === 'B3_MOVIMENTACAO' && movimentacao && !isTrade(movimentacao)) {
            const key = movimentacao.trim();
            ignoredCount.set(key, (ignoredCount.get(key) ?? 0) + 1);
            continue;
        }

        const date = parseSheetDate(at(idx.data));
        if (!date) continue;

        const quantity = parseNumber(at(idx.quantidade));
        if (!(quantity > 0)) continue;

        // O lado vem de `Entrada/Saída` (Movimentação) ou de `Tipo de
        // Movimentação` (Negociação). Sem lado, não há lançamento honesto.
        const side = parseSide(at(idx.entradaSaida)) ?? parseSide(movimentacao);
        if (!side) continue;

        // Preferimos o preço unitário; quando a B3 traz só o total (acontece em
        // algumas linhas de liquidação), derivamos dividindo pela quantidade.
        let price = parseNumber(at(idx.preco));
        if (!(price > 0)) {
            const total = parseNumber(at(idx.valor));
            price = total > 0 ? total / quantity : 0;
        }
        if (!(price > 0)) semPreco += 1;

        rows.push({ ticker: produto, side, quantity, price, date, currency: 'BRL' });
    }

    if (rows.length === 0) {
        throw new ParseError(
            'O arquivo foi lido, mas não encontrei nenhuma compra ou venda nele. Confira se o período filtrado na B3 cobre suas operações.'
        );
    }

    const proventos = [...ignoredCount.entries()]
        .filter(([evento]) => IGNORED_EVENTS.test(evento))
        .reduce((total, [, count]) => total + count, 0);
    if (proventos > 0) {
        warnings.push(
            `${proventos} evento(s) de provento e evento corporativo foram ignorados — proventos são buscados automaticamente pelo Vértice, sem precisar importar.`
        );
    }
    if (semPreco > 0) {
        warnings.push(`${semPreco} lançamento(s) vieram sem preço no extrato. Confira e ajuste antes de importar.`);
    }

    return { rows, warnings, source };
};
