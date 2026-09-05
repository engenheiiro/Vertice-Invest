import React, { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Target, Sparkles, ArrowRight, ArrowDown, ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react';
import { Header } from '../components/dashboard/Header';
import { useWallet } from '../contexts/WalletContext';
import { useToast } from '../contexts/ToastContext';
import { goalsService, type Goal } from '../services/goals';
import { STALE_TIME } from '../config/queryConfig';
import { formatCurrency } from '../utils/format';
import { GoalCard } from '../components/goals/GoalCard';
import { AchievedTrail } from '../components/goals/AchievedTrail';
import {
  buildChains,
  chunk,
  collapsibleAchievedCount,
  isAchieved,
  journeyTitle,
  partitionChains,
  summarizeGoals,
  toRenderItems,
  type GoalRenderItem,
} from '../utils/goalsChain';
import { CreateGoalModal } from '../components/goals/CreateGoalModal';
import { GoalDetailModal } from '../components/goals/GoalDetailModal';
import { ConfirmModal, EmptyState, SkeletonCard, SkeletonKpiGrid } from '../components/ui';

/**
 * Preferência de "mostrar/esconder as metas concluídas", por navegador.
 *
 * Tri-estado de propósito: `null` é "o usuário ainda não decidiu", e só nesse
 * caso o padrão pode depender do que há em andamento (sem nada vivo, recolher as
 * concluídas deixaria a página vazia). Guardar só um booleano apagaria essa
 * distinção — o primeiro acesso passaria a herdar um "false" que ninguém pediu.
 *
 * localStorage e não servidor: é escolha de exibição, não dado de carteira. Vale
 * por navegador, some se o usuário limpar o site, e nenhuma dessas coisas custa
 * nada a quem lê a tela. Leitura e escrita em try/catch porque o acesso ao
 * storage LANÇA em janela anônima com cookies de terceiros bloqueados — sem a
 * guarda, a página de Metas quebrava inteira em vez de perder a preferência.
 */
const COMPLETED_OPEN_KEY = 'goalsCompletedOpen';
/** Uma chave por jornada: recolher uma não pode recolher as outras. */
const chainExpandedKey = (chainId: string) => `goalsChainExpanded:${chainId}`;

const readFlag = (key: string): boolean | null => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
};

const writeFlag = (key: string, value: boolean) => {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage indisponível */ }
};

const readCompletedOverride = (): boolean | null => readFlag(COMPLETED_OPEN_KEY);
const storeCompletedOverride = (open: boolean) => writeFlag(COMPLETED_OPEN_KEY, open);

const ChainArrow: React.FC = () => (
  <>
    <div className="hidden sm:flex items-center justify-center shrink-0 px-1 text-slate-600">
      <ArrowRight size={18} />
    </div>
    <div className="sm:hidden flex items-center justify-center py-0.5 text-slate-600">
      <ArrowDown size={18} />
    </div>
  </>
);

/**
 * Conector de quebra de linha da cadeia. A ligação real é da ÚLTIMA meta da linha
 * de cima para a PRIMEIRA da linha de baixo: uma seta solta à esquerda parecia
 * descer do card acima dela (a meta errada). O traçado sai do centro da última
 * coluna, atravessa a linha e desce na primeira — como a quebra de um parágrafo.
 * No mobile a cadeia já é uma coluna única, então basta a seta para baixo.
 */
const ChainWrapArrow: React.FC = () => (
  <>
    {/* Recuo até o CENTRO da 1ª e da última coluna de cards: a linha tem 3 cards
        de (W - 2×26px)/3, logo o centro do primeiro fica em W/6 - 26/3 ≈ 16,6667%
        - 8,667px (26px = a coluna da seta, px-1 + ícone de 18px). */}
    <div className="hidden sm:block h-6 px-[calc(16.6667%_-_8.667px)]" aria-hidden="true">
      <div className="relative h-full">
        {/* sobe até a última meta da linha anterior */}
        <span className="absolute right-0 top-0 h-1/2 border-r border-slate-700" />
        {/* atravessa da direita para a esquerda */}
        <span className="absolute inset-x-0 top-1/2 border-t border-slate-700" />
        {/* desce na primeira meta da linha seguinte */}
        <span className="absolute left-0 top-1/2 bottom-0 border-l border-slate-700" />
        <ChevronDown size={14} className="absolute -bottom-[5px] -left-[6.5px] text-slate-600" />
      </div>
    </div>
    <div className="sm:hidden flex items-center justify-center py-0.5 text-slate-600">
      <ArrowDown size={18} />
    </div>
  </>
);

type ChainNode = { kind: 'goal'; goal: Goal } | { kind: 'trail'; goals: Goal[] };

