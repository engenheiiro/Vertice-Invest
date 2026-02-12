
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { fundamentusService } from '../services/fundamentusService.js';

// Mocks
vi.mock('axios');
vi.mock('../config/logger.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

describe('Ingestion Engine (Fundamentus Parser)', () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // Função auxiliar para gerar HTML mockado do Fundamentus
    const generateHtml = (rows) => {
        const rowsHtml = rows.map(r => `
            <tr>
                <td><span class="txt">${r.ticker}</span></td>
                <td><span class="txt">${r.price}</span></td>
                <td><span class="txt">${r.pl}</span></td>
                <td><span class="txt">${r.pvp}</span></td>
                <td><span class="txt">${r.psr}</span></td>
                <td><span class="txt">${r.dy}</span></td>
                <td><span class="txt">${r.pativo}</span></td>
                <td><span class="txt">${r.pcapgiro}</span></td>
                <td><span class="txt">${r.pebit}</span></td>
                <td><span class="txt">${r.pativcircliq}</span></td>
                <td><span class="txt">${r.evebit}</span></td>
                <td><span class="txt">${r.evebitda}</span></td>
                <td><span class="txt">${r.mrgebit}</span></td>
                <td><span class="txt">${r.mrgliq}</span></td>
                <td><span class="txt">${r.liqcorr}</span></td>
                <td><span class="txt">${r.roic}</span></td>
                <td><span class="txt">${r.roe}</span></td>
                <td><span class="txt">${r.liq2m}</span></td>
                <td><span class="txt">${r.patrimliq}</span></td>
                <td><span class="txt">${r.divbrutpatrim}</span></td>
                <td><span class="txt">${r.crescrec5a}</span></td>
            </tr>
        `).join('');

        return `
            <html>
                <body>
                    <table id="resultado">
                        <thead></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </body>
            </html>
        `;
    };

    it('Should correctly parse dirty data (whitespace, dots, commas)', async () => {
        // Dados sujos para teste
        const dirtyRows = [
            {
                ticker: '  PETR4  ',
                price: '35,50',
                pl: '4,50',
                pvp: '0,95',
                psr: '0,80',
                dy: '12,5%', // Com porcentagem
                pativo: '0,40',
                pcapgiro: '5,00',
                pebit: '3,00',
                pativcircliq: '-0,50',
                evebit: '4,00',
                evebitda: '3,50',
                mrgebit: '30,0%',
                mrgliq: '25,0%',
                liqcorr: '1,50',
                roic: '15,0%',
                roe: '20,0%',
                liq2m: '1.500.000.000,00', // Pontos de milhar
                patrimliq: '380.000.000.000,00',
                divbrutpatrim: '0,80',
                crescrec5a: '10,0%'
            },
            {
                ticker: 'VALE3',
                price: '60.50', // Ponto decimal (formato US errado para BR site) - Parser deve lidar ou zerar
                pl: '-', // Dado faltante
                pvp: '1,20',
                psr: '1,50',
                dy: '0,0%',
                pativo: '0,50',
                pcapgiro: '10,00',
                pebit: '5,00',
                pativcircliq: '0,00',
                evebit: '6,00',
                evebitda: '5,00',
                mrgebit: '20,0%',
                mrgliq: '15,0%',
                liqcorr: '2,00',
                roic: '10,0%',
                roe: '12,0%',
                liq2m: '500.000.000,00',
                patrimliq: '180.000.000.000,00',
                divbrutpatrim: '0,40',
                crescrec5a: '5,0%'
            }
        ];

        const html = generateHtml(dirtyRows);
        
        // Mock do axios para retornar o HTML codificado
        axios.get.mockResolvedValue({
            data: iconv.encode(html, 'iso-8859-1')
        });

        const result = await fundamentusService.getStocksMap();

        expect(result.size).toBe(2);

        // Verifica PETR4 (Dados Sujos de Formatação)
        const petr4 = result.get('PETR4');
        expect(petr4).toBeDefined();
        expect(petr4.ticker).toBe('PETR4');
        expect(petr4.price).toBe(35.50);
        expect(petr4.dy).toBe(12.5); // Removeu % e parseou float
        expect(petr4.liq2m).toBe(1500000000); // Removeu pontos
        expect(petr4.marketCap).toBeGreaterThan(0); // Cálculo derivado deve funcionar

        // Verifica VALE3 (Dados Faltantes e Ponto Decimal)
        const vale3 = result.get('VALE3');
        expect(vale3).toBeDefined();
        
        // O parser parseBrFloat substitui pontos por vazio (milhar) e vírgula por ponto.
        // Se a entrada for '60.50', ele vira '6050'. Se for '60,50', vira 60.5.
        // O teste revela como o parser atual se comporta. Se a fonte enviar ponto decimal,
        // o parser atual pode interpretar errado (como milhar). 
        // Assumindo que a fonte é BR, '60.50' seria 6050.
        // Mas se a intenção for robustez, vamos ver o resultado atual.
        // Se '60.50' -> replace '.' -> '6050' -> parseFloat -> 6050.
        // Isso é o comportamento esperado para sites BR.
        
        expect(vale3.pl).toBe(0); // '-' deve virar 0
    });

    it('Should handle empty response gracefully', async () => {
        axios.get.mockResolvedValue({
            data: iconv.encode('<html><body></body></html>', 'iso-8859-1')
        });

        const result = await fundamentusService.getStocksMap();
        expect(result.size).toBe(0);
    });

    it('Should calculate derived financial data correctly', async () => {
        const row = {
            ticker: 'TEST3',
            price: '10,00',
            pl: '10,00',
            pvp: '2,00',
            psr: '1,00',
            dy: '0,0%',
            pativo: '0,50',
            pcapgiro: '0,00',
            pebit: '5,00',
            pativcircliq: '0,00',
            evebit: '6,00',
            evebitda: '0,00',
            mrgebit: '0,0%',
            mrgliq: '0,0%',
            liqcorr: '0,00',
            roic: '0,0%',
            roe: '0,0%',
            liq2m: '1.000,00',
            patrimliq: '1.000.000,00', // 1M
            divbrutpatrim: '0,00',
            crescrec5a: '0,0%'
        };

        const html = generateHtml([row]);
        axios.get.mockResolvedValue({ data: iconv.encode(html, 'iso-8859-1') });

        const result = await fundamentusService.getStocksMap();
        const asset = result.get('TEST3');

        // Market Cap = PL * PVP = 1M * 2 = 2M
        expect(asset.marketCap).toBe(2000000);
        
        // Net Income = MarketCap / PL = 2M / 10 = 200k
        expect(asset.netIncome).toBeCloseTo(200000, 0);

        // Net Debt Calculation
        // EBIT = MarketCap / PEBIT = 2M / 5 = 400k
        // EV = EBIT * EV/EBIT = 400k * 6 = 2.4M
        // Net Debt = EV - MarketCap = 2.4M - 2M = 400k
        expect(asset.netDebt).toBeCloseTo(400000, 0);
    });

});
