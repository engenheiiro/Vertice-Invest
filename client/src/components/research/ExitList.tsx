import { ArrowDownRight, ArrowUpRight, LogOut, Minus } from 'lucide-react';

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
    /**
     * Texto para quando NINGUÉM saiu. Só quem passa a prop mostra a seção vazia:
     * numa lista âncora, "ninguém saiu" é o resultado esperado e vale dizer; no
     * ranking semanal a seção simplesmente não existe naquela apuração.
     */
    emptyMessage?: string;
}

/**
 * Variação do score entre a apuração anterior e esta. É o que separa uma saída
 * por deterioração real ("74 → 60") de uma por sumiço do universo, e a seta dá a
 * direção antes da leitura dos números.
 */
const ScoreDelta = ({ previous, current }: { previous: number; current: number | null }) => {
    if (current === null) {
        return (
            <span className="inline-flex items-center gap-1.5 text-[11px] tabular-nums text-slate-500">
                <span className="font-bold text-slate-400">{previous}</span>
                <Minus size={11} />
                fora do universo
            </span>
        );
    }
    const fell = current < previous;
    const Icon = fell ? ArrowDownRight : ArrowUpRight;
    return (
        <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-slate-500">
            <span className="font-bold text-slate-400">{previous}</span>
            <Icon size={11} className={fell ? 'text-red-400' : 'text-emerald-400'} />
            <span className={`font-bold ${fell ? 'text-red-400' : 'text-emerald-400'}`}>{current}</span>
        </span>
    );
};

export const ExitList = ({
    exits,
    title = 'Saíram da lista nesta apuração',
    subtitle,
    emptyMessage,
}: ExitListProps) => {
    if (!exits.length && !emptyMessage) return null;

    return (
        <section className="mt-8">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1">
                <span className="w-[3px] h-[18px] rounded-sm bg-slate-600 shrink-0" aria-hidden />
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-300">
                    <LogOut size={15} className="text-slate-500" />
                    {title}
                    {exits.length > 0 && <span className="text-slate-500 font-black tabular-nums">{exits.length}</span>}
                </h2>
                {subtitle && (
                    <p className="text-xs text-slate-500 leading-relaxed basis-full lg:basis-auto lg:flex-1 lg:min-w-[16rem]">
                        {subtitle}
                    </p>
                )}
            </div>

            {!exits.length ? (
                <p className="text-sm text-slate-500 rounded-xl border border-slate-800 bg-card px-4 py-5 mt-3">
                    {emptyMessage}
                </p>
            ) : (
                <div className="space-y-2 mt-3">
                    {exits.map(exit => (
                        <div key={exit.ticker} className="rounded-xl border border-slate-800 bg-card px-4 py-3">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                <span className="text-sm font-black text-slate-200">{exit.ticker}</span>
                                {exit.name && <span className="text-[11px] text-slate-500 truncate max-w-[16rem]">{exit.name}</span>}
                                {exit.previousScore !== null && (
                                    <ScoreDelta previous={exit.previousScore} current={exit.score} />
                                )}
                                {/* A âncora informa se o ativo continua na página. Sem o
                                    selo, "saiu" lido sozinho sugere que o ativo sumiu —
                                    quando na maioria das vezes ele só perdeu o COMPRAR. */}
                                {exit.stillListed === false && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-700/50 text-slate-400">
                                        não aparece mais no ranking
                                    </span>
                                )}
                                {exit.stillListed === true && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/25">
                                        segue no ranking, fora do COMPRAR
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{exit.reason}</p>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
};
