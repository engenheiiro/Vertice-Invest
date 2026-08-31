/**
 * Matemática do funil comercial — regras puras, sem banco.
 *
 * O painel de decisão do plano de divulgação (seção 10) pede seis números:
 * cadastro, ativação, conversão em 30 dias, receita, retenção e origem. Aqui
 * ficam as REGRAS que transformam linhas cruas nesses números — separadas da
 * consulta, no mesmo espírito de `dataHealthRules.js`: um limiar sem teste é um
 * limiar que ninguém consegue recalibrar depois.
 *
 * A decisão que mais importa neste arquivo é a de MATURIDADE. Uma coorte
 * cadastrada há 9 dias não teve 30 dias para converter; mostrá-la ao lado das
 * antigas faz o mês corrente parecer sempre um desastre e leva a mexer no preço
 * por causa de um artefato do calendário. Por isso toda coorte carrega
 * `matureFor30d`, e a média só soma as maduras.
 */

import { PLAN_CATALOG } from '../config/subscription.js';
import { toDateKey } from './dateUtils.js';

/** Janela de conversão do painel: cadastro → pago em 30 dias. */
export const CONVERSION_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** '2026-08' — mesma convenção UTC de `toDateKey`, para não misturar réguas. */
export const monthKey = (date) => toDateKey(date).slice(0, 7);

export const daysBetween = (start, end) => (new Date(end) - new Date(start)) / DAY_MS;

/** Divisão que devolve `null` (não 0) quando não há base — "sem dados" e "zero
 *  por cento" levam a decisões opostas e não podem cair no mesmo símbolo. */
export const rate = (part, total) => (total > 0 ? part / total : null);

/**
 * Valor mensal equivalente de uma assinatura.
 *
 * O anual é cobrança única de 12 parcelas: contá-lo cheio no mês da compra
 * inventaria um pico de MRR e sumiria com a receita nos 11 meses seguintes.
 * Receita reconhecida = preço do ano ÷ 12.
 */
export const monthlyValueOf = (plan, cycle = 'MONTHLY') => {
    const catalogo = PLAN_CATALOG[plan];
    if (!catalogo) return 0;
    if (cycle === 'ANNUAL') return catalogo.annual === null ? 0 : catalogo.annual / 12;
    return catalogo.monthly ?? 0;
};

/**
 * Coortes por mês de cadastro.
 *
 * @param {object} p
 * @param {Array<{id: string, createdAt: Date, source?: string}>} p.users
 * @param {Map<string, Date>} p.firstAssetByUser  primeiro ativo lançado (ativação)
 * @param {Map<string, Date>} p.firstPaidByUser   primeiro pagamento aprovado
 * @param {Date} p.now
 */
export const buildCohorts = ({ users, firstAssetByUser, firstPaidByUser, now }) => {
    const porMes = new Map();

    for (const user of users) {
        const chave = monthKey(user.createdAt);
        if (!porMes.has(chave)) {
            porMes.set(chave, { monthKey: chave, signups: 0, activated: 0, paid30d: 0, paidEver: 0 });
        }
        const coorte = porMes.get(chave);
        coorte.signups += 1;

        // Ativação = primeiro ativo lançado na carteira. A conta nasce com uma
        // carteira vazia (o registro cria uma), então "tem carteira" não separa
        // ninguém — o que separa é ter colocado algo dentro.
        if (firstAssetByUser.get(user.id)) coorte.activated += 1;

        const pago = firstPaidByUser.get(user.id);
        if (pago) {
            coorte.paidEver += 1;
            if (daysBetween(user.createdAt, pago) <= CONVERSION_WINDOW_DAYS) coorte.paid30d += 1;
        }
    }

    return [...porMes.values()]
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        .map((coorte) => {
            // A coorte fecha 30 dias contados do ÚLTIMO dia do mês: enquanto o
            // membro mais novo ainda estiver dentro da janela, o mês não pode ser
            // comparado com os anteriores.
            const [ano, mes] = coorte.monthKey.split('-').map(Number);
            const fimDoMes = new Date(Date.UTC(ano, mes, 1)); // dia 1 do mês seguinte
            return {
                ...coorte,
                activationRate: rate(coorte.activated, coorte.signups),
                conversionRate: rate(coorte.paid30d, coorte.signups),
                matureFor30d: daysBetween(fimDoMes, now) >= CONVERSION_WINDOW_DAYS,
            };
        });
};

