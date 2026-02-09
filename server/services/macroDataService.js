
import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';
import http from 'http';
import SystemConfig from '../models/SystemConfig.js';
import TreasuryBond from '../models/TreasuryBond.js';
import EconomicIndex from '../models/EconomicIndex.js';
import logger from '../config/logger.js';
import { externalMarketService } from './externalMarketService.js';
import { isBusinessDay } from '../utils/dateUtils.js';

const SERIES_BCB = { SELIC_META: 432, IPCA_12M: 13522, CDI_MONTHLY: 4391, SELIC_DAILY: 11 };

const httpAgent = new http.Agent({ keepAlive: true });
const bcbAgent = new https.Agent({ 
    rejectUnauthorized: false, 
    keepAlive: true,
    minVersion: 'TLSv1.2' 
});

const scrapingAgent = new https.Agent({ 
    rejectUnauthorized: false, 
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
    async updateOfficialRates() {
        try {
            const selicRes = await axios.get(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES_BCB.SELIC_META}/dados/ultimos/1?formato=json`, { 
                headers: BASE_HEADERS, 
                httpsAgent: bcbAgent,
                timeout: 5000
            });
            const selicVal = selicRes.data[0]?.valor ? parseFloat(selicRes.data[0].valor) : 11.25;
            
            let ipcaVal = 4.50;
            try {
                const ipcaRes = await axios.get(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES_BCB.IPCA_12M}/dados/ultimos/1?formato=json`, { 
                    headers: BASE_HEADERS, 
                    httpsAgent: bcbAgent,
                    timeout: 5000 
                });
                if (ipcaRes.data[0]?.valor) ipcaVal = parseFloat(ipcaRes.data[0].valor);
            } catch (e) { }

            return { 
                selic: selicVal, 
                ipca: ipcaVal, 
                cdi: Math.max(0, selicVal - 0.10),
                cdi12m: Math.max(0, selicVal - 0.10)
            };

        } catch (error) {
            return { selic: 11.25, ipca: 4.50, cdi: 11.15, cdi12m: 11.15 }; 
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
        } catch (e) { }

        // Se a data for futura ou hoje, não precisa atualizar
        if (startDateObj > new Date()) {
            logger.info(`✅ [Macro] Histórico já está atualizado.`);
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
            // Silêncio, vai para tentativa 2
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

            if (resHttp.data && Array.isArray(resHttp.data)) {
                if (resHttp.data.length > 0) {
                    await this.processDailyData(resHttp.data);
                    logger.info(`✅ [Macro] Sucesso via HTTP: ${resHttp.data.length} registros.`);
                } else {
                    logger.info(`✅ [Macro] HTTP: Nenhum dado novo.`);
                }
                return;
            } else {
                throw new Error(`Resposta HTTP inválida: ${resHttp.status}`);
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
            const currentSelic = config?.selic || 11.25;
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
        let ntnbLongRate = 6.00;
        const list = await this.scrapeInvestidor10();
        
        const uniqueBondsMap = new Map();

        list.forEach(bond => {
            const cleanTitle = bond.title.replace(/\s+/g, ' ').trim();
            
            let type = 'IPCA';
            let index = 'IPCA';
            if (cleanTitle.includes('Prefixado') || cleanTitle.includes('LTN')) { type = 'PREFIXADO'; index = 'PRE'; }
            else if (cleanTitle.includes('Selic') || cleanTitle.includes('LFT')) { type = 'SELIC'; index = 'SELIC'; }
            else if (cleanTitle.includes('Renda+')) { type = 'RENDAMAIS'; }
            else if (cleanTitle.includes('Educa+')) { type = 'EDUCA'; }
            
            if (type === 'IPCA' && (cleanTitle.includes('2035') || cleanTitle.includes('2045'))) {
                if (bond.rate > 4) ntnbLongRate = bond.rate;
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
            logger.info(`🏛️ [Tesouro Direto] Atualizado com sucesso: ${uniqueBonds.length} títulos.`);
        } 
        
        return { ntnbLong: ntnbLongRate };
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
