
import axios from 'axios';
import * as cheerio from 'cheerio';
import SystemConfig from '../models/SystemConfig.js';
import TreasuryBond from '../models/TreasuryBond.js';
import logger from '../config/logger.js';

// IDs das Séries no Banco Central (SGS)
const SERIES_BCB = {
    SELIC_META: 432,
    IPCA_12M: 13522 // IPCA acumulado 12 meses
};

export const macroDataService = {
    
    // 1. Busca SELIC e IPCA do Banco Central (API Oficial)
    async updateOfficialRates() {
        try {
            // Busca Selic Meta Atual
            const selicRes = await axios.get(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES_BCB.SELIC_META}/dados/ultimos/1?formato=json`);
            const selicVal = selicRes.data[0]?.valor ? parseFloat(selicRes.data[0].valor) : 11.25;

            // Busca IPCA 12m
            let ipcaVal = 4.50;
            try {
                const ipcaRes = await axios.get(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES_BCB.IPCA_12M}/dados/ultimos/1?formato=json`);
                if (ipcaRes.data[0]?.valor) ipcaVal = parseFloat(ipcaRes.data[0].valor);
            } catch (e) { logger.warn("⚠️ Falha ao buscar IPCA (Usando fallback ou anterior)"); }

            // CDI costuma ser Selic - 0.10
            const cdiVal = Math.max(0, selicVal - 0.10);

            return { selic: selicVal, ipca: ipcaVal, cdi: cdiVal };
        } catch (error) {
            logger.error(`❌ Erro BCB API: ${error.message}`);
            return null;
        }
    },

    // 2. Busca Dólar e Bitcoin (AwesomeAPI)
    async updateCurrencies() {
        try {
            const res = await axios.get('https://economia.awesomeapi.com.br/last/USD-BRL,BTC-BRL');
            const usd = parseFloat(res.data.USDBRL.bid);
            const btcBrl = parseFloat(res.data.BTCBRL.bid);
            return { usd, btcBrl };
        } catch (error) {
            logger.error(`❌ Erro AwesomeAPI: ${error.message}`);
            return null;
        }
    },

    // 3. Busca Títulos do Tesouro (Scraper Investidor10) e Salva no Banco
    async updateTreasuryRates() {
        try {
            logger.info("🔍 Iniciando Scraper de Títulos do Tesouro...");
            
            const res = await axios.get('https://investidor10.com.br/tesouro-direto/', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html'
                },
                timeout: 15000
            });

            const $ = cheerio.load(res.data);
            const bondsToSave = [];
            let ntnbLongRate = 6.30; // Valor default para o SystemConfig (Valuation)

            // Seletor genérico para tabelas no Investidor10
            $('table tbody tr').each((i, el) => {
                const cols = $(el).find('td');
                if (cols.length < 3) return;

                const name = $(cols[0]).text().trim(); // Ex: Tesouro IPCA+ 2035
                const rateText = $(cols[1]).text().trim(); // Ex: IPCA + 6,28%
                const minInvText = $(cols[2]).text().trim(); // Ex: R$ 32,50
                const maturity = $(cols[3]).text().trim(); // Ex: 15/05/2035

                // Limpeza e Parse
                if (!name || !rateText.includes('%')) return;

                // Identifica Tipo e Indexador
                let type = 'IPCA';
                let index = 'IPCA';
                let rateVal = 0;

                if (name.includes('Prefixado')) { type = 'PREFIXADO'; index = 'PRE'; }
                else if (name.includes('Selic')) { type = 'SELIC'; index = 'SELIC'; }
                else if (name.includes('Renda+')) { type = 'RENDAMAIS'; }
                else if (name.includes('Educa+')) { type = 'EDUCA'; }

                // Extrai taxa numérica
                // Ex: "IPCA + 6,28%" -> Pega 6.28
                // Ex: "12,50%" -> Pega 12.50
                const nums = rateText.match(/[\d,]+\.?\d*/);
                if (nums) {
                    rateVal = parseFloat(nums[0].replace('.', '').replace(',', '.'));
                }

                // Extrai Investimento Minimo
                const minInvVal = parseFloat(minInvText.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;

                // Lógica para capturar a taxa de referência para valuation (IPCA+ Longo)
                // Preferência pelo IPCA+ 2035 ou 2045
                if (name.includes('IPCA+') && !name.includes('Juros Semestrais') && !name.includes('Renda+') && !name.includes('Educa+')) {
                    if (name.includes('2035') || name.includes('2045')) {
                        if (rateVal > 0) ntnbLongRate = rateVal;
                    }
                }

                bondsToSave.push({
                    updateOne: {
                        filter: { title: name },
                        update: {
                            $set: {
                                type,
                                index,
                                rate: rateVal,
                                minInvestment: minInvVal,
                                maturityDate: maturity,
                                updatedAt: new Date()
                            }
                        },
                        upsert: true
                    }
                });
            });

            if (bondsToSave.length > 0) {
                await TreasuryBond.bulkWrite(bondsToSave);
                logger.info(`✅ ${bondsToSave.length} Títulos do Tesouro atualizados no Banco.`);
            } else {
                logger.warn("⚠️ Nenhum título encontrado na tabela do scraper.");
            }

            return { ntnbLong: ntnbLongRate, count: bondsToSave.length };

        } catch (error) {
            logger.error(`❌ Erro Scraper Tesouro: ${error.message}`);
            return { ntnbLong: 6.30, count: 0 };
        }
    },

    // 4. Executa a atualização completa
    async performMacroSync() {
        logger.info("🌍 [MACRO] Iniciando atualização de indicadores econômicos...");
        
        const official = await this.updateOfficialRates();
        const currencies = await this.updateCurrencies();
        const treasury = await this.updateTreasuryRates();

        // Busca configuração atual para fazer merge
        let config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        if (!config) {
            config = new SystemConfig({ key: 'MACRO_INDICATORS' });
        }

        if (official) {
            config.selic = official.selic;
            config.ipca = official.ipca;
            config.cdi = official.cdi;
            config.riskFree = official.selic; 
        }

        if (currencies) {
            config.dollar = currencies.usd;
        }

        if (treasury && treasury.ntnbLong) {
            config.ntnbLong = treasury.ntnbLong;
        }

        config.lastUpdated = new Date();
        await config.save();
        
        logger.info(`✅ [MACRO] Sync Finalizado. NTN-B Ref: ${config.ntnbLong}%`);
        return config;
    }
};
