/**
 * Leitura das fontes de data de pagamento — B3 e Fundamentus.
 *
 * O que estes testes protegem não é "o parser funciona", é a diferença entre
 * PERDER cobertura e GRAVAR data errada. Três armadilhas reais, todas medidas na
 * fonte em 09/09/2026:
 *
 *  · a B3 usa `31/12/9999` como "sem data com" (visto em SHUL4). Aceitar isso
 *    como data válida colaria o pagamento no evento errado;
 *  · o endpoint de empresa devolve os proventos de TODAS as classes juntas, e só
 *    o ISIN separa ON de PN — sem o filtro, ITSA3 herdaria o provento da ITSA4;
 *  · as duas páginas do Fundamentus têm colunas em ordem DIFERENTE, e ler por
 *    índice fixo grava valor no campo de data quando o site mexer no layout.
 */
import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import {
    parseDataBr,
    parseValorBr,
    classeDoIsin,
    classeDoTicker,
    normalizaCashDividend,
    parseTabelaFundamentus,
} from '../services/dividendPaymentDateService.js';

const iso = (d) => (d ? d.toISOString().slice(0, 10) : null);

describe('parseDataBr', () => {
    it('lê dd/mm/aaaa como meia-noite UTC do dia', () => {
        expect(iso(parseDataBr('09/09/2026'))).toBe('2026-09-09');
        // Dia 1º é o caso que quebra quem mistura fuso: em BRT ainda é o mês anterior.
        expect(iso(parseDataBr('01/01/2027'))).toBe('2027-01-01');
    });

    it('recusa o sentinela 31/12/9999 que a B3 usa para "sem data com"', () => {
        expect(parseDataBr('31/12/9999')).toBeNull();
    });

    it('recusa lixo em vez de devolver Invalid Date', () => {
        for (const v of ['', null, undefined, '2026-09-09', 'a definir', '9/9/26']) {
            expect(parseDataBr(v)).toBeNull();
        }
    });
});

describe('parseValorBr', () => {
    it('lê o formato da B3 e o do Fundamentus', () => {
        expect(parseValorBr('0,10000000000')).toBeCloseTo(0.1, 10);
        expect(parseValorBr('1.234,56')).toBeCloseTo(1234.56, 6);
        expect(parseValorBr('0,10')).toBeCloseTo(0.1, 6);
    });

    it('devolve null para vazio, em vez de zero', () => {
        // Zero seria um VALOR, e valor zero casaria com qualquer coisa na conta de
        // subconjunto. Null é descartado.
        expect(parseValorBr('')).toBeNull();
        expect(parseValorBr('-')).toBeNull();
        expect(parseValorBr(null)).toBeNull();
    });
});

describe('classe do papel (ISIN × ticker)', () => {
    it('decodifica as classes que a B3 publica', () => {
        expect(classeDoIsin('BRITSAACNOR0')).toBe('ON');
        expect(classeDoIsin('BRITSAACNPR7')).toBe('PN');
        expect(classeDoIsin('BRSANBCDAM13')).toBe('UNIT');
        expect(classeDoIsin('BRPETRACNOR9')).toBe('ON');
        expect(classeDoIsin(null)).toBeNull();
    });

    it('lê a classe do sufixo do ticker', () => {
        expect(classeDoTicker('ITSA3')).toBe('ON');
        expect(classeDoTicker('ITSA4')).toBe('PN');
        expect(classeDoTicker('TAEE11')).toBe('UNIT');
        expect(classeDoTicker('PETR4')).toBe('PN');
    });

    it('devolve null para ticker fora do padrão, para o chamador não filtrar às cegas', () => {
        expect(classeDoTicker('BOVA11X')).toBeNull();
        expect(classeDoTicker('')).toBeNull();
    });

    it('ON e PN da mesma empresa NÃO se confundem', () => {
        expect(classeDoIsin('BRITSAACNOR0')).not.toBe(classeDoTicker('ITSA4'));
        expect(classeDoIsin('BRITSAACNPR7')).toBe(classeDoTicker('ITSA4'));
    });
});

describe('normalizaCashDividend — resposta da B3', () => {
    it('converte a linha real do GGRC11', () => {
        const e = normalizaCashDividend({
            assetIssued: 'BRGGRCCTF002',
            paymentDate: '09/09/2026',
            rate: '0,10000000000',
            relatedTo: '08-2026/2026',
            approvedOn: '01/09/2026',
            isinCode: 'BRGGRCCTF002',
            label: 'RENDIMENTO',
            lastDatePrior: '01/09/2026',
        });
        expect(iso(e.dataCom)).toBe('2026-09-01');
        expect(iso(e.dataPagamento)).toBe('2026-09-09');
        expect(e.valor).toBeCloseTo(0.1, 10);
        expect(e.rotulo).toBe('RENDIMENTO');
    });

    it('linha com data-com sentinela fica sem data-com, e não casa com nada depois', () => {
        const e = normalizaCashDividend({
            isinCode: 'BRSHULACNOR7', paymentDate: '10/12/2025', rate: '0,07560871400',
            label: 'JRS CAP PROPRIO', lastDatePrior: '31/12/9999',
        });
        expect(e.dataCom).toBeNull();
        expect(iso(e.dataPagamento)).toBe('2025-12-10');
    });

    it('não explode com resposta vazia ou nula', () => {
        expect(normalizaCashDividend({}).dataCom).toBeNull();
        expect(normalizaCashDividend(null).valor).toBeNull();
    });
});

