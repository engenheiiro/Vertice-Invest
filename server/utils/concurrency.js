/**
 * map assíncrono com teto de concorrência e ordem de saída estável.
 * Não inicia uma Promise por item antecipadamente, evitando filas enormes.
 */
export const mapWithConcurrency = async (items, concurrency, mapper) => {
    const list = Array.from(items || []);
    if (list.length === 0) return [];

    const limit = Math.max(1, Math.min(list.length, Math.trunc(Number(concurrency)) || 1));
    const results = new Array(list.length);
    let cursor = 0;

    const worker = async () => {
        while (true) {
            const index = cursor++;
            if (index >= list.length) return;
            results[index] = await mapper(list[index], index);
        }
    };

    await Promise.all(Array.from({ length: limit }, worker));
    return results;
};
