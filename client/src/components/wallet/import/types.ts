import type { AssetType } from '../../../contexts/WalletContext';

/** De onde as linhas vieram. Espelha o enum do backend (`importSchemas.js`). */
export type ImportSource = 'B3_MOVIMENTACAO' | 'B3_NEGOCIACAO' | 'INVESTIDOR10' | 'SHEET';

/** Situação de uma linha na conferência. Espelha `ROW_STATUS` do serviço. */
export type RowStatus = 'ok' | 'duplicado' | 'atencao' | 'nao_reconhecido';

/**
 * Uma linha já normalizada por um parser, pronta para ir ao servidor.
 *
 * É deliberadamente pobre: ticker, lado, quantidade, preço e data. Tudo que o
 * arquivo original carregava além disso — CPF, corretora, conta, nome do
 * titular — morre no navegador e nunca chega ao nosso banco.
 */
export interface ImportRow {
    ticker: string;
    type?: AssetType;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    /** Sempre `YYYY-MM-DD`. Dia-calendário, não instante. */
    date: string;
    currency?: 'BRL' | 'USD';
    name?: string;
}

/** Uma linha depois de passar pelo `/import/preview`. */
export interface ResolvedRow extends ImportRow {
    type?: AssetType;
    status: RowStatus;
    reason: string | null;
}

/** Posição resultante de um ticker — o material da conferência contra a origem. */
export interface ImportSummaryItem {
    ticker: string;
    type: AssetType | null;
    name: string | null;
    currency: 'BRL' | 'USD';
    rows: number;
    quantity: number;
    averagePrice: number;
    totalCost: number;
    hadPosition: boolean;
}

export interface ImportPreview {
    rows: ResolvedRow[];
    summary: ImportSummaryItem[];
    counts: {
        total: number;
        ok: number;
        duplicado: number;
        atencao: number;
        naoReconhecido: number;
    };
}

/** O que um parser devolve: as linhas e o que ele não conseguiu ler. */
export interface ParseResult {
    rows: ImportRow[];
    /** Avisos legíveis — linhas puladas, colunas ausentes, eventos ignorados. */
    warnings: string[];
    /**
     * Fonte efetivamente detectada. O parser da B3 atende dois extratos de
     * layouts diferentes e só descobre qual é ao ver as colunas, então quem
     * decide o `source` é ele, não a tela que o chamou.
     */
    source?: ImportSource;
}

/** Erro de parsing com mensagem destinada ao usuário, não ao console. */
export class ParseError extends Error {}