describe('parseTabelaFundamentus', () => {
    const paginaFii = `
      <table id="resultado">
        <thead><tr><th>Última Data Com</th><th>Tipo</th><th>Data de Pagamento</th><th>Valor</th></tr></thead>
        <tbody>
          <tr><td>01/07/2026</td><td>Rendimento</td><td>08/07/2026</td><td>0,10</td></tr>
          <tr><td>01/06/2026</td><td>Rendimento</td><td>09/06/2026</td><td>0,10</td></tr>
        </tbody>
      </table>`;

    // A página de AÇÃO tem colunas em outra ordem: valor vem ANTES do tipo, e a
    // data-com se chama só "Data". Ler por índice fixo aqui grava valor na data.
    const paginaAcao = `
      <table id="resultado">
        <thead><tr><th>Data</th><th>Valor</th><th>Tipo</th><th>Data de Pagamento</th><th>Por quantas ações</th></tr></thead>
        <tbody>
          <tr><td>21/08/2026</td><td>0,6741</td><td>JRS CAP PROPRIO</td><td>23/11/2026</td><td>1</td></tr>
          <tr><td>21/08/2026</td><td>0,4716</td><td>DIVIDENDO</td><td>21/12/2026</td><td>1</td></tr>
        </tbody>
      </table>`;

    it('lê a tabela de FII', () => {
        const eventos = parseTabelaFundamentus(cheerio.load(paginaFii));
        expect(eventos).toHaveLength(2);
        expect(iso(eventos[0].dataCom)).toBe('2026-07-01');
        expect(iso(eventos[0].dataPagamento)).toBe('2026-07-08');
        expect(eventos[0].valor).toBeCloseTo(0.1, 6);
    });

    it('lê a tabela de AÇÃO, com as colunas em outra ordem', () => {
        const eventos = parseTabelaFundamentus(cheerio.load(paginaAcao));
        expect(eventos).toHaveLength(2);
        expect(iso(eventos[0].dataCom)).toBe('2026-08-21');
        expect(eventos[0].valor).toBeCloseTo(0.6741, 6);
        expect(iso(eventos[0].dataPagamento)).toBe('2026-11-23');
        // A prova de que não leu por índice: a segunda linha paga em outro dia.
        expect(iso(eventos[1].dataPagamento)).toBe('2026-12-21');
    });

    it('devolve null quando a coluna da data de pagamento some — fail-closed', () => {
        const semColuna = `
          <table id="resultado">
            <thead><tr><th>Data</th><th>Valor</th><th>Tipo</th></tr></thead>
            <tbody><tr><td>21/08/2026</td><td>0,67</td><td>DIVIDENDO</td></tr></tbody>
          </table>`;
        expect(parseTabelaFundamentus(cheerio.load(semColuna))).toBeNull();
    });

    it('devolve null quando a tabela não existe', () => {
        expect(parseTabelaFundamentus(cheerio.load('<p>fora do ar</p>'))).toBeNull();
    });

    it('descarta linha sem data-com em vez de inventar uma', () => {
        const comLixo = `
          <table id="resultado">
            <thead><tr><th>Última Data Com</th><th>Tipo</th><th>Data de Pagamento</th><th>Valor</th></tr></thead>
            <tbody>
              <tr><td>-</td><td>Rendimento</td><td>08/07/2026</td><td>0,10</td></tr>
              <tr><td>01/06/2026</td><td>Rendimento</td><td>09/06/2026</td><td>0,10</td></tr>
            </tbody>
          </table>`;
        const eventos = parseTabelaFundamentus(cheerio.load(comLixo));
        expect(eventos).toHaveLength(1);
        expect(iso(eventos[0].dataCom)).toBe('2026-06-01');
    });
});

/**
 * "NENHUM PROVENTO" É RESPOSTA, NÃO FALHA.
 *
 * O Fundamentus serve 200 com a frase "Nenhum provento encontrado" e sem tabela
 * nenhuma para quem não paga. No backfill de 09/09/2026 isso apareceu como
 * "layout da tabela mudou" em 14 ativos (AZUL3, LUPA3, MWET4…) — diagnóstico
 * falso, que manda consertar parser correto e ainda suja a taxa de falha da fonte
 * no painel. Distinguir os dois é o que separa alarme de ruído.
 */
describe('página sem provento × página quebrada', () => {
    const semProvento = '<body><div>Nenhum provento encontrado</div></body>';
    const quebrada = '<body><div>Portal em manutenção</div></body>';

    it('as duas chegam ao parser como "não consegui ler"', () => {
        expect(parseTabelaFundamentus(cheerio.load(semProvento))).toBeNull();
        expect(parseTabelaFundamentus(cheerio.load(quebrada))).toBeNull();
    });

    it('e a página que se declara vazia é reconhecível pelo texto', () => {
        // É esta marca que o serviço usa para devolver [] em vez de lançar.
        expect(/nenhum\s+provento\s+encontrado/i.test(cheerio.load(semProvento)('body').text())).toBe(true);
        expect(/nenhum\s+provento\s+encontrado/i.test(cheerio.load(quebrada)('body').text())).toBe(false);
    });
});
