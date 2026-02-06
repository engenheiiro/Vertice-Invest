
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
            
            // Fallback seguro para CDI (Selic - 0.10)
            let cdiAccumulated12m = Math.max(0, selicVal - 0.10);

            // 2. IPCA 12 Meses
            let ipcaVal = 4.50;
            try {
                const ipcaRes = await axios.get(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES_BCB.IPCA_12M}/dados/ultimos/1?formato=json`);
                if (ipcaRes.data[0]?.valor) {
                    ipcaVal = parseFloat(ipcaRes.data[0].valor);
                }
            } catch (e) { /* Fallback IPCA */ }

            // 3. Tentativa de Cálculo Real do CDI 12m
            try {
                const cdiRes = await axios.get(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES_BCB.CDI_MONTHLY}/dados/ultimos/15?formato=json`);
                
                if (cdiRes.data && cdiRes.data.length > 0) {
                    const last12Months = cdiRes.data.slice(-12);
                    let accFactor = 1.0;
                    
                    last12Months.forEach(month => {
                        const valStr = month.valor;
                        if (valStr) {
                            // Tenta parsear float. Se vier "1.05", é 1.05%. Se vier "1,05", parseFloat lê 1.
                            // Mas a API do BCB JSON padrão retorna ponto.
                            const val = parseFloat(valStr);
                            if (!isNaN(val)) {
                                accFactor *= (1 + (val / 100));
                            }
                        }
                    });
                    
                    const calculatedCDI = (accFactor - 1) * 100;

                    // Validação de Sanidade: CDI deve estar próximo da Selic (entre 0.5x e 1.5x)
                    if (calculatedCDI > (selicVal * 0.5) && calculatedCDI < (selicVal * 1.5)) {
                        cdiAccumulated12m = calculatedCDI;
                    } 
                }
            } catch (e) {
                // Silencioso: Se falhar, usa o fallback definido no início (Selic - 0.10)
            }

            return { 
                selic: selicVal, 
                ipca: ipcaVal, 
                cdi: Math.max(0, selicVal - 0.10), // CDI Diário/Meta
                cdi12m: cdiAccumulated12m // CDI Acumulado Real
            };

        } catch (error) {
            logger.error(`❌ Erro BCB API Crítico: ${error.message}`);
            return { selic: 11.25, ipca: 4.50, cdi: 11.15, cdi12m: 11.15 }; 
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
            // Silencia erro de rate limit para não poluir logs
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
        let price = 0;
        let maturity = '-';

        cols.each((i, td) => {
            const text = $(td).text().trim().replace(/\s+/g, ' '); 
            
            if (!title && text.length > 5 && (text.includes('Tesouro') || text.includes('IPCA') || text.includes('Prefixado') || text.includes('Selic') || text.includes('Renda+'))) {
                title = text;
            } else if (text.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                maturity = text;
            } else if (text.includes('%')) {
                const val = this.cleanNumber(text);
                if (val > 0 && val < 25) rate = val;
            } else if (text.includes('R$') || (this.cleanNumber(text) > 30)) {
                const val = this.cleanNumber(text);
                if (val > 0) price = val;
            }
        });

        if (title && rate > 0) {
            return { title, rate, price, maturity };
        }
        return null;
    },

    async scrapeInvestidor10() {
        const bonds = [];
        try {
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
        } catch (error) {
            logger.error(`❌ Investidor10 Falhou: ${error.message}`);
        }
        return bonds;
    },

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

        return { ntnbLong: ntnbLongRate };
    },

    async performMacroSync() {
        const official = await this.updateOfficialRates();
        const currencies = await this.updateCurrencies();
        const globalIndices = await externalMarketService.getGlobalIndices(); 
        const treasury = await this.updateTreasuryRates(); 

        let config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        if (!config) config = new SystemConfig({ key: 'MACRO_INDICATORS' });

        if (official) {
            config.selic = official.selic;
            config.ipca = official.ipca;
            config.cdi = official.cdi12m || official.cdi; 
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

        if (treasury && treasury.ntnbLong) config.ntnbLong = treasury.ntnbLong;

        config.lastUpdated = new Date();
        await config.save();
        
        return config;
    }
};
