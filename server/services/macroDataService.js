
import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';
import http from 'http';
import SystemConfig from '../models/SystemConfig.js';
import TreasuryBond from '../models/TreasuryBond.js';
import EconomicIndex from '../models/EconomicIndex.js';
import { DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js'; // (M9)
import AssetHistory from '../models/AssetHistory.js';
import logger from '../config/logger.js';
import { externalMarketService } from './externalMarketService.js';
import { isBusinessDay } from '../utils/dateUtils.js';

const SERIES_BCB = { SELIC_META: 432, IPCA_12M: 13522, CDI_MONTHLY: 4391, SELIC_DAILY: 11 };

// Verificação de certificado HABILITADA por padrão (segurança contra MITM).
// Escape hatch: defina ALLOW_INSECURE_TLS=true SOMENTE se o ambiente de
// hospedagem tiver problema com a cadeia de certificados do BCB. As camadas de
// fallback (HTTP + síntese local) já cobrem falhas de TLS sem quebrar o sync.
const REJECT_UNAUTHORIZED = process.env.ALLOW_INSECURE_TLS !== 'true';

const httpAgent = new http.Agent({ keepAlive: true });
const bcbAgent = new https.Agent({
    rejectUnauthorized: REJECT_UNAUTHORIZED,
    keepAlive: true,
    minVersion: 'TLSv1.2'
});

const scrapingAgent = new https.Agent({
    rejectUnauthorized: REJECT_UNAUTHORIZED,
    keepAlive: true,
    ciphers: 'DEFAULT:!DH'
});

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Connection': 'keep-alive'
};

