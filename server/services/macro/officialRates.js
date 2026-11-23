// Partes de `macroDataService.updateOfficialRates`: cadeia de fontes da Selic e
// do IPCA 12m (BCB → BrasilAPI → IBGE), o "sem fonte" honesto e a trilha que o
// painel de Saúde lê. As chamadas de rede continuam sendo métodos do serviço
// (`service.*`), para que quem testa possa substituí-las.
import logger from '../../config/logger.js';
import { recordEscalation } from '../../utils/sourceHealth.js';

const RATE_SOURCE_IDS = { BCB: 'bcb.series', BrasilAPI: 'brasilapi', IBGE: 'ibge' };

// Secundária unificada: BrasilAPI entrega Selic e IPCA numa única chamada.
const fillFromBrasilApi = async (service, reading) => {
    if (reading.selic == null) reading.trilha.selic.push('brasilapi');
    if (reading.ipca == null) reading.trilha.ipca.push('brasilapi');
    const brasilApi = await service.fetchRatesFromBrasilApi();
    if (reading.selic == null && brasilApi.selic != null) { reading.selic = brasilApi.selic; reading.selicSource = 'BrasilAPI'; }
    if (reading.ipca == null && brasilApi.ipca != null) { reading.ipca = brasilApi.ipca; reading.ipcaSource = 'BrasilAPI'; }
};

/**
 * Leitura das taxas a partir do que o BCB já trouxe: completa com a BrasilAPI
 * e, para o IPCA, com o IBGE SIDRA. A trilha é por INDICADOR: o IBGE só publica
 * IPCA, e uma trilha por chamada o acusaria de ter falhado na Selic.
 */
export const collectOfficialRates = async (service, bcb) => {
    const reading = {
        selic: bcb.selic,
        ipca: bcb.ipca,
        selicSource: bcb.selic != null ? 'BCB' : null,
        ipcaSource: bcb.ipca != null ? 'BCB' : null,
        trilha: { selic: ['bcb.series'], ipca: ['bcb.series'] },
    };
    if (reading.selic == null || reading.ipca == null) await fillFromBrasilApi(service, reading);
    if (reading.ipca == null) {
        reading.trilha.ipca.push('ibge');
        reading.ipca = await service.fetchIpcaFromIbge();
        if (reading.ipca != null) reading.ipcaSource = 'IBGE';
    }
    return reading;
};

/**
 * Sem fonte nenhuma: NADA de constante nossa. A Selic devolve a ÚLTIMA BOA (ou
 * null sem âncora) e o IPCA devolve null; as flags dizem ao gravador o que NÃO
 * deve ser escrito.
 */
export const applyMissingRatesFallback = (reading, lastGoodSelic) => {
    const flags = { selicIsFallback: false, ipcaIsFallback: false };
    if (reading.selic == null) {
        reading.selic = lastGoodSelic > 0 ? lastGoodSelic : null;
        flags.selicIsFallback = true;
        logger.warn(`⚠️ [Macro] SELIC: BCB e fonte secundária falharam. Mantendo o último valor gravado (${reading.selic ?? 'nenhum'}%, ratesStale=true).`);
    }
    if (reading.ipca == null) {
        flags.ipcaIsFallback = true;
        logger.warn('⚠️ [Macro] IPCA: BCB, BrasilAPI e IBGE falharam. Mantendo o último valor gravado (ratesStale=true).');
    }
    return flags;
};

export const logRatesSummary = (reading, selicFrozen) => {
    const selicLabel = selicFrozen ? 'congelado' : reading.selicSource || 'fallback';
    logger.info(`📊 [Macro] Taxas oficiais: SELIC ${reading.selic}% (${selicLabel}) · IPCA 12m ${reading.ipca}% (${reading.ipcaSource || 'fallback'}).`);
};

const recordRateEscalation = (assunto, tried, source, motivo) => {
    const resolvedBy = RATE_SOURCE_IDS[source] || null;
    if (tried.length <= 1 && resolvedBy) return;
    recordEscalation({ chain: 'rates', subject: assunto, tried, resolvedBy, reason: motivo });
};

/**
 * Para o painel: quem precisou de reserva, e quem ficou sem fonte alguma. O
 * fallback NÃO é fonte, e a Selic CONGELADA pelo guard também entra como não
 * resolvida — o valor que ficou é o último bom, não o que a secundária trouxe.
 */
export const reportRatesEscalations = (reading, selicFrozen, lastGoodSelic) => {
    recordRateEscalation(
        'SELIC',
        reading.trilha.selic,
        selicFrozen ? null : reading.selicSource,
        selicFrozen
            ? `Fonte secundária divergiu do último valor bom (${lastGoodSelic}%) e só o Banco Central pode mover a Selic — valor congelado`
            : 'O Banco Central não trouxe este indicador',
    );
    recordRateEscalation('IPCA', reading.trilha.ipca, reading.ipcaSource, 'O Banco Central não trouxe este indicador');
};

// Sem `cdi12m`: "Selic de hoje − 0,10" é a taxa VIGENTE, não o retorno
// REALIZADO em 12 meses — o acumulado vem da série diária real, ou não vem.
export const buildOfficialRatesResult = (reading, flags, selicFrozen) => ({
    selic: reading.selic,
    ipca: reading.ipca,
    cdi: reading.selic != null ? Math.max(0, reading.selic - 0.10) : null,
    isFallback: flags.selicIsFallback || flags.ipcaIsFallback,
    selicIsFallback: flags.selicIsFallback,
    ipcaIsFallback: flags.ipcaIsFallback,
    selicFrozen,
    sources: { selic: selicFrozen ? 'frozen' : (reading.selicSource || 'fallback'), ipca: reading.ipcaSource || 'fallback' },
});
