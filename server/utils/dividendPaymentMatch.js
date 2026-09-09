/**
 * Casamento entre um provento NOSSO e o que uma fonte de calendário publica.
 *
 * POR QUE ISTO É UM MÓDULO E NÃO DUAS LINHAS NO SERVIÇO
 * As duas bases falam de datas diferentes. O Yahoo — nossa fonte de proventos —
 * publica a EX-DATE (o primeiro pregão em que o papel negocia sem o direito). A
 * B3 e o Fundamentus publicam a ÚLTIMA DATA COM (o último pregão em que ainda
 * dava direito). Uma é o pregão seguinte da outra. Medido em 09/09/2026 sobre 443
 * casamentos reais: 61% caem em +1 dia corrido e 34% em +3 (data-com na sexta,
 * ex-date na segunda), com a cauda de +2/+4/+5 nos feriados. Ancorar em "+1 dia
 * útil" é a régua; a folga de dias corridos existe só para tolerar divergência de
 * calendário entre as fontes.
 *
 * A REGRA QUE MANDA: NA DÚVIDA, NÃO DATA
 * O Yahoo agrega numa linha só o que a fonte publica em várias — e essas várias
 * pagam em DATAS DIFERENTES. Casos reais medidos:
 *
 *     PETR4 ex=24/08/2026  R$ 1,348143  → paga 23/11/2026 E 21/12/2026
 *     CMIG4 ex=24/06/2026  R$ 0,220405  → paga 30/06/2027 E 30/12/2027
 *     SHUL4 ex=30/12/2025  R$ 0,104327  → paga 25/02/2026, 30/09/2027 E 29/09/2028
 *
 * Nosso índice único é {ticker, date, type}: uma linha por ex-date. Para esses
 * eventos NÃO EXISTE "a" data de pagamento, e escolher uma delas seria inventar
 * precisão sobre dinheiro. Eles voltam como AMBIGUO, ficam com `paymentDate`
 * nulo e seguem na estimativa — que ao menos se declara estimativa na tela.
 * São 20% dos eventos de ação e 0% dos de FII.
 *
 * As três evidências que aceitamos, em ordem de força:
 *   VALOR_E_DATA  — um pagamento só, no dia certo, com o valor certo.
 *   SOMA_E_DATA   — nosso evento é a soma de um subconjunto dos pagamentos do dia,
 *                   e todos eles pagam no MESMO dia.
 *   SO_DATA       — um único pagamento no dia exato, com valor que não bate. Vale
 *                   porque não há outra coisa que ele possa ser; usada onde o
 *                   nosso valor é sabidamente aproximado (provento provisório
 *                   deduzido do gap) ou de época diferente (provento antigo que o
 *                   Yahoo ajusta por desdobramento e a fonte publica nominal).
 */
import { addBusinessDays, toDateKey } from './dateUtils.js';

const DIA_MS = 86400000;

/** Folga em dias corridos entre a ex-date e a data-com da fonte. */
export const TOLERANCIA_DIAS = 3;

/**
 * Duas leituras do mesmo pagamento divergem no arredondamento (0,109829 contra
 * 0,109744). 5% separa "mesmo provento" de "provento diferente no mesmo dia".
 */
export const TOLERANCIA_VALOR = 0.05;

/**
 * Soma de subconjunto exige mais: com vários candidatos, uma tolerância larga
 * acha combinação por acaso.
 */
export const TOLERANCIA_SOMA = 0.01;

/** Teto de candidatos na busca por subconjunto (2^10 = 1024 combinações). */
const MAX_CANDIDATOS_SUBCONJUNTO = 10;

export const DESFECHO = {
    CASADO: 'CASADO',
    AMBIGUO: 'AMBIGUO',
    SEM_EVENTO: 'SEM_EVENTO',
    SEM_DATA: 'SEM_DATA',
    VALOR_DIVERGENTE: 'VALOR_DIVERGENTE',
};

export const EVIDENCIA = {
    VALOR_E_DATA: 'VALOR_E_DATA',
    SOMA_E_DATA: 'SOMA_E_DATA',
    SO_DATA: 'SO_DATA',
};

const dia = (d) => (d ? new Date(d).getTime() : null);

/** Distância, em dias corridos, entre a ex-date e o par (data-com, data-com + 1 pregão). */
const distancia = (exTime, dataCom) => Math.min(
    Math.abs(exTime - dia(dataCom)),
    Math.abs(exTime - dia(addBusinessDays(dataCom, 1))),
);

