// Série USD/BRL: o que entra de uma fonte e como se une ao que já está gravado.
// Puras — a leitura e a escrita no banco ficam em `_persistUsdHistory`.

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Entrada aproveitável → { date, close, adjClose }; senão null. Sem `adjClose`
// válido, vale o próprio fechamento.
const normalizeUsdEntry = (entry) => {
    const close = Number(entry?.close);
    const adj = Number(entry?.adjClose ?? entry?.close);
    if (!DAY_KEY.test(entry?.date || '')) return null;
    if (!Number.isFinite(close) || close <= 0) return null;
    return {
        date: entry.date,
        close,
        adjClose: Number.isFinite(adj) && adj > 0 ? adj : close,
    };
};

/** Entradas válidas da fonte, por dia (a última de um dia repetido vence). */
export const normalizeUsdEntries = (entries) => {
    const incoming = new Map();
    for (const entry of entries || []) {
        const row = normalizeUsdEntry(entry);
        if (row) incoming.set(row.date, row);
    }
    return incoming;
};

/**
 * UNIÃO com o gravado: data repetida fica com o valor novo (correção da fonte
 * vale) e o passado fora da janela da fonte sobrevive. Ordenada por data.
 */
export const mergeUsdHistory = (existingHistory, incoming) => {
    const merged = new Map();
    for (const entry of existingHistory || []) {
        if (entry?.date && !incoming.has(entry.date)) merged.set(entry.date, entry);
    }
    for (const [date, entry] of incoming) merged.set(date, entry);
    return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
};
