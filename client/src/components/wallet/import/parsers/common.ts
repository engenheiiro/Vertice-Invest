import type { AssetType } from '../../../../contexts/WalletContext';

/**
 * Utilidades compartilhadas pelos parsers de importação.
 *
 * A regra que atravessa todos eles: **casar coluna por NOME, nunca por posição**.
 * Nem a B3 nem o Investidor10 nos devem estabilidade de layout, e uma coluna
 * nova inserida no meio não pode transformar preço em quantidade.
 */

/** Minúsculas, sem acento, espaços colapsados — para comparar cabeçalhos. */
export const normalizeHeader = (value: string): string =>
    String(value ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

/**
 * Índice da primeira coluna cujo cabeçalho casa com algum candidato.
 * Casamento por prefixo: "preço unitário (r$)" ainda casa com "preco unitario".
 */
export const findColumn = (headers: string[], candidates: string[]): number => {
    const normalized = headers.map(normalizeHeader);
    for (const candidate of candidates) {
        const target = normalizeHeader(candidate);
        const exact = normalized.indexOf(target);
        if (exact !== -1) return exact;
    }
    for (const candidate of candidates) {
        const target = normalizeHeader(candidate);
        const partial = normalized.findIndex((h) => h.startsWith(target) || h.includes(target));
        if (partial !== -1) return partial;
    }
    return -1;
};

/**
 * Localiza a linha de cabeçalho de verdade.
 *
 * Exportações costumam ter título, filtros e linhas em branco antes da tabela;
 * assumir que o cabeçalho é a linha 0 quebra na primeira mudança de template.
 * Procuramos a primeira linha que contenha todos os cabeçalhos obrigatórios.
 */
export const locateHeaderRow = (grid: string[][], required: string[][]): number => {
    const limit = Math.min(grid.length, 30);
    for (let i = 0; i < limit; i += 1) {
        const found = required.every((candidates) => findColumn(grid[i], candidates) !== -1);
        if (found) return i;
    }
    return -1;
};

/**
 * Número em formato brasileiro ou internacional.
 *
 * `1.234,56` (BR) e `1,234.56` (US) são ambíguos olhando só para os separadores,
 * então decidimos pelo ÚLTIMO separador presente: ele é o decimal.
 */
export const parseNumber = (value: string | number): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

    const cleaned = String(value ?? '')
        .replace(/R\$|US\$|\$/g, '')
        .replace(/\s/g, '')
        .trim();
    if (!cleaned) return 0;

    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');

    let normalized = cleaned;
    if (lastComma > lastDot) {
        // Vírgula é o decimal → pontos são separadores de milhar.
        normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
        normalized = cleaned.replace(/,/g, '');
    }

    const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
};

/** Serial do Excel → dia-calendário. A época é 1899-12-30 (o bug de 1900 já embutido). */
const fromExcelSerial = (serial: number): string | null => {
    // Faixa plausível: 1990 a 2100. Fora disso é número solto, não data.
    if (serial < 32874 || serial > 73415) return null;
    const millis = Math.round(serial) * 86400000;
    const date = new Date(Date.UTC(1899, 11, 30) + millis);
    return date.toISOString().slice(0, 10);
};

/**
 * Normaliza uma data de planilha para `YYYY-MM-DD`.
 *
 * Aceita `dd/mm/aaaa` (B3 e Investidor10), ISO, e o serial numérico que o Excel
 * grava quando a célula está formatada como data. Devolve null no que não
 * reconhece — a linha vira "não reconhecida" na conferência em vez de entrar com
 * uma data inventada.
 */
export const parseSheetDate = (value: string | number): string | null => {
    if (value === null || value === undefined || value === '') return null;

    const raw = String(value).trim();

    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
    if (br) {
        const [, d, m, y] = br;
        const day = d.padStart(2, '0');
        const month = m.padStart(2, '0');
        if (Number(month) > 12 || Number(day) > 31) return null;
        return `${y}-${month}-${day}`;
    }

    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (iso) return raw.slice(0, 10);

    if (/^\d+([.,]\d+)?$/.test(raw)) return fromExcelSerial(parseNumber(raw));

    return null;
};

/**
 * Classe do ativo a partir de um rótulo escrito por humano (planilha modelo ou
 * seletor do Investidor10). Só reconhece o que é inequívoco — a resolução real
 * acontece no servidor, contra o catálogo.
 */
export const parseAssetType = (value: string): AssetType | undefined => {
    const v = normalizeHeader(value);
    if (!v) return undefined;
    if (/(^|\b)(fii|fundo imobiliario|imobiliario)/.test(v)) return 'FII';
    if (/(^|\b)(cripto|crypto|moeda digital)/.test(v)) return 'CRYPTO';
    if (/(^|\b)(etf)/.test(v)) return 'ETF';
    if (/(exterior|stock_us|stocks?_?us|acao americana|acoes americanas|reit)/.test(v)) return 'STOCK_US';
    if (/(renda fixa|fixed_income|tesouro|cdb|lci|lca)/.test(v)) return 'FIXED_INCOME';
    if (/(caixa|reserva|cash)/.test(v)) return 'CASH';
    if (/(acao|acoes|stock)/.test(v)) return 'STOCK';
    return undefined;
};

/** Detecta compra/venda em qualquer das grafias que as fontes usam. */
export const parseSide = (value: string): 'BUY' | 'SELL' | null => {
    const v = normalizeHeader(value);
    if (!v) return null;
    if (/(compra|credito|crédito|buy|entrada|aquisicao)/.test(v)) return 'BUY';
    if (/(venda|debito|débito|sell|saida|resgate|alienacao)/.test(v)) return 'SELL';
    return null;
};

/** Um código de negociação plausível da B3 (`PETR4`, `MXRF11`, `BOVA11`). */
export const looksLikeTicker = (value: string): boolean =>
    /^[A-Z]{4}\d{1,2}[A-Z]?$/.test(String(value ?? '').trim().toUpperCase());