/**
 * Casa um evento nosso com os pagamentos que a fonte publica para o mesmo papel.
 *
 * @param {{date: Date, amount: number}} nosso evento do nosso banco (ex-date).
 * @param {Array<{dataCom: Date, dataPagamento: Date|null, valor: number|null}>} eventosFonte
 * @param {{permitirSoData?: boolean}} [opcoes] `permitirSoData` libera a evidência
 *        mais fraca (um pagamento só no dia exato, valor divergente). Deixe
 *        desligado quando o valor do nosso evento for autoritativo e a divergência
 *        significar que o casamento pode estar errado.
 * @returns {{desfecho: string, dataPagamento?: Date, evidencia?: string,
 *            offsetDias?: number, datas?: string[], candidatos?: number[]}}
 */
export const matchPaymentDate = (nosso, eventosFonte = [], opcoes = {}) => {
    const { permitirSoData = false } = opcoes;
    const exTime = dia(nosso?.date);
    if (!exTime || !Array.isArray(eventosFonte)) return { desfecho: DESFECHO.SEM_EVENTO };

    const proximos = eventosFonte.filter((e) => e?.dataCom && distancia(exTime, e.dataCom) <= TOLERANCIA_DIAS * DIA_MS);
    if (proximos.length === 0) return { desfecho: DESFECHO.SEM_EVENTO };

    const nossoValor = Number(nosso.amount);
    const bate = (v, tol) => v != null && nossoValor > 0 && Math.abs(v - nossoValor) / nossoValor <= tol;
    const offset = (e) => Math.round((exTime - dia(e.dataCom)) / DIA_MS);
    const casado = (e, evidencia) => ({
        desfecho: DESFECHO.CASADO,
        dataPagamento: e.dataPagamento,
        evidencia,
        offsetDias: offset(e),
    });

    // 1) Um pagamento só, com o valor certo.
    const exatos = proximos.filter((e) => bate(e.valor, TOLERANCIA_VALOR));
    if (exatos.length === 1) {
        return exatos[0].dataPagamento
            ? casado(exatos[0], EVIDENCIA.VALOR_E_DATA)
            : { desfecho: DESFECHO.SEM_DATA };
    }
    // Vários com o mesmo valor só é ambíguo se as datas divergirem.
    if (exatos.length > 1) {
        const datas = [...new Set(exatos.map((e) => toDateKey(e.dataPagamento)).filter(Boolean))];
        if (datas.length === 1) {
            const comData = exatos.find((e) => e.dataPagamento);
            return comData ? casado(comData, EVIDENCIA.VALOR_E_DATA) : { desfecho: DESFECHO.SEM_DATA };
        }
        return { desfecho: DESFECHO.AMBIGUO, datas };
    }

    // 2) Nosso evento como SOMA de um subconjunto do que a fonte publica no dia.
    const comValor = proximos.filter((e) => e.valor > 0);
    if (comValor.length > 0 && comValor.length <= MAX_CANDIDATOS_SUBCONJUNTO) {
        const achados = [];
        for (let mask = 1; mask < (1 << comValor.length); mask += 1) {
            let soma = 0;
            const membros = [];
            for (let k = 0; k < comValor.length; k += 1) {
                if (mask & (1 << k)) { soma += comValor[k].valor; membros.push(comValor[k]); }
            }
            if (bate(soma, TOLERANCIA_SOMA)) achados.push(membros);
        }
        // Subconjuntos que apontam para o MESMO conjunto de datas são a mesma
        // resposta — contam como um só. Dois conjuntos de datas diferentes, não:
        // aí o casamento não decide nada.
        const assinatura = (m) => [...new Set(m.map((e) => toDateKey(e.dataPagamento)))].sort().join('|');
        const distintos = new Map(achados.map((m) => [assinatura(m), m]));
        if (distintos.size === 1) {
            const membros = [...distintos.values()][0];
            const datas = [...new Set(membros.map((e) => toDateKey(e.dataPagamento)).filter(Boolean))];
            if (datas.length === 1) {
                const comData = membros.find((e) => e.dataPagamento);
                return comData
                    ? casado(comData, membros.length > 1 ? EVIDENCIA.SOMA_E_DATA : EVIDENCIA.VALOR_E_DATA)
                    : { desfecho: DESFECHO.SEM_DATA };
            }
            return { desfecho: DESFECHO.AMBIGUO, datas };
        }
        if (distintos.size > 1) return { desfecho: DESFECHO.AMBIGUO, datas: [...distintos.keys()] };
    }

    // 3) Evidência fraca: um ÚNICO pagamento, no dia exato (ex-date = data-com + 1
    //    pregão, sem folga), com valor que não bate. Não há outra coisa que ele
    //    possa ser. Só é aceita quando o chamador declara que o nosso valor não é
    //    autoritativo.
    if (permitirSoData && proximos.length === 1 && proximos[0].dataPagamento) {
        const noDiaExato = dia(addBusinessDays(proximos[0].dataCom, 1)) === exTime;
        if (noDiaExato) return casado(proximos[0], EVIDENCIA.SO_DATA);
    }

    return { desfecho: DESFECHO.VALOR_DIVERGENTE, candidatos: proximos.map((e) => e.valor) };
};
