/**
 * Endpoints do painel de Saúde dos Dados (Admin).
 *
 * Leitura barata por padrão: o painel abre com o ÚLTIMO relatório persistido pela
 * sentinela, sem recalcular nada. Recalcular a cada abertura faria o custo do
 * painel crescer com o tamanho da base e escondia o valor do histórico.
 */
import mongoose from 'mongoose';
import ErrorLog from '../models/ErrorLog.js';
import JobRun from '../models/JobRun.js';
import { JOB_CATALOG } from '../config/jobCatalog.js';
import {
    getHealthHistory,
    getLatestHealthReport,
    getLiveSourceStatuses,
    runDataHealthCheck,
} from '../services/dataHealthService.js';

/** GET /api/research/data-health — último relatório + tendência + rotinas. */
export const getDataHealth = async (req, res, next) => {
    try {
        const [latest, history, jobRuns, sources] = await Promise.all([
            getLatestHealthReport(),
            getHealthHistory(req.query.limit),
            JobRun.aggregate([
                { $sort: { startedAt: -1 } },
                {
                    $group: {
                        _id: '$jobId',
                        lastRunAt: { $first: '$startedAt' },
                        lastStatus: { $first: '$status' },
                        lastError: { $first: '$error' },
                        lastDurationMs: { $first: '$durationMs' },
                        runs24h: {
                            $sum: {
                                $cond: [
                                    { $gte: ['$startedAt', new Date(Date.now() - 24 * 3600000)] },
                                    1,
                                    0,
                                ],
                            },
                        },
                        failures24h: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $gte: ['$startedAt', new Date(Date.now() - 24 * 3600000)] },
                                            { $eq: ['$status', 'FAILED'] },
                                        ],
                                    },
                                    1,
                                    0,
                                ],
                            },
                        },
                    },
                },
            ]),
            getLiveSourceStatuses(),
        ]);

        const runsById = new Map(jobRuns.map((r) => [r._id, r]));
        // Parte do catálogo, não das execuções: um job que nunca rodou precisa
        // aparecer na lista justamente por não ter rodado.
        const jobs = Object.entries(JOB_CATALOG).map(([jobId, meta]) => {
            const run = runsById.get(jobId);
            return {
                jobId,
                label: meta.label,
                severity: meta.severity,
                maxSilenceHours: meta.maxSilenceHours ?? null,
                monitored: meta.monitored !== false,
                lastRunAt: run?.lastRunAt || null,
                lastStatus: run?.lastStatus || null,
                lastError: run?.lastError || null,
                lastDurationMs: run?.lastDurationMs ?? null,
                runs24h: run?.runs24h || 0,
                failures24h: run?.failures24h || 0,
            };
        });

        res.json({
            report: latest || null,
            history: history.reverse(), // cronológico p/ o gráfico
            jobs,
            // Calculado AGORA, não lido do relatório persistido: o contador de
            // chamadas vive na memória do processo e a pergunta que ele responde
            // ("está entregando neste momento?") não sobrevive a uma hora de atraso.
            sources: sources.sources,
            sourceSummary: sources.summary,
            sourceGroups: sources.groups,
            // O trajeto por ATIVO dentro de cada cadeia de fallback. Mesma
            // natureza dos contadores (memória do processo), e pela mesma razão
            // não passa pelo relatório persistido.
            sourceChains: sources.chains,
            // Cotações que chegaram com número fora do esperado. Também memória
            // do processo: é o flagrante do momento em que o preço entrou. O
            // estado ACUMULADO (o que está gravado agora) tem dono separado —
            // os checks de plausibilidade do relatório.
            quoteSuspects: sources.suspects,
        });
    } catch (error) { next(error); }
};

/** POST /api/research/data-health/run — recalcula agora. */
export const runDataHealth = async (req, res, next) => {
    try {
        const report = await runDataHealthCheck({ trigger: 'MANUAL' });
        if (!report) {
            return res.status(503).json({ message: 'Não foi possível avaliar a saúde dos dados agora.' });
        }
        res.json({ message: 'Saúde dos dados reavaliada.', report });
    } catch (error) { next(error); }
};

/** GET /api/research/errors — erros agrupados, mais recentes primeiro. */
export const listErrors = async (req, res, next) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
        const filter = {};
        if (req.query.origin) filter.origin = String(req.query.origin).toUpperCase();
        // Resolvidos ficam fora por padrão — o painel mostra o que ainda dói.
        if (req.query.includeResolved !== 'true') filter.resolvedAt = null;

        const [errors, unresolvedCount] = await Promise.all([
            ErrorLog.find(filter).sort({ lastSeenAt: -1 }).limit(limit).lean(),
            ErrorLog.countDocuments({ resolvedAt: null }),
        ]);

        res.json({ errors, unresolvedCount });
    } catch (error) { next(error); }
};

/** POST /api/research/errors/:id/resolve — marca como tratado (sem apagar). */
export const resolveError = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Id inválido.' });
        }
        const updated = await ErrorLog.findByIdAndUpdate(
            id,
            { $set: { resolvedAt: new Date() } },
            { new: true },
        ).lean();
        if (!updated) return res.status(404).json({ message: 'Erro não encontrado.' });
        res.json({ message: 'Erro marcado como tratado.', error: updated });
    } catch (error) { next(error); }
};
