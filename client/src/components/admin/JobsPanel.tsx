import React, { useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';
import type { JobStatus } from '../../services/health';
import { formatRelativeTime } from '../../utils/format';

/**
 * "Rotinas automáticas" — os robôs que buscam e calculam dado sozinhos.
 *
 * A versão anterior era uma tabela de 21 linhas sempre aberta, ocupando meia tela
 * para dizer, quase sempre, "está tudo bem". Três decisões consertam isso:
 *
 * 1. **Recolhido por padrão, aberto quando há problema.** O estado normal desta
 *    seção é o desinteressante; ela só merece espaço quando tem o que contar.
 * 2. **Uma linha por rotina, em colunas.** Quatro células de tabela por rotina
 *    viravam altura; nome + periodicidade + última execução cabem numa linha, e
 *    21 linhas em três colunas somam sete.
 * 3. **Agrupado por periodicidade, em ordem fixa.** Ordenar por gravidade faria a
 *    linha mudar de lugar a cada carregamento, e o custo disso é não conseguir
 *    achar uma rotina de memória. Como no painel de fontes, a posição é estável e
 *    a cor faz a triagem — reforçada pelo resumo no cabeçalho, que NOMEIA quem
 *    está atrasado antes mesmo de abrir.
 *
 * O que esta seção responde é só "a rotina rodou?" — não "o dado que ela trouxe
 * presta". Uma rotina pode terminar com sucesso e gravar valor velho; foi
 * exatamente o que aconteceu com o câmbio em 04/09/2026. Quem pega aquilo são as
 * verificações de dado, e por isso as duas coisas moram em blocos separados.
 */

type Tier = 'minutes' | 'daily' | 'sparse' | 'demand';

const TIERS: { id: Tier; label: string }[] = [
    { id: 'minutes', label: 'A cada poucos minutos' },
    { id: 'daily', label: 'Uma ou mais vezes por dia' },
    { id: 'sparse', label: 'Semanais, mensais e anuais' },
    { id: 'demand', label: 'Sob demanda' },
];

/**
 * A periodicidade sai de `maxSilenceHours` — o teto de silêncio tolerado, que já é
 * o intervalo do cron mais folga. Não é o intervalo exato, e não precisa ser: aqui
 * ele só decide em que balde a linha aparece.
 */
export const jobTier = (job: JobStatus): Tier => {
    if (!job.monitored || job.maxSilenceHours === null) return 'demand';
    if (job.maxSilenceHours <= 3) return 'minutes';
    if (job.maxSilenceHours <= 30) return 'daily';
    return 'sparse';
};

/**
 * Atrasada = passou do teto de silêncio, ou é cobrada e nunca rodou. Rotina não
 * monitorada (anual, disparo manual) nunca fica atrasada: silêncio ali é normal.
 */
export const isJobLate = (job: JobStatus, now = Date.now()): boolean => {
    if (!job.monitored) return false;
    if (!job.lastRunAt) return true;
    if (job.maxSilenceHours === null) return false;
    return (now - new Date(job.lastRunAt).getTime()) / 3600000 > job.maxSilenceHours;
};

export const isJobBad = (job: JobStatus, now = Date.now()): boolean =>
    job.lastStatus === 'FAILED' || isJobLate(job, now);

/**
 * O catálogo escreve a periodicidade entre parênteses no rótulo ("Macroeconomia
 * (15 min)"). Separar as duas partes deixa o nome legível numa linha só e joga o
 * horário para uma coluna própria, alinhada — em vez de um rótulo comprido que
 * trunca no meio e esconde justamente a informação de quando aquilo roda.
 */
export const splitJobLabel = (label: string): { name: string; schedule: string | null } => {
    const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(label);
    if (!match) return { name: label, schedule: null };
    return { name: match[1].trim(), schedule: match[2].trim() };
};

const JobLine = ({ job }: { job: JobStatus }) => {
    const failed = job.lastStatus === 'FAILED';
    const late = isJobLate(job);
    const bad = failed || late;
    const critical = bad && job.severity === 'CRITICAL';
    const { name, schedule } = splitJobLabel(job.label);

    return (
        <div className="flex items-center gap-2 py-1.5 border-b border-slate-800/60 min-w-0">
            <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    critical ? 'bg-red-500' : bad ? 'bg-yellow-500' : 'bg-emerald-600'
                }`}
                title={bad ? (failed ? 'Última execução falhou' : 'Atrasada') : 'Em dia'}
            />
            <span className="text-[11px] text-slate-200 truncate flex-1 min-w-0" title={job.label}>
                {name}
            </span>
            {schedule && (
                <span className="text-[9px] text-slate-600 font-mono shrink-0 hidden sm:inline" title={schedule}>
                    {schedule}
                </span>
            )}
            <span
                className={`text-[10px] font-mono shrink-0 w-[68px] text-right ${
                    critical ? 'text-red-400' : bad ? 'text-yellow-400' : 'text-slate-500'
                }`}
            >
                {formatRelativeTime(job.lastRunAt)}
            </span>
        </div>
    );
};

export const JobsPanel = ({ jobs }: { jobs: JobStatus[] }) => {
    const [manual, setManual] = useState<boolean | null>(null);

    const { problemas, blocos } = useMemo(() => {
        const ruins = jobs.filter((job) => isJobBad(job));
        return {
            problemas: ruins,
            blocos: TIERS
                .map((tier) => ({ ...tier, itens: jobs.filter((job) => jobTier(job) === tier.id) }))
                .filter((tier) => tier.itens.length > 0),
        };
    }, [jobs]);

    // Abre sozinho quando há o que ver; a escolha do usuário, se houver, manda.
    const open = manual ?? problemas.length > 0;

    const resumo = problemas.length === 0
        ? `${jobs.length} rotinas, todas rodando no prazo.`
        : `${problemas.length} rotina(s) precisando de atenção: ${problemas.slice(0, 3).map((j) => splitJobLabel(j.label).name).join(', ')}`
            + `${problemas.length > 3 ? ' e outras' : ''}.`;

    return (
        <section className="bg-base border border-slate-800 rounded-2xl" aria-labelledby="jobs-title">
            <button
                type="button"
                onClick={() => setManual(!open)}
                aria-expanded={open}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-panel/40 transition-colors rounded-2xl"
            >
                {open
                    ? <ChevronDown size={14} className="text-slate-500 shrink-0" />
                    : <ChevronRight size={14} className="text-slate-500 shrink-0" />}
                <div className="min-w-0 flex-1">
                    <h4 id="jobs-title" className="text-xs font-black text-white uppercase flex items-center gap-2">
                        <Activity size={14} className="text-blue-500" />
                        Rotinas automáticas
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-1">{resumo}</p>
                </div>
                <span
                    className={`text-[9px] font-bold uppercase px-2 py-1 rounded-full whitespace-nowrap border shrink-0 ${
                        problemas.length === 0
                            ? 'text-emerald-400 bg-emerald-900/10 border-emerald-900/40'
                            : 'text-yellow-400 bg-yellow-900/10 border-yellow-900/40'
                    }`}
                >
                    {problemas.length === 0 ? 'Todas em dia' : `${problemas.length} atrasada(s)`}
                </span>
            </button>

            {open && (
                <div className="px-4 pb-4 space-y-3">
                    <p className="text-[10px] text-slate-500 max-w-2xl">
                        Aqui se vê se cada robô <strong className="text-slate-400">rodou</strong> — não se ele
                        trouxe dado bom: uma rotina pode terminar com sucesso e ainda assim gravar um valor
                        velho, e quem pega isso são as verificações de dado.
                    </p>
                    {blocos.map((bloco) => (
                        <div key={bloco.id}>
                            <h5 className="text-[9px] font-black text-slate-500 uppercase tracking-wide mb-1">
                                {bloco.label}
                            </h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-5">
                                {bloco.itens.map((job) => <JobLine key={job.jobId} job={job} />)}
                            </div>
                        </div>
                    ))}
                    {problemas.some((j) => j.lastStatus === 'FAILED' && j.lastError) && (
                        <div className="pt-1 space-y-1">
                            {problemas
                                .filter((j) => j.lastStatus === 'FAILED' && j.lastError)
                                .map((j) => (
                                    <p key={j.jobId} className="text-[10px] text-red-400 break-words">
                                        <span className="font-bold">{splitJobLabel(j.label).name}:</span> {j.lastError}
                                    </p>
                                ))}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
};
