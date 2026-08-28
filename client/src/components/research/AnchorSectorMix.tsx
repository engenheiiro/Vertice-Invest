import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { PieChart as PieIcon } from 'lucide-react';

import type { AnchorRankingItem } from '../../services/research';
import { computeSectorAllocation, type SectorGranularity } from '../../utils/sectorAllocation';

/**
 * Repartição por setor de UMA seção da lista âncora.
 *
 * A lista é lida de cima para baixo, cartão a cartão, e nesse formato a
 * concentração é justamente o que não aparece: quatro nomes ótimos e três deles
 * elétricas continuam parecendo uma seleção diversificada. O donut responde essa
 * pergunta antes de o assinante contar os cartões na mão.
 *
 * Duas decisões deliberadas:
 *
 *  • **Peso por cabeça, não por dinheiro.** Um ranking não tem posição nem
 *    saldo — cada ativo entra com peso 1 e a fatia é "quantos nomes", não
 *    "quanto capital". Por isso o rótulo é `n ativos`, nunca R$.
 *  • **Setor do ATIVO, não macro-setor.** Aqui o balde é o subsetor em que o
 *    ativo foi cadastrado — "Energia Elétrica", "Saneamento Básico",
 *    "Telecomunicações" —, o mesmo texto do selo no cartão ao lado. O macro-setor
 *    da Carteira (que soma banco + seguradora em "Financeiro" e joga telefonia em
 *    "Tecnologia") é a leitura certa para medir risco sistêmico de uma posição e a
 *    errada para uma lista de seleção: contradiz o cartão e faz o assinante
 *    duvidar do rótulo. FII já é fino nos dois lugares — segmento.
 *
 * O motor de repartição continua sendo o `computeSectorAllocation` da Carteira:
 * mesma paleta validada nos dois temas, mesma ordenação e mesma dobra de cauda
 * acima de seis fatias.
 */

interface AnchorSectorMixProps {
    items: AnchorRankingItem[];
    /** Granularidade do balde: segmento em FII, subsetor em ação. */
    kind: SectorGranularity;
    /** Nome da seção — entra na leitura para leitor de tela. */
    section: string;
}

export const AnchorSectorMix = ({ items, kind, section }: AnchorSectorMixProps) => {
    const slices = useMemo(
        () => computeSectorAllocation(
            items.map(item => ({ ticker: item.ticker, sector: item.sector, totalValue: 1 })),
            kind,
        ),
        [items, kind],
    );

    // Com um ativo só não há distribuição a mostrar — o cartão já diz o setor.
    if (items.length < 2 || !slices.length) return null;

    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

    return (
        // Caixa que ABRAÇA o conteúdo (`w-fit`) em vez de atravessar a página: em
        // largura total a legenda de dois ou três setores fica boiando num vão de
        // um metro, e a faixa corta a seção em duas. Só no celular ela ocupa a
        // linha inteira, onde não há vão para sobrar.
        <div className="w-full sm:w-fit rounded-xl border border-slate-800 bg-card px-3.5 py-3 mb-4 flex items-center gap-4">
            {/* Decorativo: a legenda ao lado carrega rótulo, % e contagem — a
                identidade da fatia nunca depende só da cor. */}
            <div className="w-[84px] h-[84px] shrink-0 relative" aria-hidden="true">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        {/* Folga e canto arredondado só com 2+ fatias: num setor único o
                            recharts desenha um setor de 360° que se corta e abre fenda. */}
                        <Pie
                            data={slices}
                            dataKey="value"
                            nameKey="label"
                            cx="50%"
                            cy="50%"
                            innerRadius={26}
                            outerRadius={42}
                            paddingAngle={slices.length > 1 ? 2 : 0}
                            cornerRadius={slices.length > 1 ? 2 : 0}
                            stroke="none"
                            isAnimationActive={false}
                        >
                            {slices.map(slice => (
                                <Cell key={slice.key} fill={slice.color} />
                            ))}
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none leading-none">
                    <span className="text-base font-black text-slate-100 tabular-nums">{slices.length}</span>
                    <span className="text-[8px] uppercase tracking-[0.1em] text-slate-500 font-bold mt-0.5">
                        {slices.length === 1 ? 'setor' : 'setores'}
                    </span>
                </div>
            </div>

            {/* Legenda EMPILHADA, não em linha: é o que mantém a caixa estreita e
                alinha os percentuais numa coluna só, legível de cima a baixo. */}
            <div className="min-w-0 flex-1 sm:flex-none sm:w-[236px]">
                <div className="flex items-center gap-1.5 mb-1.5">
                    <PieIcon size={11} className="text-slate-500" />
                    <span className="text-[10px] uppercase tracking-[0.1em] font-bold text-slate-500">
                        Setores
                    </span>
                    <span className="text-[10px] text-slate-600">· {plural(items.length, 'ativo', 'ativos')}</span>
                </div>
                <ul
                    className="space-y-[3px]"
                    aria-label={`Distribuição por setor de ${section}: ${slices.map(s => `${s.label} ${s.pct.toFixed(0)}%`).join(', ')}`}
                >
                    {slices.map(slice => (
                        <li
                            key={slice.key}
                            className="flex items-center gap-2 text-[11.5px] leading-tight"
                            title={`${slice.label} — ${slice.tickers.join(', ')}`}
                        >
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
                            <span className="text-slate-400 truncate flex-1 min-w-0">{slice.label}</span>
                            <span className="text-slate-600 tabular-nums shrink-0">{slice.value}</span>
                            <span className="font-bold text-slate-200 tabular-nums shrink-0 w-8 text-right">
                                {slice.pct.toFixed(0)}%
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};
