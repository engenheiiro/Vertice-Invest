/**
 * Ordena as dependências de boot sem acoplar o teste ao socket ou ao Mongo real.
 * O scheduler só pode registrar timers depois de banco e HTTP estarem prontos.
 */
export async function startApplication({ connectDB, listen, initScheduler }) {
    await connectDB();
    const server = await listen();
    initScheduler();
    return server;
}

/** Registra apenas o estado da integração, nunca qualquer parte do segredo. */
export function logAiConfiguration(logger, apiKey) {
    if (!apiKey) {
        logger.warn('⚠️ AVISO: API_KEY do Google Gemini não configurada.');
        return { configured: false };
    }

    logger.info('🧠 [AI] Google Gemini: API key configurada.');
    return { configured: true };
}
