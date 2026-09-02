
import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { walletService, type UpdateAssetPayload } from '../services/wallet';
import { walletsService, WalletSummary } from '../services/wallets';
import { useAuth } from './AuthContext';
import { useDemo } from './DemoContext'; // Importar DemoContext
import { useToast } from './ToastContext';
import { DEMO_ASSETS, DEMO_KPIS, DEMO_HISTORY } from '../data/DEMO_DATA'; // Importar Dados Mock
import { STALE_TIME } from '../config/queryConfig';
import { computeWalletKpis } from '../utils/kpiCalculations';
import type { SharpeConfidence } from '../utils/format';
import { getErrorMessage } from '../utils/errorMessages';
import { foldEtfIntoStock } from '../utils/allocation';

// ETF: classe própria para fundos de índice nacionais (BRL) e internacionais (USD).
// OURO mantido só por compatibilidade com carteiras antigas (não oferecido na UI;
// ouro entra como ETF lastreado, ex. GLD/GOLD11).
export type AssetType = 'STOCK' | 'FII' | 'CRYPTO' | 'STOCK_US' | 'ETF' | 'FIXED_INCOME' | 'CASH' | 'OURO';

/**
 * Régua que produziu a variação do dia de uma posição. Espelha o enum do
 * servidor (`server/utils/dayChangeReason.js`) — se um valor novo aparecer lá,
 * ele precisa aparecer aqui e ganhar rótulo em `utils/dayMovers.ts`.
 */
export type DayChangeReason =
    | 'ANCHOR_CLOSE'
    | 'PREVIOUS_CLOSE'
    | 'BOUGHT_TODAY'
    | 'FIXED_INCOME_MTM'
    | 'FIXED_INCOME_MTM_PENDING'
    | 'FIXED_INCOME_CURVE'
    | 'MATURED'
    | 'STALE_QUOTE'
    | 'NO_QUOTE'
    | 'PROVIDER_WINDOW'
    | 'PROVIDER_SESSION';

export interface Asset {
    id: string;
    ticker: string;
    type: AssetType;
    quantity: number;
    averagePrice: number;
    currentPrice: number;
    totalValue: number;
    totalCost: number;
    profit: number;
    profitPercent: number;
    currency: 'BRL' | 'USD';
    // Classe econômica usada na alocação, independente do veículo/moeda.
    // Ex.: IVVB11 = type ETF, currency BRL, allocationClass STOCK_US.
    allocationClass?: Exclude<AssetType, 'ETF'> | null;
    name?: string;
    sector?: string;
    fixedIncomeRate?: number;
    dayChangePct?: number;
    /**
     * Contribuição da posição para a Variação Hoje, em BRL. Vem do servidor, que
     * é quem mede o início do dia contra o snapshot-âncora — a soma destes valores
     * FECHA com `kpis.dayVariation` por construção, e é o que sustenta o
     * detalhamento do dia. Nunca recalcular no cliente.
     */
    dayChangeValue?: number;
    /**
     * Qual régua produziu `dayChangeValue` (ver server/utils/dayChangeReason.js).
     * Distingue o zero de "o ativo fechou estável" do zero de "não temos cotação
     * de hoje" — o primeiro é fato do mercado, o segundo é limite do nosso dado.
     */
    dayChangeReason?: DayChangeReason | null;
    /** Provento com data-ex dentro da janela do dia. Fora de `dayChangeValue`. */
    dayDividends?: number;
    // Proventos recebidos (all-time, BRL) deste ativo — compõe a Rentabilidade
    // total (preço + proventos), distinta da Variação (só preço).
    dividendsReceived?: number;
    // Sub-tipos usados pela ramificação da Carteira Ideal (real vs meta):
    fixedIncomeIndex?: 'SELIC' | 'CDI' | 'IPCA' | 'PRE' | null;
    // ETF/GOLD: holdings de Exterior que são ETFs internacionais (ou ouro lastreado);
    // contam no Exterior, sub-tipo ETF.
    usSubType?: 'STOCK' | 'REIT' | 'DOLLAR' | 'ETF' | 'GOLD' | null;
    // C1: Reserva separada. true → sai da base de alocação e lista em "Caixa/Reserva".
    // Pode vir ausente em posições antigas (ver isReserveAsset em utils/allocation).
    isReserve?: boolean;
    // C2: vencimento da RF (ISO) e flag VENCIDO (accrual congelado; sugere resgate).
    maturityDate?: string | null;
    matured?: boolean;
    // Renda fixa: como a posição foi precificada.
    // 'MTM'     → título público marcado pelo PU oficial do Tesouro (valor de resgate hoje);
    // 'ACCRUAL' → valor na curva (RF privada, título com cupom semestral ou sem série).
    // `accruedValue` acompanha SEMPRE, para a UI contrastar mercado × curva —
    // num IPCA+ longo os dois divergem de verdade.
    pricingSource?: 'MTM' | 'ACCRUAL' | null;
    accruedValue?: number | null;
    /** Data Base do PU usado na marcação (YYYY-MM-DD). */
    priceDate?: string | null;
    /**
     * PU OFICIAL do título (hoje e o médio de compra) e a fração implícita que
     * ele multiplica. Só existem no caminho MTM.
     *
     * `averagePrice`/`currentPrice` não servem para renda fixa: são
     * custo÷quantidade e saldo÷quantidade, e a quantidade da RF não segue
     * convenção — o cadastro manual pede só o valor investido e grava 1, o
     * extrato da B3 traz a fração real. Estes três vêm do PU oficial, então não
     * dependem de como o ativo foi digitado e batem com o extrato do Tesouro.
     */
    treasuryUnitPrice?: number | null;
    treasuryAverageUnitPrice?: number | null;
    treasuryUnits?: number | null;
}

