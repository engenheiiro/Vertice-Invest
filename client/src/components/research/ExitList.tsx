import { LogOut } from 'lucide-react';

/**
 * "Saíram da lista nesta apuração" — compartilhado pelas DUAS estratégias.
 *
 * Nasceu na página da âncora (`/buy-and-hold`) e foi extraído quando o ranking
 * semanal ganhou retenção de assento, porque o problema é o mesmo nas duas: um
 * ativo que some da lista sem explicação é pior que um que fica. O assinante
 * montou posição com base nela e precisa saber se o motivo foi o negócio, o
 * preço, ou só o fato de outro ativo ter ficado à frente.
 *
 * As duas estratégias mandam formatos ligeiramente diferentes e ambos são
 * opcionais aqui:
 *  - a âncora tem `stillListed` (o ativo saiu do COMPRAR mas segue no ranking);
 *  - o semanal não tem — quem sai da retenção sai da lista inteira.
 */
export interface ExitEntry {
    ticker: string;
    name?: string | null;
    reason: string;
    score: number | null;
    previousScore: number | null;
    /** Âncora: false = sumiu do ranking inteiro (perdeu o portão). */
    stillListed?: boolean;
}

interface ExitListProps {
    exits: ExitEntry[];
    /** Sobrepõe o título quando a semântica da lista pede outra palavra. */
    title?: string;
    /** Linha de contexto sob o título. */
    subtitle?: string;
}

export const ExitList = ({ exits, title = 'Saíram da lista nesta apuração', subtitle }: ExitListProps) => (
    <section className="mt-8">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-300 mb-1">
            <LogOut size={15} className="text-slate-500" />
            {title}
        </h2>
        {subtitle && <p className="text-xs text-slate-500 mb-3 ml-6">{subtitle}</p>}
        <div className={`space-y-2 ${subtitle ? '' : 'mt-3'}`}>
            {exits.map(exit => (
                <div key={exit.ticker} className="rounded-xl border border-slate-800 bg-card px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-sm font-black text-slate-200">{exit.ticker}</span>
                        {exit.previousScore !== null && (
                            <span className="text-[11px] text-slate-500 tabular-nums">
                                {exit.previousScore} → {exit.score === null ? 'fora do universo' : exit.score}
                            </span>
                        )}
                        {exit.stillListed === false && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-700/50 text-slate-400">
                                não aparece mais no ranking
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">{exit.reason}</p>
                </div>
            ))}
        </div>
    </section>
);