/** Média das coortes MADURAS. Sem nenhuma madura devolve null — é o estado
 *  normal de um produto novo, e fingir um número aqui seria pior que o vazio. */
export const matureAverages = (cohorts) => {
    const maduras = cohorts.filter((c) => c.matureFor30d);
    const soma = (campo) => maduras.reduce((acc, c) => acc + c[campo], 0);
    return {
        cohorts: maduras.length,
        signups: soma('signups'),
        activationRate: rate(soma('activated'), soma('signups')),
        conversionRate: rate(soma('paid30d'), soma('signups')),
    };
};

/**
 * Receita recorrente das assinaturas vivas.
 *
 * @param {Array<{plan: string, billingCycle?: string}>} assinantes já filtrados
 *        por período vigente — quem expirou não é receita, é churn.
 */
export const buildRevenue = (assinantes) => {
    const byPlan = {};
    let mrr = 0;

    for (const { plan, billingCycle } of assinantes) {
        const valor = monthlyValueOf(plan, billingCycle);
        mrr += valor;
        if (!byPlan[plan]) byPlan[plan] = { subscribers: 0, mrr: 0 };
        byPlan[plan].subscribers += 1;
        byPlan[plan].mrr += valor;
    }

    const subscribers = assinantes.length;
    return {
        subscribers,
        mrr: Math.round(mrr * 100) / 100,
        arpu: subscribers > 0 ? Math.round((mrr / subscribers) * 100) / 100 : null,
        byPlan,
    };
};

/**
 * Retenção medida por VENCIMENTO e RECOMPRA, não por cancelamento.
 *
 * Não existe `canceledAt` no modelo — `subscriptionStatus` guarda o estado atual
 * e não a data em que ele mudou. Inventar churn a partir dele contaria como
 * "saiu este mês" alguém que saiu no ano passado. O que o banco sabe de fato é
 * quando o período pago terminou e quando entrou pagamento novo:
 *
 *   perdidos  = período venceu na janela e não foi renovado (venceu → some do
 *               conjunto de vigentes; renovar empurra `validUntil` para frente)
 *   renovados = tinha PAGAMENTO anterior à janela, pagou de novo dentro dela e
 *               segue vigente. É pagamento anterior, não conta antiga: quem
 *               criou conta há meses e assina hoje pela primeira vez é venda
 *               nova, e contá-la aqui esconderia o churn atrás do crescimento.
 *
 * A base é a soma dos dois: são as assinaturas que CHEGARAM ao vencimento no
 * período. Quem só entrou agora não teve a chance de sair e não entra na conta.
 */
export const buildRetention = ({ lost, renewed, activeNow }) => {
    const base = lost + renewed;
    return {
        activeNow,
        dueInWindow: base,
        renewed,
        lost,
        churnRate: rate(lost, base),
        // Base pequena vira ruído: 1 saída em 3 vencimentos vira "33% de churn" e
        // dispara pânico. O painel mostra o número, mas marcado como não confiável.
        significant: base >= 10,
    };
};

/** Origem declarada no cadastro. `null`/vazio vira 'direto' — a maior parte do
 *  tráfego orgânico chega sem UTM, e jogar isso fora esconderia o maior balde. */
export const DIRECT_SOURCE = 'direto';

export const buildAcquisition = ({ users, firstAssetByUser, firstPaidByUser }) => {
    const porOrigem = new Map();

    for (const user of users) {
        const origem = (user.source || '').trim().toLowerCase() || DIRECT_SOURCE;
        if (!porOrigem.has(origem)) {
            porOrigem.set(origem, { source: origem, signups: 0, activated: 0, paid: 0 });
        }
        const linha = porOrigem.get(origem);
        linha.signups += 1;
        if (firstAssetByUser.get(user.id)) linha.activated += 1;
        if (firstPaidByUser.get(user.id)) linha.paid += 1;
    }

    return [...porOrigem.values()]
        .map((linha) => ({
            ...linha,
            activationRate: rate(linha.activated, linha.signups),
            conversionRate: rate(linha.paid, linha.signups),
        }))
        .sort((a, b) => b.signups - a.signups);
};