export interface WalletKPIs {
    totalEquity: number;
    totalInvested: number;
    totalResult: number;
    totalResultPercent: number;
    dayVariation: number;
    dayVariationPercent: number;
    /**
     * Dia do snapshot contra o qual a variação foi medida (YYYY-MM-DD). `null`
     * em carteira nova. Numa segunda após feriado a âncora é quinta — o rótulo
     * "Hoje" sozinho mentiria sobre a janela que o número cobre.
     */
    dayAnchorDate?: string | null;
    /** Proventos com data-ex na mesma janela. NÃO entram em `dayVariation`. */
    dayDividends?: number;
    totalDividends: number;
    projectedDividends: number;
    weightedRentability: number;
    dataQuality?: 'AUDITED' | 'ESTIMATED';
    /** `null` = sem amostra suficiente para medir risco (≠ Sharpe zero). */
    sharpeRatio?: number | null;
    /** Confiança da estimativa, derivada do tamanho da amostra. */
    sharpeConfidence?: SharpeConfidence | null;
    /** Margem de erro (±) do Sharpe anualizado. */
    sharpeStandardError?: number | null;
    /** Retornos diários que entraram no cálculo. */
    sharpeSample?: number;
    /** `null` = não medido neste caminho (o KPI não busca o Ibovespa). */
    beta?: number | null;
}

export interface HistoryPoint {
    date: string;
    totalEquity: number;
    totalInvested: number;
    /** Proventos acumulados até o snapshot (ausente em payloads legados). */
    totalDividends?: number;
    /** Resultado total persistido: patrimônio − aplicado + proventos. */
    profit?: number;
}

export type AllocationMap = Partial<Record<AssetType, number>>;

// Sub-metas (ramificação) por classe. Percentuais RELATIVOS à fatia da classe
// (somam ~100% DENTRO da classe). Tudo 0 = sem sub-meta (classe em bloco).
// Ações BR ramifica em ações individuais / ETFs com exposição econômica ao Brasil.
export type StockSubKey = 'STOCK' | 'ETF';
export type FixedIncomeSubKey = 'IPCA' | 'POS' | 'PRE';
// Exterior ramifica em Stocks/REITs/ETFs/Dólar. Inclui ETFs estrangeiros em USD e
// ETFs locais em BRL cuja allocationClass é STOCK_US (IVVB11, NASD11, WRLD11...).
export type UsSubKey = 'STOCK' | 'REIT' | 'ETF' | 'DOLLAR';
export interface SubAllocationMap {
    STOCK: Record<StockSubKey, number>;
    FIXED_INCOME: Record<FixedIncomeSubKey, number>;
    STOCK_US: Record<UsSubKey, number>;
}

