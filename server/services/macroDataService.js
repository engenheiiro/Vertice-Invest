
import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';
import SystemConfig from '../models/SystemConfig.js';
import TreasuryBond from '../models/TreasuryBond.js';
import logger from '../config/logger.js';
import { externalMarketService } from './externalMarketService.js';

// 432 = Selic Meta AA
// 13522 = IPCA 12m
// 4389 = CDI Mensal % (Para cálculo preciso do acumulado)
const SERIES_BCB = { SELIC_META: 432, IPCA_12M: 13522, CDI_MONTHLY: 4389 };

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1'
};

const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

export const macroDataService = {
    
    // --- 1. INDICADORES MACRO (OFICIAIS) ---
    async updateOfficialRates() {
        try {
            // 1. Selic Meta (Atual)
            const selicRes = await axios.get(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES_BCB.SELIC_META}/dados/ultimos/1?formato=json`);
            const selicVal = selicRes.data[0]?.valor ? parseFloat(selicRes.data[0].valor) : 11.25;
            
            // 2. IPCA 12 Meses
            let ipcaVal = 4.50;
            try {
                const ipcaRes = await axios.get(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES_BCB.IPCA_12M}/dados/ultimos/1?formato=json`);
                if (ipcaRes.data[0]?.valor) {
                    ipcaVal = parseFloat(ipcaRes.data[0].valor);
                }
            } catch (e) { logger.warn("⚠️ Falha ao buscar IPCA (Usando fallback)"); }

            // 3. CDI Acumulado 12 Meses (Cálculo Real)
            let cdiAccumulated12m = 11.20; // Fallback realista
            try {
                // Busca últimos 12 meses de CDI Mensal
                const cdiRes = await axios.get(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES_BCB.CDI_MONTHLY}/dados/ultimos/12?formato=json`);
                if (cdiRes.data && cdiRes.data.length > 0) {
                    let accFactor = 1.0;
                    cdiRes.data.forEach(month => {
                        const val = parseFloat(month.valor);
                        if (!isNaN(val)) {
                            accFactor *= (1 + (val / 100));
                        }
                    });
                    cdiAccumulated12m = (accFactor - 1) * 100;
                    logger.info(`✅ [MACRO] CDI 12m Calculado: ${cdiAccumulated12m.toFixed(2)}% (Baseado em ${cdiRes.data.length} meses)`);
                }
            } catch (e) {
                logger.warn(`⚠️ Falha ao calcular CDI 12m: ${e.message}`);
            }

            // Taxa DI diária projetada (aprox Selic - 0.10)
            const cdiDailyRate = Math.max(0, selicVal - 0.10);

            return { 
                selic: selicVal, 
                ipca: ipcaVal, 
                cdi: cdiDailyRate,
                cdi12m: cdiAccumulated12m 
            };

        } catch (error) {
            logger.error(`❌ Erro BCB API: ${error.message}`);
            return { selic: 11.25, ipca: 4.50, cdi: 11.15, cdi12m: 11.20 }; 
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
            if (error.response && error.response.status === 429) {
                logger.warn("⚠️ Rate Limit (429) na AwesomeAPI. Mantendo valores anteriores.");
            } else {
                logger.error("Erro ao buscar moedas (AwesomeAPI): " + error.message);
            }
            return null; // Retorna null para manter dados do banco
        }
    },

    // --- HELPER DE LIMPEZA ---
    cleanNumber(str) {
        if (!str) return 0;
        const cleanStr = str.replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.');
        return parseFloat(cleanStr) || 0;
    },

    // --- 2. PARSER GENÉRICO (REGEX) ---
    parseGenericRow($, tr) {
        const cols = $(tr).find('td');
        if (cols.length < 3) return null;

        let title = '';
        let rate = 0;
        let price = 0;
        let maturity = '-';

        cols.each((i, td) => {
            const text = $(td).text().trim().replace(/\s+/g, ' '); 
            
            // 1. Título
            if (!title && text.length > 5 && (text.includes('Tesouro') || text.includes('IPCA') || text.includes('Prefixado') || text.includes('Selic') || text.includes('Renda+'))) {
                title = text;
            }
            // 2. Data
            else if (text.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                maturity = text;
            }
            // 3. Taxa
            else if (text.includes('%')) {
                const val = this.cleanNumber(text);
                if (val > 0 && val < 25) rate = val;
            }
            // 4. Preço
            else if (text.includes('R$') || (this.cleanNumber(text) > 30)) {
                const val = this.cleanNumber(text);
                if (val > 0) price = val;
            }
        });

        if (title && rate > 0) {
            return { title, rate, price, maturity };
        }
        return null;
    },

    // --- 3. SCRAPER INVESTIDOR 10 ---
    async scrapeInvestidor10() {
        const bonds = [];
        try {
            logger.info("🔍 [Tesouro] Lendo Investidor10...");
            const url = 'https://investidor10.com.br/tesouro-direto/';
            const res = await axios.get(url, { headers: BROWSER_HEADERS, httpsAgent, timeout: 15000 });
            const $ = cheerio.load(res.data);

            $('tr').each((i, tr) => {
                const data = this.parseGenericRow($, tr);
                if (data) {
                    data.source = 'Investidor10';
                    bonds.push(data);
                }
            });
            logger.info(`✅ Investidor10: ${bonds.length} títulos encontrados.`);
        } catch (error) {
            logger.error(`❌ Investidor10 Falhou: ${error.message}`);
        }
        return bonds;
    },

    // --- ORQUESTRADOR ---
    async updateTreasuryRates() {
        let ntnbLongRate = 6.00;
        
        const list = await this.scrapeInvestidor10();

        const uniqueBonds = [];
        const seenTitles = new Set();

        list.forEach(bond => {
            const cleanTitle = bond.title.replace(/\s+/g, ' ').trim();
            const key = cleanTitle.toLowerCase().replace(/\s+/g, '').replace('jurossemestrais', '');
            
            if (!seenTitles.has(key)) {
                let type = 'IPCA';
                let index = 'IPCA';
                if (cleanTitle.includes('Prefixado') || cleanTitle.includes('LTN')) { type = 'PREFIXADO'; index = 'PRE'; }
                else if (cleanTitle.includes('Selic') || cleanTitle.includes('LFT')) { type = 'SELIC'; index = 'SELIC'; }
                else if (cleanTitle.includes('Renda+')) { type = 'RENDAMAIS'; }
                else if (cleanTitle.includes('Educa+')) { type = 'EDUCA'; }

                if (type === 'IPCA' && (cleanTitle.includes('2035') || cleanTitle.includes('2045'))) {
                    if (bond.rate > 4) ntnbLongRate = bond.rate;
                }

                uniqueBonds.push({
                    title: cleanTitle,
                    type,
                    index,
                    rate: bond.rate,
                    minInvestment: bond.price, 
                    maturityDate: bond.maturity,
                    updatedAt: new Date()
                });
                seenTitles.add(key);
            }
        });

        if (uniqueBonds.length >= 5) {
            await TreasuryBond.deleteMany({});
            await TreasuryBond.insertMany(uniqueBonds);
        }

        return { 
            ntnbLong: ntnbLongRate, 
            list: uniqueBonds,
            count: uniqueBonds.length
        };
    },

    async performMacroSync() {
        logger.info("🌍 [MACRO] Iniciando atualização completa...");
        
        const official = await this.updateOfficialRates();
        const currencies = await this.updateCurrencies();
        const globalIndices = await externalMarketService.getGlobalIndices(); 
        const treasury = await this.updateTreasuryRates(); 

        // --- CÁLCULO PRECISO: SPX 12 MESES (Date-Based) ---
        let spx12mReturn = 0; 
        try {
            const historySPX = await externalMarketService.getFullHistory('^GSPC', 'INDEX'); 
            
            if (historySPX && historySPX.length > 200) {
                historySPX.sort((a, b) => new Date(a.date) - new Date(b.date));

                const current = historySPX[historySPX.length - 1].close;
                
                // Busca a data exata de 1 ano atrás (ou a mais próxima anterior)
                const today = new Date();
                const oneYearAgo = new Date();
                oneYearAgo.setFullYear(today.getFullYear() - 1);
                
                // Encontra o ponto mais próximo <= data alvo
                let pastPoint = null;
                for (let i = historySPX.length - 1; i >= 0; i--) {
                    const d = new Date(historySPX[i].date);
                    if (d <= oneYearAgo) {
                        pastPoint = historySPX[i];
                        break;
                    }
                }

                const past = pastPoint ? pastPoint.close : historySPX[0].close;
                
                if (past > 0) {
                    spx12mReturn = ((current - past) / past) * 100;
                    logger.info(`📈 S&P 500 (12m Real): ${spx12mReturn.toFixed(2)}% (Atual: ${current}, Base: ${past} em ${pastPoint ? pastPoint.date : 'N/A'})`);
                }
            } else {
                logger.warn("Histórico S&P curto demais para calc 12m.");
            }
        } catch(e) {
            logger.warn("Falha ao calcular S&P 12m: " + e.message);
        }

        let config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        if (!config) config = new SystemConfig({ key: 'MACRO_INDICATORS' });

        if (official) {
            config.selic = official.selic;
            config.ipca = official.ipca;
            config.cdi = official.cdi12m || official.cdi; // Salva o acumulado 12m na propriedade principal para exibição
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
                
                // Atualiza o retorno 12m calculado com precisão
                if (spx12mReturn !== 0) {
                    config.spxReturn12m = spx12mReturn;
                } else if (!config.spxReturn12m) {
                    // Se não tivermos dados, usa um valor aproximado de mercado
                    config.spxReturn12m = 22.5; 
                }
            }
        }

        if (treasury && treasury.ntnbLong) config.ntnbLong = treasury.ntnbLong;

        config.lastUpdated = new Date();
        await config.save();
        
        logger.info(`✅ [MACRO] Sync Finalizado. Dados persistidos.`);
        return config;
    }
};