interface GoalChainProps {
  goals: Goal[];
  privacy?: boolean;
  onSelect: (id: string) => void;
  onRename: (goalId: string, name: string) => void;
  renaming?: boolean;
}

/** Uma jornada encadeada, com os marcos conquistados do início recolhíveis. */
const GoalChain: React.FC<GoalChainProps> = ({ goals, privacy, onSelect, onRename, renaming }) => {
  // Padrão é a jornada inteira à vista: esconder conquista por default tira do
  // usuário justamente o que ele veio ver. Recolher é uma escolha dele — e, por
  // ser dele, sobrevive a sair e voltar (chave por jornada, ver chainExpandedKey).
  const chainId = goals[goals.length - 1]?._id || '';
  const [expanded, setExpanded] = useState<boolean>(() => readFlag(chainExpandedKey(chainId)) ?? true);
  const setExpandedPersisted = (value: boolean) => {
    setExpanded(value);
    writeFlag(chainExpandedKey(chainId), value);
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const settled = useRef(false);
  const trailCount = useMemo(() => collapsibleAchievedCount(goals), [goals]);

  const nodes: ChainNode[] = useMemo(() => {
    const asNode = (goal: Goal): ChainNode => ({ kind: 'goal', goal });
    if (expanded || trailCount === 0) return goals.map(asNode);
    return [{ kind: 'trail', goals: goals.slice(0, trailCount) }, ...goals.slice(trailCount).map(asNode)];
  }, [goals, expanded, trailCount]);

  const final = goals[goals.length - 1];
  const achievedCount = goals.filter(isAchieved).length;
  const journeyName = goals.find((g) => g.journey)?.journey?.name || null;
  const title = journeyTitle(goals);

  const startEditing = () => {
    settled.current = false;
    setDraft(title);
    setEditing(true);
  };

  /**
   * Encerra a edição UMA vez só. Enter e blur podem disparar na sequência (o
   * input some no meio), o que renderia duas mutações e dois toasts; e um
   * cancelamento não pode escapar como gravação — sem nome próprio, `title` é o
   * rótulo derivado da meta final, então restaurar o rascunho no Escape criaria
   * uma jornada chamada como a meta.
   */
  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    if (!save) return;
    const name = draft.trim();
    if (name && name !== journeyName) onRename(final._id, name);
  };

  // gap-0: quem dá o respiro entre as linhas da jornada é o próprio conector
  // (h-6 = 24px), o mesmo valor do espaço entre blocos. Com gap-1 a quebra
  // interna virava 32px — MAIOR que os 16px entre blocos distintos, ou seja,
  // linhas da mesma jornada pareciam mais separadas que jornadas diferentes.
  return (
    <div className="flex flex-col gap-0">
      {/* Cabeçalho da jornada: com várias cadeias empilhadas, as setas sozinhas
          não dizem onde uma termina e a outra começa. */}
      {/* Eixo externo pelo centro: o botão é inline-flex e sua baseline vem do
          ícone, não do texto — com items-baseline ele subia ~2px. */}
      <div className="flex items-center justify-between gap-3 px-1 pb-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold shrink-0">
            Jornada
          </span>
          {editing ? (
            <input
              autoFocus
              value={draft}
              maxLength={60}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => finish(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finish(true);
                if (e.key === 'Escape') finish(false);
              }}
              aria-label="Nome da jornada"
              className="text-[13px] font-bold text-slate-100 bg-base border border-blue-500 rounded-lg px-2 py-0.5 min-w-0 max-w-[280px] focus:outline-none"
            />
          ) : (
            <button
              onClick={startEditing}
              title="Renomear jornada"
              disabled={renaming}
              className="group/name inline-flex items-baseline gap-1.5 min-w-0 disabled:opacity-60"
            >
              {/* Sem nome próprio o título cai na meta final — rótulo derivado,
                  que muda sozinho se a meta for renomeada. */}
              <h3 className="text-[13px] font-bold text-slate-300 truncate">{title}</h3>
              <Pencil size={11} className="shrink-0 text-slate-600 group-hover/name:text-slate-400 transition-colors" />
            </button>
          )}
          <span className="text-[11px] text-slate-500 shrink-0">
            {Math.round(final.progressPct)}% · {achievedCount} de {goals.length} marcos
          </span>
        </div>
        {expanded && trailCount > 0 && (
          <button
            onClick={() => setExpandedPersisted(false)}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ChevronUp size={12} /> Recolher {trailCount} conquistadas
          </button>
        )}
      </div>
      {/* Cadeias longas (>3) quebram em sub-linhas de até 3 nós — do contrário a
          linha nunca quebra e estoura a largura do container. */}
      {chunk(nodes, 3).map((sub, si) => (
        <React.Fragment key={si}>
          {si > 0 && <ChainWrapArrow />}
          {/* Grid de 3 colunas fixas (e não flex-1): a última sub-linha pode ter
              1 ou 2 metas e os cards precisam manter a mesma largura das linhas
              cheias — é o que ancora o conector. As calhas de 26px são reservadas
              mesmo sem seta (com `auto` elas colapsam e alargam o card). */}
          <div className="flex flex-col sm:grid sm:grid-cols-[1fr_26px_1fr_26px_1fr] items-stretch gap-0">
            {sub.map((node, i) => (
              <React.Fragment key={node.kind === 'trail' ? 'trail' : node.goal._id}>
                {i > 0 && <ChainArrow />}
                <div className="min-w-0">
                  {node.kind === 'trail' ? (
                    <AchievedTrail goals={node.goals} privacy={privacy} onExpand={() => setExpandedPersisted(true)} />
                  ) : (
                    <GoalCard goal={node.goal} privacy={privacy} onClick={() => onSelect(node.goal._id)} />
                  )}
                </div>
              </React.Fragment>
            ))}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};

export const Goals: React.FC = () => {
  const { isPrivacyMode, activeWalletId, isWalletScopeReady } = useWallet();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  // Jornada já vencida não disputa espaço com as vivas — fica a um clique.
  // `null` = usuário ainda não decidiu; aí o padrão depende do que há em andamento.
  // A escolha sobrevive a sair e voltar (ver COMPLETED_OPEN_KEY): recolher as
  // concluídas é arrumar a própria tela, e ter que refazer isso a cada visita
  // desfazia o único efeito que o botão tem.
  const [completedOverride, setCompletedOverride] = useState<boolean | null>(readCompletedOverride);

  const { data, isLoading } = useQuery({
    queryKey: ['goals', activeWalletId],
    queryFn: () => goalsService.getGoals(activeWalletId),
    enabled: isWalletScopeReady, // evita uma busca sem escopo + outra com o id
    staleTime: STALE_TIME.REALTIME,
  });

  const renameJourneyMutation = useMutation({
    mutationFn: ({ goalId, name }: { goalId: string; name: string }) =>
      goalsService.renameJourney(goalId, name, activeWalletId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      addToast('Jornada renomeada.', 'success');
    },
    onError: (err: any) => addToast(err?.message || 'Erro ao renomear jornada.', 'error'),
  });

  const clearAllMutation = useMutation({
    mutationFn: () => goalsService.clearAllGoals(activeWalletId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      addToast('Todas as metas foram removidas.', 'success');
    },
    onError: (err: any) => addToast(err?.message || 'Erro ao limpar metas.', 'error'),
  });

  // Estabiliza a referência: `data?.goals || []` devolvia um array novo a cada
  // render e invalidava toda a cadeia de useMemo abaixo (chains → partição →
  // blocos → resumo), refazendo o trabalho à toa a cada re-render da página.
  const goals = useMemo(() => data?.goals || [], [data]);

  const chains = useMemo(() => buildChains(goals), [goals]);

  const summary = useMemo(() => summarizeGoals(goals, chains), [chains, goals]);

  const { ongoing, completed } = useMemo(() => partitionChains(chains), [chains]);
  const ongoingItems = useMemo(() => toRenderItems(ongoing), [ongoing]);
  const completedItems = useMemo(() => toRenderItems(completed), [completed]);
  const completedGoals = useMemo(() => completed.reduce((n, c) => n + c.length, 0), [completed]);
  // Sem nada em andamento, recolher as concluídas deixaria a página vazia.
  const completedOpen = completedOverride ?? ongoingItems.length === 0;

  // 24px é o passo vertical único da página: entre linhas de uma jornada (via
  // conector), entre blocos e entre seções. Ritmo desigual lia como erro.
  const renderGroup = (items: GoalRenderItem[]) => (
    <div className="flex flex-col gap-6">
      {items.map((item, idx) =>
        item.type === 'singles' ? (
          // Calha horizontal de 26px, igual à das cadeias: com `gap-4` (16px) as
          // avulsas ficavam 6,7px mais largas e as colunas não se alinhavam
          // verticalmente com as linhas de jornada logo acima.
          <div key={idx} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-y-6 gap-x-[26px]">
            {item.goals.map((goal) => (
              <GoalCard key={goal._id} goal={goal} privacy={isPrivacyMode} onClick={() => setSelectedId(goal._id)} />
            ))}
          </div>
        ) : (
          <GoalChain
            key={item.goals[0]._id}
            goals={item.goals}
            privacy={isPrivacyMode}
            onSelect={setSelectedId}
            onRename={(goalId, name) => renameJourneyMutation.mutate({ goalId, name })}
            renaming={renameJourneyMutation.isPending}
          />
        ),
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-deep text-white pb-[calc(5rem+env(safe-area-inset-bottom))] xl:pb-8">
      <Header />
      <main id="main-content" className="max-w-[1360px] mx-auto p-4 md:p-6">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Target className="text-emerald-400" size={24} /> Metas
            </h1>
            <p className="text-sm text-slate-500 mt-1">Planeje, acompanhe e acelere seus objetivos patrimoniais.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {goals.length > 0 && (
              <button
                onClick={() => setClearOpen(true)}
                className="flex items-center justify-center w-10 h-10 rounded-xl transition-all border bg-red-900/10 border-red-900/30 text-red-500 hover:bg-red-900/30 hover:text-red-400 hover:border-red-800 min-w-[44px]"
                title="Limpar todas as metas"
                aria-label="Limpar todas as metas"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={() => setCreateOpen(true)}
              aria-label="Nova meta"
              title="Nova meta"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl px-4 py-2.5 text-sm transition-colors"
            >
              <Plus size={16} /> <span className="hidden sm:inline">Nova meta</span>
            </button>
          </div>
        </div>

        {/* Resumo */}
        {goals.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-card border border-slate-800 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Metas ativas</p>
              <p className="text-xl font-bold text-slate-100 mt-1">{summary.active}</p>
            </div>
            <div className="bg-card border border-slate-800 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Metas conquistadas</p>
              <p className={`text-xl font-bold mt-1 ${summary.achieved > 0 ? 'text-emerald-400' : 'text-slate-100'}`}>{summary.achieved}</p>
            </div>
            <div className="bg-card border border-slate-800 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Acumulado nas metas</p>
              <p className="text-xl font-bold text-emerald-400 mt-1">{formatCurrency(summary.totalCurrent, 'BRL', { privacy: isPrivacyMode })}</p>
            </div>
            <div className="bg-card border border-slate-800 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Soma dos alvos</p>
              <p className="text-xl font-bold text-slate-100 mt-1">{formatCurrency(summary.totalTarget, 'BRL', { privacy: isPrivacyMode })}</p>
            </div>
          </div>
        )}

        {/* Conteúdo */}
        {isLoading ? (
          <div className="space-y-4" role="status" aria-label="Carregando metas">
            <SkeletonKpiGrid count={3} />
            <SkeletonCard className="h-48" />
            <SkeletonCard className="h-48" />
          </div>
        ) : goals.length === 0 ? (
          <div className="bg-card border border-slate-800 rounded-2xl">
            <EmptyState
              icon={<Sparkles size={28} className="text-emerald-400" />}
              title="Crie sua primeira meta"
              description="Defina um alvo (ex: o primeiro milhão), um aporte mensal, e acompanhe quanto falta — atualizando sozinho conforme você investe."
              action={
                <button
                  onClick={() => setCreateOpen(true)}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl px-5 py-2.5 text-sm transition-colors"
                >
                  <Plus size={16} /> Nova meta
                </button>
              }
            />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {ongoingItems.length > 0 && (
              <section>
                {/* O título só aparece quando há o contraste com as concluídas —
                    sozinho ele seria rótulo de uma seção única. */}
                {completedItems.length > 0 && (
                  <h2 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-3">
                    Em andamento
                  </h2>
                )}
                {renderGroup(ongoingItems)}
              </section>
            )}

            {completedItems.length > 0 && (
              <section>
                <button
                  onClick={() => {
                    const proximo = !completedOpen;
                    setCompletedOverride(proximo);
                    storeCompletedOverride(proximo);
                  }}
                  aria-expanded={completedOpen}
                  className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-slate-500 hover:text-slate-300 transition-colors mb-3"
                >
                  {completedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  Concluídas · {completedGoals} {completedGoals === 1 ? 'meta' : 'metas'}
                </button>
                {completedOpen && renderGroup(completedItems)}
              </section>
            )}
          </div>
        )}
      </main>

      <CreateGoalModal isOpen={createOpen} onClose={() => setCreateOpen(false)} />
      {selectedId && (
        <GoalDetailModal isOpen={!!selectedId} onClose={() => setSelectedId(null)} goalId={selectedId} privacy={isPrivacyMode} />
      )}
      <ConfirmModal
        isOpen={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={() => clearAllMutation.mutate()}
        title="Excluir Todas as Metas?"
        message="ATENÇÃO: Esta ação é irreversível. Todas as metas e seus aportes manuais serão apagados."
        isDestructive
        confirmText="Sim, Excluir Tudo"
      />
    </div>
  );
};