export const DEFAULT_SUB_ALLOCATION: SubAllocationMap = {
    STOCK: { STOCK: 0, ETF: 0 },
    FIXED_INCOME: { IPCA: 0, POS: 0, PRE: 0 },
    STOCK_US: { STOCK: 0, REIT: 0, ETF: 0, DOLLAR: 0 },
};

// Pseudo-carteira única usada só em modo demo — o seletor real fica oculto.
const DEMO_WALLETS: WalletSummary[] = [{ id: 'demo', name: 'Demo', isDefault: true, createdAt: new Date().toISOString() }];

/**
 * Fonte das abas que buscam sozinhas (Rentabilidade, Proventos, Extrato).
 * Na área logada aponta para o walletService (com JWT e escopo de carteira); no
 * link público, para o publicWalletService (token na URL, sem auth). Os
 * componentes consomem daqui em vez de importar o serviço direto — é o que
 * permite renderizar a MESMA página Carteira nos dois contextos.
 */
export interface WalletDataSource {
    getPerformance: () => Promise<any>;
    getDividends: () => Promise<any>;
    getCashFlow: (page: number, limit: number, filterType: string) => Promise<any>;
}

export interface WalletContextType {
    assets: Asset[];
    kpis: WalletKPIs;
    history: HistoryPoint[];
    targetAllocation: AllocationMap;
    targetReserve: number;
    targetMonthlyDividendIncome: number;
    targetSubAllocation: SubAllocationMap;
    usdRate: number;
    isLoading: boolean;
    isRefreshing: boolean;
    isPrivacyMode: boolean;
    togglePrivacyMode: () => void;
    /**
     * Visão de leitura (link público compartilhado): a página é a mesma, mas
     * toda ação de escrita — transação, aporte, rebalanceamento, reset, editar
     * meta, renomear, trocar de carteira — some.
     */
    isReadOnly: boolean;
    /**
     * Nenhum valor real chegou do servidor (link com "exibir valores em R$"
     * desligado): a privacidade fica travada e o botão de alternar some, porque
     * desligá-la só revelaria números normalizados.
     */
    isValuesLocked: boolean;
    dataSource: WalletDataSource;
    refreshWallet: () => void;
    addAsset: (asset: any) => Promise<void>;
    updateAsset: (id: string, data: UpdateAssetPayload) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
    resetWallet: () => Promise<void>;
    updateTargets: (newTargets: AllocationMap, newReserveTarget: number, newSubAllocation?: SubAllocationMap, newDividendGoal?: number) => void;
    /** Grava um lote importado (Investidor10 / extrato B3 / planilha). */
    importCommit: (source: string, rows: unknown[]) => Promise<{ batchId: string; inserted: number } | undefined>;
    /** Desfaz um lote importado inteiro. */
    importUndo: (batchId: string) => Promise<void>;
    // --- Fase 2: múltiplas carteiras ---
    wallets: WalletSummary[];
    activeWalletId: string | undefined;
    /**
     * `false` enquanto a carteira ativa ainda não foi resolvida. Toda query escopada
     * por carteira deve entrar em `enabled` — senão ela busca uma vez sem escopo e
     * outra quando o id chega, dobrando as chamadas caras (dividendos, performance,
     * fluxo de caixa, metas) a cada carregamento.
     */
    isWalletScopeReady: boolean;
    activeWalletName: string;
    isWalletsLoading: boolean;
    isSwitchingWallet: boolean;
    setActiveWallet: (walletId: string) => Promise<void>;
    createWallet: (name: string) => Promise<WalletSummary | undefined>;
    renameWallet: (walletId: string, name: string) => Promise<void>;
    deleteWallet: (walletId: string) => Promise<void>;
}