export const macroDataService = {
    
    // --- 1. INDICADORES MACRO (OFICIAIS) ---
    // Cadeia de fontes por métrica: BCB (primária) -> secundária -> fallback hardcoded.
    //   SELIC: BCB série 432 -> BrasilAPI /taxas (tokenless)
    //   IPCA 12m: BCB série 13522 -> BrasilAPI /taxas -> IBGE SIDRA (ambas tokenless)
    // isFallback só fica true quando TODAS as fontes de alguma métrica falham.
    async updateOfficialRates() {
        let selicVal = await this._fetchBcbSeries(SERIES_BCB.SELIC_META, 'SELIC');
        let ipcaVal = await this._fetchBcbSeries(SERIES_BCB.IPCA_12M, 'IPCA');

        let selicSource = selicVal != null ? 'BCB' : null;
        let ipcaSource = ipcaVal != null ? 'BCB' : null;

        // Secundária unificada: BrasilAPI entrega Selic e IPCA numa única chamada (tokenless).
        if (selicVal == null || ipcaVal == null) {
            const brasilApi = await this.fetchRatesFromBrasilApi();
            if (selicVal == null && brasilApi.selic != null) { selicVal = brasilApi.selic; selicSource = 'BrasilAPI'; }
            if (ipcaVal == null && brasilApi.ipca != null) { ipcaVal = brasilApi.ipca; ipcaSource = 'BrasilAPI'; }
        }

        // Terciária para IPCA: IBGE SIDRA (fonte autoritativa do índice, tokenless).
        if (ipcaVal == null) {
            ipcaVal = await this.fetchIpcaFromIbge();
            if (ipcaVal != null) ipcaSource = 'IBGE';
        }

        // Fallback hardcoded apenas para o que ainda faltar
        let selicIsFallback = false;
        let ipcaIsFallback = false;
        if (selicVal == null) {
            selicVal = DEFAULT_SELIC_FALLBACK;
            selicIsFallback = true;
            logger.warn(`⚠️ [Macro] SELIC: BCB e fonte secundária falharam. Fallback hardcoded ${selicVal}%.`);
        }
        if (ipcaVal == null) {
            ipcaVal = 4.50;
            ipcaIsFallback = true;
            logger.warn(`⚠️ [Macro] IPCA: BCB e fonte secundária falharam. Fallback hardcoded ${ipcaVal}%.`);
        }

        logger.info(`📊 [Macro] Taxas oficiais: SELIC ${selicVal}% (${selicSource || 'fallback'}) · IPCA 12m ${ipcaVal}% (${ipcaSource || 'fallback'}).`);

        return {
            selic: selicVal,
            ipca: ipcaVal,
            cdi: Math.max(0, selicVal - 0.10),
            cdi12m: Math.max(0, selicVal - 0.10),
            isFallback: selicIsFallback || ipcaIsFallback,
            sources: { selic: selicSource || 'fallback', ipca: ipcaSource || 'fallback' }
        };
    },

    // Primária: lê o último valor de uma série SGS do BCB. Retorna número ou null.
    async _fetchBcbSeries(serie, label) {
        try {
            const res = await axios.get(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/1?formato=json`, {
                headers: BASE_HEADERS,
                httpsAgent: bcbAgent,
                timeout: 5000
            });
            const raw = Array.isArray(res.data) && res.data[0]?.valor;
            const val = raw ? parseFloat(String(raw).replace(',', '.')) : NaN;
            if (val > 0 && val < 50) return val;
            logger.warn(`⚠️ [Macro] ${label}: BCB respondeu sem valor válido. Tentando fonte secundária...`);
            return null;
        } catch (e) {
            logger.warn(`⚠️ [Macro] ${label} via BCB falhou (${e.message}). Tentando fonte secundária...`);
            return null;
        }
    },

    // Secundária unificada SELIC + IPCA: BrasilAPI /api/taxas/v1 (tokenless).
    // Retorna { selic, ipca } com cada campo número ou null.
    async fetchRatesFromBrasilApi() {
        try {
            const res = await axios.get('https://brasilapi.com.br/api/taxas/v1', { headers: BASE_HEADERS, timeout: 6000 });
            const list = Array.isArray(res.data) ? res.data : [];
            const pick = (nome) => {
                const item = list.find(r => String(r.nome).toUpperCase() === nome);
                const val = item ? parseFloat(String(item.valor).replace(',', '.')) : NaN;
                return (val > 0 && val < 50) ? val : null;
            };
            const selic = pick('SELIC');
            const ipca = pick('IPCA');
            if (selic != null || ipca != null) {
                logger.info(`🔁 [Macro] Taxas da fonte secundária (BrasilAPI): SELIC ${selic ?? 'n/d'}% · IPCA ${ipca ?? 'n/d'}%.`);
            }
            return { selic, ipca };
        } catch (e) {
            logger.debug(`[Macro] BrasilAPI taxas indisponível: ${e.message}`);
            return { selic: null, ipca: null };
        }
    },

    // Secundária IPCA 12m: IBGE SIDRA (tabela 1737, variável 2265 — tokenless). Retorna número ou null.
    async fetchIpcaFromIbge() {
        try {
            const url = 'https://servicodados.ibge.gov.br/api/v3/agregados/1737/periodos/-1/variaveis/2265?localidades=N1[all]';
            const res = await axios.get(url, { headers: BASE_HEADERS, timeout: 8000 });
            const serie = res.data?.[0]?.resultados?.[0]?.series?.[0]?.serie;
            if (serie && typeof serie === 'object') {
                const values = Object.values(serie).filter(v => v != null && v !== '...');
                const raw = values[values.length - 1];
                const val = raw != null ? parseFloat(String(raw).replace(',', '.')) : NaN;
                if (val > 0 && val < 50) {
                    logger.info(`🔁 [Macro] IPCA 12m obtido da fonte secundária (IBGE): ${val}%.`);
                    return val;
                }
            }
            return null;
        } catch (e) {
            logger.debug(`[Macro] IBGE IPCA indisponível: ${e.message}`);
            return null;
        }
    },

    // --- SYNC DIÁRIO ROBUSTO (COM TRÊS CAMADAS DE FALLBACK) ---
    async syncDailyEconomicIndexes() {
        let startDateObj = new Date('2023-01-01'); // Default fallback seguro
        let startDateStr = '01/01/2023';

        try {
            const lastEntry = await EconomicIndex.findOne({ series: 'SELIC' }).sort({ date: -1 });
            if (lastEntry) {
                const d = new Date(lastEntry.date);
                d.setDate(d.getDate() + 1);
                startDateObj = d;
                startDateStr = d.toLocaleDateString('pt-BR');
            }
        } catch (e) {
            logger.debug(`[Macro] Falha ao ler última entrada SELIC, usando default ${startDateStr}: ${e.message}`);
        }

        // Se a data for futura ou hoje, não precisa atualizar
        if (startDateObj > new Date()) {
            logger.debug(`✅ [Macro] Histórico já está atualizado.`);
            return;
        }

        logger.info(`📊 [Macro] Buscando histórico diário Selic desde ${startDateStr}...`);

        // TENTATIVA 1: HTTPS JSON (BCB API)
        try {
            const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES_BCB.SELIC_DAILY}/dados?formato=json&dataInicial=${startDateStr}`;
            const res = await axios.get(url, { headers: BASE_HEADERS, httpsAgent: bcbAgent, timeout: 8000 });

            if (res.data && Array.isArray(res.data)) {
                if (res.data.length > 0) {
                    await this.processDailyData(res.data);
                    logger.info(`✅ [Macro] Sucesso via HTTPS: ${res.data.length} registros.`);
                } else {
                    logger.info(`✅ [Macro] HTTPS: Nenhum dado novo disponível no BCB.`);
                }
                return;
            }
        } catch (error) {
            // Tenta o endpoint de últimos se o filtrado por data falhar (Bypass de bugs de range do BCB)
            try {
                const urlUltimos = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES_BCB.SELIC_DAILY}/dados/ultimos/50?formato=json`;
                const resUlt = await axios.get(urlUltimos, { headers: BASE_HEADERS, httpsAgent: bcbAgent, timeout: 5000 });
                if (resUlt.data && Array.isArray(resUlt.data) && resUlt.data.length > 0) {
                    await this.processDailyData(resUlt.data);
                    logger.info(`✅ [Macro] Sucesso via HTTPS (Últimos 50): ${resUlt.data.length} registros.`);
                    return;
                }
            } catch (e) {
                logger.debug(`[Macro] Fallback HTTPS 'últimos/50' também falhou: ${e.message}`);
            }
        }

        // TENTATIVA 2: HTTP (SEM SSL - Bypass WAF)
        try {
            logger.warn("⚠️ [Macro] HTTPS falhou. Tentando HTTP (Porta 80)...");
            const urlHttp = `http://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES_BCB.SELIC_DAILY}/dados?formato=json&dataInicial=${startDateStr}`;
            
            const resHttp = await axios.get(urlHttp, {
                headers: { 'User-Agent': 'Wget/1.20.3 (linux-gnu)', 'Accept': '*/*' },
                httpAgent: httpAgent,
                timeout: 10000 // Timeout maior
            });

            const resData = resHttp.data;
            const dataArray = Array.isArray(resData) ? resData : (resData && typeof resData === 'object' && resData.data && resData.valor ? [resData] : []);

            if (dataArray.length > 0) {
                await this.processDailyData(dataArray);
                logger.info(`✅ [Macro] Sucesso via HTTP: ${dataArray.length} registros.`);
                return;
            } else {
                // Se for um array vazio, é sucesso mas sem dados novos
                if (Array.isArray(resData) && resData.length === 0) {
                    logger.info(`✅ [Macro] HTTP: Nenhum dado novo.`);
                    return;
                }

                const dataType = typeof resData;
                let dataSnippet = 'N/A';
                try {
                    dataSnippet = dataType === 'string' 
                        ? resData.substring(0, 200) 
                        : JSON.stringify(resData).substring(0, 200);
                } catch (e) {
                    dataSnippet = '[Unserializable Object]';
                }
                throw new Error(`Resposta HTTP inválida (Status: ${resHttp.status}, Tipo: ${dataType}). Snippet: ${dataSnippet}`);
            }
        } catch (httpError) {
            logger.error(`❌ [Macro] HTTP também falhou: ${httpError.message}`);
        }

        // TENTATIVA 3: GERAÇÃO SINTÉTICA (Matemática)
        // Se o BCB bloqueou tudo, calculamos o CDI com base na meta atual para não quebrar os gráficos.
        await this.generateSyntheticData(startDateObj);
    },

    async generateSyntheticData(startDate) {
        logger.warn("⚠️ [Macro] Ativando Fallback Sintético (Cálculo Local)...");
        
        try {
            // Pega a meta atual salva no banco
            const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            const currentSelic = config?.selic || DEFAULT_SELIC_FALLBACK;
            const currentCdi = Math.max(0, currentSelic - 0.10); // Ex: 11.15
            
            // Fator diário = (1 + Taxa/100)^(1/252)
            // Aproximação: Taxa/100/252 (Juros Simples diário para fator percentual do BCB)
            // O BCB entrega o valor percentual diário (ex: 0.042356)
            const dailyRateApprox = Math.pow(1 + (currentCdi / 100), 1/252) - 1;
            const dailyPercentVal = dailyRateApprox * 100;

            const operations = [];
            let cursor = new Date(startDate);
            const today = new Date();

            while (cursor <= today) {
                if (isBusinessDay(cursor)) {
                    operations.push({
                        updateOne: {
                            filter: { series: 'SELIC', date: new Date(cursor) },
                            update: { 
                                $set: { 
                                    value: dailyPercentVal, 
                                    accumulatedFactor: 1 + dailyRateApprox // 1.0004...
                                } 
                            },
                            upsert: true
                        }
                    });
                }
                cursor.setDate(cursor.getDate() + 1);
            }

            if (operations.length > 0) {
                await EconomicIndex.bulkWrite(operations);
                logger.info(`✅ [Macro] ${operations.length} registros sintéticos gerados com sucesso.`);
            } else {
                logger.info(`✅ [Macro] Base sintética já atualizada.`);
            }

        } catch (e) {
            logger.error(`❌ [Macro] Falha no Fallback Sintético: ${e.message}`);
        }
    },

    async processDailyData(dataList) {
        if (!Array.isArray(dataList)) return;
        
        const operations = dataList.map(item => {
            const [d, m, y] = item.data.split('/');
            const dateIso = new Date(`${y}-${m}-${d}`);
            const val = parseFloat(item.valor);
            const dailyFactor = 1 + (val / 100);

            return {
                updateOne: {
                    filter: { series: 'SELIC', date: dateIso },
                    update: { 
                        $set: { 
                            value: val, 
                            accumulatedFactor: dailyFactor 
                        } 
                    },
                    upsert: true
                }
            };
        });

        if (operations.length > 0) {
            await EconomicIndex.bulkWrite(operations);
        }
    },

    async updateCurrencies() {
        try {
            const res = await axios.get('https://economia.awesomeapi.com.br/last/USD-BRL,BTC-USD', { timeout: 5000 });
            const usd = parseFloat(res.data.USDBRL.bid);
            const usdChange = parseFloat(res.data.USDBRL.pctChange);
            const btcUsd = parseFloat(res.data.BTCUSD.bid);
            const btcChange = parseFloat(res.data.BTCUSD.pctChange);
            return { usd, usdChange, btcUsd, btcChange };
        } catch (error) {
            return null;
        }
    },

    cleanNumber(str) {
        if (!str) return 0;
        const cleanStr = str.replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.');
        return parseFloat(cleanStr) || 0;
    },

    parseGenericRow($, tr) {
        const cols = $(tr).find('td');
        if (cols.length < 3) return null;
        
        let title = '';
        let rate = 0;
        let maturity = '-';
        let foundPrices = [];

        cols.each((i, td) => {
            const text = $(td).text().trim().replace(/\s+/g, ' '); 
            
            if (!title && text.length > 5 && (text.includes('Tesouro') || text.includes('IPCA') || text.includes('Prefixado') || text.includes('Selic') || text.includes('Renda+'))) {
                title = text;
            } 
            else if (text.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                maturity = text;
            } 
            else if (text.includes('%')) {
                const val = this.cleanNumber(text);
                if (val > 0 && val < 25) rate = val;
            } 
            else if (text.includes('R$') || (this.cleanNumber(text) > 30)) {
                const val = this.cleanNumber(text);
                if (val > 0) foundPrices.push(val);
            }
        });

        let minInvestment = 0;
        let unitPrice = 0;

        if (foundPrices.length > 0) {
            foundPrices.sort((a, b) => a - b);
            minInvestment = foundPrices[0];
            if (foundPrices.length > 1) {
                unitPrice = foundPrices[foundPrices.length - 1];
            } else {
                unitPrice = minInvestment; 
            }
        }

        if (title && rate > 0) {
            return { title, rate, minInvestment, unitPrice, maturity };
        }
        return null;
    },

    // --- MELHORIA CRÍTICA 3: Fonte OFICIAL para taxa NTN-B (Tesouro Transparente Gov.br) ---
    // Substitui o scraping do Investidor10 como fonte primária.
    // API pública do governo: sem autenticação, sem risco de bloqueio por mudança de HTML.
    async fetchNtnbFromTesouroDireto() {
        try {
            // Tesouro Transparente CKAN API — retorna os títulos mais recentes negociados
            const resourceId = '796d2059-14e9-44e3-80a7-de3269fd8229';
            const url = `https://www.tesourotransparente.gov.br/ckan/api/3/action/datastore_search?resource_id=${resourceId}&limit=100&sort=Data%20Venda%20desc`;

            const res = await axios.get(url, {
                headers: { ...BASE_HEADERS, 'Accept': 'application/json' },
                httpsAgent: bcbAgent,
                timeout: 12000
            });

            const records = res.data?.result?.records || [];
            if (records.length === 0) return null;

            // Procura NTN-B longa: IPCA+ com vencimento >= 2035
            const longMaturityYears = [2035, 2040, 2045, 2050, 2055];
            let ntnbRate = null;

            for (const year of longMaturityYears) {
                const bond = records.find(r =>
                    r['Tipo Titulo']?.includes('IPCA+') &&
                    r['Tipo Titulo']?.includes(String(year))
                );
                if (bond) {
                    // Taxa Venda Manhã é o que o investidor paga — mais conservador para benchmark
                    const rate = parseFloat(bond['Taxa Venda Manha'] ?? bond['Taxa Compra Manha'] ?? 0);
                    if (rate > 3 && rate < 20) {
                        ntnbRate = rate;
                        logger.debug(`🏛️ [NTN-B] Fonte oficial (Tesouro Transparente): ${rate}% a.a. (IPCA+ ${year})`);
                        break;
                    }
                }
            }
            return ntnbRate;
        } catch (error) {
            logger.debug(`[NTN-B] Fonte oficial indisponível (${error.message}). Usando Investidor10.`);
            return null;
        }
    },

    async scrapeInvestidor10() {
        const bonds = [];
        try {
            const url = 'https://investidor10.com.br/tesouro-direto/';
            const scrapingHeaders = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Upgrade-Insecure-Requests': '1'
            };

            const res = await axios.get(url, { 
                headers: scrapingHeaders, 
                httpsAgent: scrapingAgent, 
                timeout: 25000 
            });
            
            const $ = cheerio.load(res.data);
            $('tr').each((i, tr) => {
                const data = this.parseGenericRow($, tr);
                if (data) {
                    data.source = 'Investidor10';
                    bonds.push(data);
                }
            });
        } catch (error) {
            // Silencioso
        }
        return bonds;
    },

    async updateTreasuryRates() {
        // Cadeia de prioridade para NTN-B:
        // 1. Tesouro Transparente (API oficial gov.br)
        // 2. Investidor10 (scraping — fallback)
        // 3. Hardcoded 6.00% (emergência)
        let ntnbLongRate = 6.00;

        const officialRate = await this.fetchNtnbFromTesouroDireto();
        if (officialRate) {
            ntnbLongRate = officialRate;
        }

        // Scraping do Investidor10 mantido para popular a tabela de títulos do frontend
        // mesmo quando a taxa NTN-B já foi obtida pela fonte oficial
        const list = await this.scrapeInvestidor10();
        if (!officialRate && list.length === 0) {
            logger.warn(`⚠️ [Tesouro] Ambas as fontes falharam. Usando fallback hardcoded: ${ntnbLongRate}%`);
        }
        
        const uniqueBondsMap = new Map();

        list.forEach(bond => {
            const cleanTitle = bond.title.replace(/\s+/g, ' ').trim();
            
            let type = 'IPCA';
            let index = 'IPCA';
            if (cleanTitle.includes('Prefixado') || cleanTitle.includes('LTN')) { type = 'PREFIXADO'; index = 'PRE'; }
            else if (cleanTitle.includes('Selic') || cleanTitle.includes('LFT')) { type = 'SELIC'; index = 'SELIC'; }
            else if (cleanTitle.includes('Renda+')) { type = 'RENDAMAIS'; }
            else if (cleanTitle.includes('Educa+')) { type = 'EDUCA'; }
            
            // Só usa taxa do scraping se a fonte oficial não conseguiu a taxa
            if (!officialRate && type === 'IPCA' && (cleanTitle.includes('2035') || cleanTitle.includes('2045'))) {
                if (bond.rate > 4) {
                    ntnbLongRate = bond.rate;
                    logger.info(`🏛️ [NTN-B] Fonte fallback (Investidor10): ${bond.rate}% a.a.`);
                }
            }

            if (!uniqueBondsMap.has(cleanTitle)) {
                uniqueBondsMap.set(cleanTitle, {
                    title: cleanTitle,
                    type,
                    index,
                    rate: bond.rate,
                    minInvestment: bond.minInvestment, 
                    unitPrice: bond.unitPrice, 
                    maturityDate: bond.maturity,
                    updatedAt: new Date()
                });
            }
        });
        
        const uniqueBonds = Array.from(uniqueBondsMap.values());

        if (uniqueBonds.length >= 5) {
            const operations = uniqueBonds.map(bond => ({
                updateOne: {
                    filter: { title: bond.title },
                    update: { $set: bond },
                    upsert: true
                }
            }));

            await TreasuryBond.bulkWrite(operations);
            logger.debug(`🏛️ [Tesouro Direto] Atualizado com sucesso: ${uniqueBonds.length} títulos.`);
        } 
        
        return { ntnbLong: ntnbLongRate };
    },

    // Busca e armazena série histórica diária de USD/BRL (últimos 2 anos)
    // Usada por financialService.rebuildUserHistory() para converter USD corretamente por data
    async syncHistoricalUSDRate() {
        try {
            logger.info('💱 [Câmbio] Sincronizando histórico USD/BRL...');

            // AwesomeAPI: /daily/USD-BRL/730 retorna os últimos 730 dias úteis
            const res = await axios.get('https://economia.awesomeapi.com.br/json/daily/USD-BRL/730', {
                headers: BASE_HEADERS,
                timeout: 10000
            });

            if (!res.data || !Array.isArray(res.data) || res.data.length === 0) {
                logger.warn('⚠️ [Câmbio] AwesomeAPI não retornou dados históricos. Tentando fallback Yahoo Finance...');
                await this._syncHistoricalUSDRateYahoo();
                return;
            }

            // AwesomeAPI retorna do mais recente para o mais antigo
            const historyEntries = res.data
                .filter(d => d.bid && parseFloat(d.bid) > 0)
                .map(d => {
                    // timestamp em segundos → Date → YYYY-MM-DD
                    const dateStr = new Date(parseInt(d.timestamp) * 1000).toISOString().split('T')[0];
                    return {
                        date: dateStr,
                        close: parseFloat(d.bid),
                        adjClose: parseFloat(d.bid)
                    };
                });

            if (historyEntries.length === 0) {
                logger.warn('⚠️ [Câmbio] Nenhuma entrada válida na resposta da AwesomeAPI.');
                return;
            }

            // Remover duplicatas por data (manter mais recente)
            const byDate = {};
            for (const entry of historyEntries) {
                if (!byDate[entry.date]) byDate[entry.date] = entry;
            }
            const deduped = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

            await AssetHistory.findOneAndUpdate(
                { ticker: 'USD-BRL' },
                {
                    $set: {
                        ticker: 'USD-BRL',
                        history: deduped,
                        lastUpdated: new Date()
                    }
                },
                { upsert: true, new: true }
            );

            logger.debug(`✅ [Câmbio] Histórico USD/BRL atualizado: ${deduped.length} dias.`);
        } catch (error) {
            logger.error(`❌ [Câmbio] Erro ao sincronizar histórico USD/BRL: ${error.message}`);
            // Tenta fallback via Yahoo Finance (BRL=X)
            try {
                await this._syncHistoricalUSDRateYahoo();
            } catch (e) {
                logger.error(`❌ [Câmbio] Fallback Yahoo também falhou: ${e.message}`);
            }
        }
    },

    async _syncHistoricalUSDRateYahoo() {
        const history = await externalMarketService.getFullHistory('USD-BRL', 'CURRENCY');
        if (!history || history.length === 0) return;

        await AssetHistory.findOneAndUpdate(
            { ticker: 'USD-BRL' },
            { $set: { ticker: 'USD-BRL', history, lastUpdated: new Date() } },
            { upsert: true, new: true }
        );
        logger.debug(`✅ [Câmbio] Histórico USD/BRL via Yahoo: ${history.length} dias.`);
    },

    async performMacroSync() {
        // Sequência blindada: Oficial -> Histórico (com Fallback) -> Moedas -> Índices -> Tesouro
        const official = await this.updateOfficialRates();
        
        // Esta função agora tem Try/Catch interno e Fallback Sintético, não deve quebrar
        await this.syncDailyEconomicIndexes(); 

        const currencies = await this.updateCurrencies();
        
        const globalIndices = await externalMarketService.getGlobalIndices(); 
        const spxReturn12m = await externalMarketService.getSpx12mReturn(); 
        const ibovReturn12m = await externalMarketService.getIbov12mReturn(); 
        
        const treasury = await this.updateTreasuryRates(); 

        let config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        if (!config) config = new SystemConfig({ key: 'MACRO_INDICATORS' });

        if (official) {
            config.selic = official.selic;
            config.ipca = official.ipca;
            config.cdi = official.cdi;
            if (official.cdi12m) {
                config.cdiReturn12m = official.cdi12m;
            }
            config.riskFree = official.selic;

            // Observabilidade: marca a fonte efetiva de cada taxa e se houve fallback.
            // ratesUpdatedAt só é carimbado quando NADA veio do fallback hardcoded.
            config.ratesStale = !!official.isFallback;
            config.ratesSources = official.sources || { selic: null, ipca: null };
            if (!official.isFallback) {
                config.ratesUpdatedAt = new Date();
            }
        }
        
        if (currencies) {
            config.dollar = currencies.usd;
            config.dollarChange = currencies.usdChange;
            config.btc = currencies.btcUsd;
            config.btcChange = currencies.btcChange;
        }
        
        if (globalIndices) {
            if (globalIndices.ibov) {
                config.ibov = globalIndices.ibov.value;
                config.ibovChange = globalIndices.ibov.change;
            }
            if (globalIndices.spx) {
                config.spx = globalIndices.spx.value;
                config.spxChange = globalIndices.spx.change;
            }
        }

        if (spxReturn12m) config.spxReturn12m = spxReturn12m;
        if (ibovReturn12m) config.ibovReturn12m = ibovReturn12m;

        if (treasury && treasury.ntnbLong) config.ntnbLong = treasury.ntnbLong;

        config.lastUpdated = new Date();
        await config.save();
        
        return config;
    }
};
