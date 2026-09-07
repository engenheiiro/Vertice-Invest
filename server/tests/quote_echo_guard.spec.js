/**
 * ECO DE COTAÇÃO — preço sem sessão e sem movimento não conta como pregão.
 *
 * Existe porque em 05/09/2026 três papéis americanos morreram (AVB e EQR viraram
 * VMRK numa fusão, EA fechou capital) e só dois deles caminhavam para a baixa
 * automática. O terceiro, AVB, era o único que o Google Finance ainda "recuperava"
 * — e essa recuperação zerava `failCount`, remarcava `isActive` e empurrava
 * `updatedAt` para agora, reiniciando os três relógios que dão baixa em símbolo
 * extinto. O socorro funcionando era o que tornava o papel imortal.
 *
 * A régua tem duas forças opostas, e o teste existe para provar que nenhuma
 * venceu por completo:
 *  - severa demais tira B3SA3 do ar, que é vivo, negocia ~28 mil vezes por dia e
 *    só cota pelo Google (nenhuma fonte lhe dá `marketTime`);
 *  - frouxa demais mantém papel morto com preço congelado no ranking para sempre.
 */
import { describe, it, expect } from 'vitest';
import { marketDataService } from '../services/marketDataService.js';

const eco = (quote, asset) => marketDataService.isEchoQuote(quote, asset);

describe('fonte que data a sessão', () => {
    it('nunca é eco, mesmo repetindo o preço', () => {
        // Yahoo e Brapi carimbam `marketTime`; ali quem responde pela idade do
        // dado é `priceDate`, e um papel pode fechar duas vezes no mesmo valor.
        expect(eco({ price: 10, marketTime: new Date() }, { lastPrice: 10 })).toBe(false);
    });
});

describe('fonte sem data de sessão (scraping do Google)', () => {
    it('preço idêntico ao gravado é eco', () => {
        expect(eco({ price: 184.06 }, { lastPrice: 184.06 })).toBe(true);
    });

    it('preço que se moveu é negócio novo', () => {
        expect(eco({ price: 184.07 }, { lastPrice: 184.06 })).toBe(false);
    });

    it('ativo sem preço guardado não tem base de comparação — passa', () => {
        expect(eco({ price: 12.5 }, { lastPrice: 0 })).toBe(false);
        expect(eco({ price: 12.5 }, {})).toBe(false);
        expect(eco({ price: 12.5 }, null)).toBe(false);
    });

    it('compara por valor, não por tipo (o scraping devolve string)', () => {
        expect(eco({ price: '63.66' }, { lastPrice: 63.66 })).toBe(true);
    });
});

describe('guarda de entrada', () => {
    it('cotação ausente não é eco', () => {
        expect(eco(null, { lastPrice: 10 })).toBe(false);
    });
});

/**
 * O irmão do eco, para quando a fonte DATA a resposta.
 *
 * Aqui não há eco a detectar: o provedor diz de que sessão é o número, e nós
 * gravávamos assim mesmo com `updatedAt` de agora. O levantamento de 05/09/2026
 * achou 18 ativos ATIVOS servindo preço de sessões entre 10 e 1.635 dias atrás —
 * `priceDate` expunha todos desde 01/09, e nada lia o campo para este fim.
 */
describe('sessão velha demais para valer como preço de hoje', () => {
    const velho = (dias) => marketDataService.isStaleSessionQuote({
        price: 1, marketTime: new Date(Date.now() - dias * 86400000),
    });

    it('sessão de ontem é preço de hoje', () => {
        expect(velho(1)).toBe(false);
    });

    it('feriado prolongado da B3 ainda cabe na folga', () => {
        expect(velho(9)).toBe(false);
    });

    it('acima de 10 dias não é mais lacuna de pregão', () => {
        expect(velho(11)).toBe(true);
        expect(velho(500)).toBe(true);
    });

    it('sem data não é problema desta guarda — é do eco', () => {
        expect(marketDataService.isStaleSessionQuote({ price: 1 })).toBe(false);
        expect(marketDataService.isStaleSessionQuote({ price: 1, marketTime: 'lixo' })).toBe(false);
    });
});

/**
 * A terceira irmã: a fonte DATA a sessão certa e ainda assim não houve pregão.
 *
 * Buraco que as outras duas deixavam aberto, medido em 07/09/2026 a partir do
 * HGPO11 — FII liquidado, negociação encerrada na B3 em 25/05/2026, e ainda
 * assim `isActive: true`, `failCount: 0` e `updatedAt` de minutos atrás. O Yahoo
 * repete a barra diária do símbolo extinto com o mesmo fechamento e
 * `volume: 0` a cada pregão; o eco não o pega (a fonte data a resposta) e a
 * sessão velha também não (a data é de ontem). Eram 19 ativos assim, o mais
 * antigo sem negociar desde 28/01/2026.
 *
 * A régua tem as mesmas duas forças opostas do eco: severa demais mata papel
 * ilíquido vivo que passou um pregão sem negócio; frouxa demais deixa o morto
 * cotando para sempre. Por isso ela olha só o volume — e só o zero explícito.
 */
describe('sessão datada, mas sem negócio nenhum', () => {
    const semNegocio = (quote) => marketDataService.isNoTradeQuote(quote);
    const ontem = new Date(Date.now() - 86400000);

    it('volume zero na sessão de ontem não é prova de pregão', () => {
        expect(semNegocio({ price: 153.42, marketTime: ontem, volume: 0 })).toBe(true);
    });

    it('variação inventada não salva a barra sem negócio', () => {
        // BIPD11 chegou com +1,4% sem ter negociado desde março: o movimento do
        // preço não distingue vivo de morto aqui, só o volume distingue.
        expect(semNegocio({ price: 989.33, change: 1.4, marketTime: ontem, volume: 0 })).toBe(true);
    });

    it('sessão com negócio é sessão', () => {
        expect(semNegocio({ price: 13.95, marketTime: ontem, volume: 26704700 })).toBe(false);
        expect(semNegocio({ price: 1.12, marketTime: ontem, volume: 2000 })).toBe(false);
    });

    it('volume ausente é "não sei", não "ninguém negociou"', () => {
        // O scraping do Google não publica o campo. Tratar a ausência como zero
        // mandaria para a baixa justamente o papel que a outra guarda protege.
        expect(semNegocio({ price: 10, marketTime: ontem })).toBe(false);
        expect(semNegocio({ price: 10, marketTime: ontem, volume: null })).toBe(false);
    });

    it('sem data não é problema desta guarda — é do eco', () => {
        expect(semNegocio({ price: 10, volume: 0 })).toBe(false);
    });

    it('cotação ausente não é sessão vazia', () => {
        expect(semNegocio(null)).toBe(false);
    });
});