// Exportado porque o link público monta um provider irmão (PublicWalletProvider)
// sobre o MESMO contexto — assim todo componente da Carteira segue usando
// `useWallet()` sem saber se está na área logada ou numa visita anônima.
// (o alerta de fast-refresh pede o contexto em arquivo separado; separá-lo daqui
//  arrastaria os tipos que ~30 arquivos importam deste módulo)
// eslint-disable-next-line react-refresh/only-export-components
export const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const { isDemoMode } = useDemo(); // Hook do Modo Demo
    const { addToast } = useToast();
    const queryClient = useQueryClient();

    const [targetAllocation, setTargetAllocation] = useState<AllocationMap>({ STOCK: 40, FII: 30, STOCK_US: 20, CRYPTO: 10 });
    const [targetReserve, setTargetReserve] = useState(10000);
    const [targetMonthlyDividendIncome, setTargetMonthlyDividendIncome] = useState(0);
    const [targetSubAllocation, setTargetSubAllocation] = useState<SubAllocationMap>(DEFAULT_SUB_ALLOCATION);

    // Escolha EXPLÍCITA de carteira (seletor, criação, exclusão). Guardada junto do
    // dono para que a seleção de uma conta nunca vaze para a próxima após um
    // logout/login — um walletId alheio derrubaria as queries em 403 no resolveWallet.
    const [selection, setSelection] = useState<{ userId?: string; walletId?: string }>({});
    const selectWallet = (walletId?: string) => setSelection({ userId: user?.id, walletId });

    const [isPrivacyMode, setIsPrivacyMode] = useState(() => {
        const saved = localStorage.getItem('isPrivacyMode');
        return saved === 'true';
    });

    const togglePrivacyMode = () => {
        setIsPrivacyMode(prev => {
            const newValue = !prev;
            localStorage.setItem('isPrivacyMode', String(newValue));
            return newValue;
        });
    };

    // --- QUERIES ---
    const walletsQuery = useQuery({
        queryKey: ['wallets', user?.id],
        queryFn: walletsService.list,
        enabled: !!user?.id && !isDemoMode,
        staleTime: STALE_TIME.MEDIUM,
    });

    // A carteira ativa é resolvida pelo servidor (User.activeWalletId) e DERIVADA da
    // query — não copiada para o estado por efeito. Copiar fazia a primeira renderização
    // sair com activeWalletId indefinido: toda query wallet-scoped disparava uma busca
    // sem escopo e refazia a mesma busca assim que o id chegava (duas idas ao servidor
    // por carregamento). A partir daí, cada troca via setActiveWallet atualiza a seleção
    // local otimisticamente, e as queries (cuja chave inclui activeWalletId) buscam de
    // novo sozinhas — sem precisar de invalidação manual em cada uma.
    const activeWalletId = selection.userId === user?.id
        ? (selection.walletId ?? walletsQuery.data?.activeWalletId)
        : walletsQuery.data?.activeWalletId;

    // Portão único de tudo que é escopado por carteira: só busca depois que
    // GET /wallets respondeu — sucesso OU erro. No erro seguimos sem id, porque aí o
    // backend (resolveWallet) resolve a carteira ativa sozinho; travar aqui deixaria a
    // carteira em loading eterno se a listagem falhasse.
    const isWalletScopeReady = isDemoMode || (!!user?.id && !walletsQuery.isPending);

    const walletQuery = useQuery({
        queryKey: ['wallet', user?.id, activeWalletId],
        queryFn: () => walletService.getWallet(activeWalletId),
        enabled: !!user?.id && !isDemoMode && isWalletScopeReady, // Não busca se estiver em Demo
        staleTime: STALE_TIME.REALTIME,
    });

    const historyQuery = useQuery({
        queryKey: ['walletHistory', user?.id, activeWalletId],
        queryFn: () => walletService.getHistory(activeWalletId),
        enabled: !!user?.id && !isDemoMode && isWalletScopeReady,
        staleTime: STALE_TIME.MEDIUM,
    });

    // --- HIDRATA CARTEIRA IDEAL DO SERVIDOR ---
    // O backend retorna targetAllocation/targetReserve persistidos na carteira ativa.
    // Sincroniza sempre que a carteira recarregar (login, refresh, troca de conta/carteira).
    useEffect(() => {
        if (isDemoMode) return;
        const data = walletQuery.data;
        if (typeof data?.targetReserve === 'number') setTargetReserve(data.targetReserve);
        if (typeof data?.targetMonthlyDividendIncome === 'number') setTargetMonthlyDividendIncome(data.targetMonthlyDividendIncome);
        if (data?.targetAllocation) {
            // Normaliza metas legadas: alvo de topo ETF (nacional) é absorvido por Ações BR
            // (STOCK) como sub-meta. Idempotente para carteiras já salvas no formato novo.
            const sub: SubAllocationMap = {
                STOCK: { ...DEFAULT_SUB_ALLOCATION.STOCK, ...data.targetSubAllocation?.STOCK },
                FIXED_INCOME: { ...DEFAULT_SUB_ALLOCATION.FIXED_INCOME, ...data.targetSubAllocation?.FIXED_INCOME },
                STOCK_US: { ...DEFAULT_SUB_ALLOCATION.STOCK_US, ...data.targetSubAllocation?.STOCK_US },
            };
            const folded = foldEtfIntoStock(data.targetAllocation, sub);
            setTargetAllocation(folded.targetAllocation);
            setTargetSubAllocation(folded.targetSubAllocation);
        } else if (data?.targetSubAllocation) {
            setTargetSubAllocation({
                STOCK: { ...DEFAULT_SUB_ALLOCATION.STOCK, ...data.targetSubAllocation.STOCK },
                FIXED_INCOME: { ...DEFAULT_SUB_ALLOCATION.FIXED_INCOME, ...data.targetSubAllocation.FIXED_INCOME },
                STOCK_US: { ...DEFAULT_SUB_ALLOCATION.STOCK_US, ...data.targetSubAllocation.STOCK_US },
            });
        }
    }, [walletQuery.data, isDemoMode]);

    // --- FORCE REFRESH ON MOUNT ---
    useEffect(() => {
        if (user?.id) {
            queryClient.invalidateQueries({ queryKey: ['wallet', user.id] });
            queryClient.invalidateQueries({ queryKey: ['walletHistory', user.id] });
        }
    }, [user?.id, queryClient]);

    // --- MUTATIONS ---
    const addAssetMutation = useMutation({
        mutationFn: (asset: any) => walletService.addAsset(asset, activeWalletId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['walletHistory', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['dividends'] });
            queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
            queryClient.invalidateQueries({ queryKey: ['dashboardResearch'] });
            queryClient.invalidateQueries({ queryKey: ['goals'] });
        }
        // Feedback de sucesso/erro do "add" é tratado no AddAssetModal (evita toast duplicado).
    });

    const updateAssetMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: UpdateAssetPayload }) =>
            walletService.updateAsset(id, data, activeWalletId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
        },
        onError: (err: any) => addToast(err?.message || 'Erro ao atualizar ativo.', 'error')
    });

    const removeAssetMutation = useMutation({
        mutationFn: (id: string) => walletService.removeAsset(id, activeWalletId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['walletHistory', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
            queryClient.invalidateQueries({ queryKey: ['goals'] });
            addToast('Ativo removido da carteira.', 'success');
        },
        onError: (err: any) => addToast(err?.message || 'Erro ao remover ativo.', 'error')
    });

    const resetWalletMutation = useMutation({
        mutationFn: () => walletService.resetWallet(activeWalletId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['walletHistory', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['dividends'] });
            queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
            queryClient.invalidateQueries({ queryKey: ['goals'] });
            addToast('Carteira resetada com sucesso.', 'success');
        },
        onError: (err: any) => addToast(err?.message || 'Erro ao resetar carteira.', 'error')
    });

    // Importação de carteira: mesma invalidação do reset, porque o efeito é o
    // mesmo — a carteira inteira muda de uma vez, incluindo histórico e metas.
    // Sem `onSuccess` de toast: o wizard de importação dá o feedback, com o
    // resumo do que entrou (toast genérico aqui seria duplicado).
    const invalidateAfterImport = () => {
        queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
        queryClient.invalidateQueries({ queryKey: ['walletHistory', user?.id] });
        queryClient.invalidateQueries({ queryKey: ['dividends'] });
        queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
        queryClient.invalidateQueries({ queryKey: ['dashboardResearch'] });
        queryClient.invalidateQueries({ queryKey: ['goals'] });
    };

    const importCommitMutation = useMutation({
        mutationFn: ({ source, rows }: { source: string; rows: unknown[] }) =>
            walletService.importCommit(source, rows, activeWalletId),
        onSuccess: invalidateAfterImport,
    });

    const importUndoMutation = useMutation({
        mutationFn: (batchId: string) => walletService.importUndo(batchId, activeWalletId),
        onSuccess: invalidateAfterImport,
    });

    const setActiveWalletMutation = useMutation({
        mutationFn: (walletId: string) => walletsService.setActive(walletId),
        onSuccess: (_data, walletId) => {
            selectWallet(walletId);
            queryClient.invalidateQueries({ queryKey: ['wallets', user?.id] });
        },
        onError: (err: any) => addToast(err?.message || 'Erro ao trocar de carteira.', 'error')
    });

    // --- ACTIONS ---
    const addAsset = async (newAsset: any) => {
        if (isDemoMode) return; // Bloqueia ações no demo
        await addAssetMutation.mutateAsync(newAsset);
    };

    const updateAsset = async (id: string, data: UpdateAssetPayload) => {
        if (isDemoMode) return;
        await updateAssetMutation.mutateAsync({ id, data });
    };

    const removeAsset = async (id: string) => {
        if (isDemoMode) return;
        await removeAssetMutation.mutateAsync(id);
    };

    const resetWallet = async () => {
        if (isDemoMode) return;
        await resetWalletMutation.mutateAsync();
    };

    const importCommit = async (source: string, rows: unknown[]) => {
        if (isDemoMode) return undefined; // Demo não persiste
        return await importCommitMutation.mutateAsync({ source, rows });
    };

    const importUndo = async (batchId: string) => {
        if (isDemoMode) return;
        await importUndoMutation.mutateAsync(batchId);
    };

    const updateTargets = async (newTargets: AllocationMap, newReserveTarget: number, newSubAllocation?: SubAllocationMap, newDividendGoal?: number) => {
        // Atualização otimista (UI responde na hora); persiste no backend logo em seguida.
        setTargetAllocation(newTargets);
        setTargetReserve(newReserveTarget);
        if (newSubAllocation) setTargetSubAllocation(newSubAllocation);
        if (newDividendGoal !== undefined) setTargetMonthlyDividendIncome(newDividendGoal);
        if (isDemoMode) return; // Demo não persiste
        try {
            await walletService.updateTargets(newTargets as Record<string, number>, newReserveTarget, newSubAllocation, newDividendGoal, activeWalletId);
        } catch (err: unknown) {
            addToast(getErrorMessage(err, 'Erro ao salvar carteira ideal.'), 'error');
        }
    };

    const setActiveWallet = async (walletId: string) => {
        if (isDemoMode || walletId === activeWalletId) return;
        await setActiveWalletMutation.mutateAsync(walletId);
    };

    const createWallet = async (name: string) => {
        if (isDemoMode) return undefined;
        const res = await walletsService.create(name);
        queryClient.invalidateQueries({ queryKey: ['wallets', user?.id] });
        if (res?.wallet?.id) await setActiveWalletMutation.mutateAsync(res.wallet.id);
        return res.wallet;
    };

    const renameWallet = async (walletId: string, name: string) => {
        if (isDemoMode) return;
        await walletsService.rename(walletId, name);
        queryClient.invalidateQueries({ queryKey: ['wallets', user?.id] });
    };

    const deleteWallet = async (walletId: string) => {
        if (isDemoMode) return;
        const res = await walletsService.remove(walletId);
        queryClient.invalidateQueries({ queryKey: ['wallets', user?.id] });
        // O backend já realoca a carteira ativa (na mesma transação) quando a
        // apagada era a corrente, e devolve o novo id — seta direto em vez de
        // esperar o próximo GET /wallets, senão a query key ['wallet', undefined]
        // busca uma vez e depois refaz pra ['wallet', novoId] (flash de loading).
        if (walletId === activeWalletId) selectWallet(res.activeWalletId || undefined);
    };

    // --- STATES & MEMOIZED CALCULATIONS ---

    // LÓGICA DE INJEÇÃO DO MODO DEMO
    // Memoizado porque o fallback `|| []` produzia um array NOVO a cada render:
    // `assets` é dependência do useMemo de `kpis` (e vai no value do contexto),
    // então sem isso os KPIs eram recalculados em todo render enquanto a query
    // não tivesse dados, e todo consumidor do contexto re-renderizava junto.
    const assets = useMemo(
        () => (isDemoMode ? DEMO_ASSETS : (walletQuery.data?.assets || [])),
        [isDemoMode, walletQuery.data?.assets]
    );
    const history = isDemoMode ? DEMO_HISTORY : (historyQuery.data || []);
    const serverKpis = isDemoMode ? DEMO_KPIS : walletQuery.data?.kpis;

    // KPIs híbridos
    const kpis = useMemo(() => {
        // Se estiver em demo, retorna os KPIs fixos do demo
        if (isDemoMode) return { ...DEMO_KPIS, dataQuality: 'AUDITED' as const, sharpeRatio: 1.8, beta: 0.85 };

        // Cálculo puro extraído para utils/kpiCalculations.ts (M5, testável).
        return computeWalletKpis(assets, serverKpis);
    }, [assets, serverKpis, isDemoMode]);

    const usdRate = walletQuery.data?.meta?.usdRate || 5.75;
    // `!isWalletScopeReady` entra aqui porque enquanto GET /wallets não responde as
    // queries estão desligadas — e query desligada tem isLoading=false. Sem isso a
    // carteira piscaria "vazia" antes de começar a carregar.
    const isLoading = !isDemoMode && !!user?.id && (!isWalletScopeReady || walletQuery.isLoading || historyQuery.isLoading);

    const isRefreshing = !isDemoMode && (
                         (walletQuery.isFetching && !walletQuery.isLoading) ||
                         (historyQuery.isFetching && !historyQuery.isLoading) ||
                         addAssetMutation.isPending ||
                         removeAssetMutation.isPending);

    const wallets = isDemoMode ? DEMO_WALLETS : (walletsQuery.data?.wallets || []);
    const activeWalletName = isDemoMode ? 'Demo' : (wallets.find(w => w.id === activeWalletId)?.name || 'Minha Carteira');

    // Fonte das abas que buscam sozinhas, com o escopo de carteira já embutido.
    // Memoizado porque vai no value do contexto: um objeto novo a cada render
    // reexecutaria as queries que o usam como dependência.
    const dataSource = useMemo<WalletDataSource>(() => ({
        getPerformance: () => walletService.getPerformance(activeWalletId),
        getDividends: () => walletService.getDividends(activeWalletId),
        getCashFlow: (page, limit, filterType) => walletService.getCashFlow(page, limit, filterType, activeWalletId),
    }), [activeWalletId]);

    return (
        <WalletContext.Provider value={{
            assets,
            kpis,
            history,
            targetAllocation,
            targetReserve,
            targetMonthlyDividendIncome,
            targetSubAllocation,
            usdRate,
            isLoading,
            isRefreshing,
            isPrivacyMode: isDemoMode ? false : isPrivacyMode, // Demo sempre visível
            togglePrivacyMode,
            isReadOnly: false,
            isValuesLocked: false,
            dataSource,
            refreshWallet: () => queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] }),
            addAsset,
            updateAsset,
            removeAsset,
            resetWallet,
            updateTargets,
            importCommit,
            importUndo,
            wallets,
            activeWalletId,
            isWalletScopeReady,
            activeWalletName,
            isWalletsLoading: !isDemoMode && walletsQuery.isLoading,
            isSwitchingWallet: setActiveWalletMutation.isPending,
            setActiveWallet,
            createWallet,
            renameWallet,
            deleteWallet,
        }}>
            {children}
        </WalletContext.Provider>
    );
};

export const useWallet = () => {
    const context = useContext(WalletContext);
    if (!context) throw new Error('useWallet deve ser usado dentro de um WalletProvider');
    return context;
};
