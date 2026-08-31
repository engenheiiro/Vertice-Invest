/**
 * Funil comercial — leitura do nosso próprio banco.
 *
 * O Google Analytics só enxerga quem aceitou o cookie de medição (ver
 * utils/analyticsConsent no client): serve para saber DE ONDE vem a visita,
 * nunca para contar quantas contas viraram assinatura. Fundo de funil — cadastro,
 * ativação, conversão, receita e retenção — sai daqui, onde todo mundo aparece
 * porque é registro do serviço, não medição opcional.
 *
 * As regras moram em utils/funnelMath.js. Este arquivo só busca as linhas cruas
 * e as entrega no formato que aquelas regras esperam.
 */

import mongoose from 'mongoose';
import User from '../models/User.js';
import UserAsset from '../models/UserAsset.js';
import Transaction from '../models/Transaction.js';
import {
    CONVERSION_WINDOW_DAYS,
    buildAcquisition,
    buildCohorts,
    buildRetention,
    buildRevenue,
    matureAverages,
} from '../utils/funnelMath.js';
import logger from '../config/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 36;

/** Primeiro dia (UTC) do mês que abre a janela de coortes. */
const inicioDaJanela = (now, months) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    return d;
};

/**
 * Data de criação sem depender de campo: o `_id` do Mongo carrega o timestamp.
 * `UserAsset` não tem `createdAt`, e não daria para saber a data de ativação de
 * ninguém que já existe — a alternativa seria uma migração para descobrir algo
 * que o banco já sabe.
 */
const DATA_DO_ID = { $toDate: '$_id' };

const primeiroPorUsuario = async (Model, { desde, extra = {} } = {}) => {
    const linhas = await Model.aggregate([
        { $match: { ...extra } },
        { $group: { _id: '$user', at: { $min: DATA_DO_ID } } },
        ...(desde ? [{ $match: { at: { $gte: desde } } }] : []),
    ]);
    return new Map(linhas.map((l) => [String(l._id), l.at]));
};

export const getFunnelReport = async ({ months = DEFAULT_MONTHS } = {}) => {
    const janela = Math.min(Math.max(Number(months) || DEFAULT_MONTHS, 1), MAX_MONTHS);
    const now = new Date();
    const desde = inicioDaJanela(now, janela);
    const trintaDiasAtras = new Date(now.getTime() - 30 * DAY_MS);

    const [contas, assinantes, ativacoes, pagamentos] = await Promise.all([
        // Coortes: só as contas da janela. `role` fica de fora do corte porque
        // conta de admin também é conta — mas ela é sinalizada abaixo.
        User.find({ createdAt: { $gte: desde } })
            .select('_id createdAt acquisition.source role')
            .lean(),

        // Receita: assinatura vigente, independentemente de quando entrou.
        // `plan` nasce como GUEST e o middleware rebaixa quem venceu — então
        // "plano acima de GUEST + prazo no futuro" é a definição de pagante.
        User.find({ plan: { $ne: 'GUEST' }, validUntil: { $gt: now } })
            // `_id` é explícito porque a retenção compara este conjunto com quem
            // pagou na janela — não é só matéria-prima de receita.
            .select('_id plan billingCycle')
            .lean(),

        primeiroPorUsuario(UserAsset),
        primeiroPorUsuario(Transaction, { extra: { status: 'PAID' } }),
    ]);

    const users = contas.map((c) => ({
        id: String(c._id),
        createdAt: c.createdAt,
        source: c.acquisition?.source,
        isAdmin: c.role === 'ADMIN',
    }));

    const cohorts = buildCohorts({ users, firstAssetByUser: ativacoes, firstPaidByUser: pagamentos, now });

    // Retenção (ver a nota em buildRetention): quem venceu na janela e não voltou,
    // contra quem já pagava e pagou de novo. Renovar empurra `validUntil` para
    // frente, então os dois conjuntos não se sobrepõem.
    const pagantesNaJanela = await Transaction.aggregate([
        { $match: { status: 'PAID', createdAt: { $gte: trintaDiasAtras } } },
        { $group: { _id: '$user' } },
    ]);

    // "Já era cliente" é ter PAGAMENTO anterior à janela — não conta antiga.
    // A primeira versão usava a idade do cadastro como prova, e assim toda
    // estreia vinda da base gratuita (a maioria das vendas de um produto novo)
    // entrava como renovação: o churn saía menor do que é, justamente no número
    // que existe para dizer se o produto segura quem entra.
    const vigentes = new Set(assinantes.map((a) => String(a._id)));
    const renovados = pagantesNaJanela.filter(({ _id }) => {
        const id = String(_id);
        const primeiroPagamento = pagamentos.get(id);
        return Boolean(primeiroPagamento) && primeiroPagamento < trintaDiasAtras && vigentes.has(id);
    }).length;

    const perdidos = await User.countDocuments({ validUntil: { $gte: trintaDiasAtras, $lt: now } });

    return {
        generatedAt: now.toISOString(),
        windowMonths: janela,
        conversionWindowDays: CONVERSION_WINDOW_DAYS,
        cohorts,
        averages: matureAverages(cohorts),
        acquisition: buildAcquisition({ users, firstAssetByUser: ativacoes, firstPaidByUser: pagamentos }),
        revenue: buildRevenue(assinantes),
        retention: buildRetention({ lost: perdidos, renewed: renovados, activeNow: assinantes.length }),
        totals: {
            signupsInWindow: users.length,
            adminsInWindow: users.filter((u) => u.isAdmin).length,
            allTimeSignups: await User.estimatedDocumentCount(),
        },
    };
};

/** Usado pelo controller para não devolver 500 quando o banco está fora. */
export const isDatabaseReady = () => mongoose.connection.readyState === 1;

export const logFunnelSnapshot = (report) => {
    logger.info('📈 Funil consultado', {
        windowMonths: report.windowMonths,
        cohorts: report.cohorts.length,
        mrr: report.revenue.mrr,
        subscribers: report.revenue.subscribers,
    });
};
