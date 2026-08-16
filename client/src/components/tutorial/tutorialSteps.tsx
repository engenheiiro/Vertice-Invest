import React from 'react';
import { Zap, TrendingUp, BarChart3, Lock, Navigation, MousePointerClick, Trophy, Radar, PieChart, Layers, Check } from 'lucide-react';
import { DEMO_KPIS } from '../../data/DEMO_DATA';

// --- TIPAGEM DOS PASSOS DO TUTORIAL ---
// Centraliza a definição dos fluxos para que o overlay apenas consuma os dados,
// permitindo testes de invariantes e desacoplamento da troca de abas da Carteira.

export type WalletTab = 'OVERVIEW' | 'PERFORMANCE' | 'DIVIDENDS' | 'STATEMENT';

export interface TutorialStep {
    title: string;
    content: React.ReactNode;
    /** Id do elemento DOM a destacar no desktop. `null` = card centralizado. */
    highlightId: string | null;
    /** Id alternativo do alvo no mobile (ex.: barra de navegação inferior). */
    mobileHighlightId?: string;
    /** Conteúdo alternativo no mobile (quando o layout difere do desktop). */
    mobileContent?: React.ReactNode;
    /** Aba da Carteira que deve estar ativa neste passo (substitui número mágico). */
    tab?: WalletTab;
    /** Último passo do fluxo (botão de conclusão/transição). */
    isFinal?: boolean;
    icon: React.ReactNode;
    badge: string;
}

/** Lista canônica de todos os ids de alvo usados pelo tutorial (para testes). */
export const TUTORIAL_TARGET_IDS = [
    'tour-nav-links',
    'tour-nav-mobile',
    'tour-equity',
    'tour-radar',
    'tour-allocation',
    'tour-dividends',
    'tour-wallet-kpis',
    'tour-wallet-actions',
    'tour-wallet-charts',
    'tour-wallet-tabs',
] as const;

// Números da carteira simulada saem de DEMO_KPIS — a mesma fonte que alimenta os
// cards ao fundo. Escritos à mão no texto, eles divergiam do que o usuário via na
// tela assim que alguém mexesse na demo.
const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}%`;
const DEMO_WEIGHTED = pct(DEMO_KPIS.weightedRentability);
const DEMO_ROI = pct(DEMO_KPIS.totalResultPercent);

// --- PASSOS DO TERMINAL (DASHBOARD) ---
export const DASHBOARD_STEPS: TutorialStep[] = [
    {
        title: "Bem-vindo à Elite",
        content: (
            <>
                <p className="mb-3">
                    Está na hora de você <span className="text-emerald-400 font-bold">aumentar seu patrimônio</span> sem depender de vídeos ou casas de análise com <span className="text-red-400 font-bold">interesses comerciais</span>.
                </p>
                <p>
                    Ao fundo você vê uma <span className="text-blue-400 font-bold">carteira simulada</span> com os ativos que nossa IA recomenda. Em 2 minutos, mostro como o terminal funciona.
                </p>
            </>
        ),
        highlightId: null,
        icon: <Zap className="text-blue-500" size={24} />,
        badge: "VÉRTICE INVEST"
    },
    {
        title: "Navegação",
        content: (
            <>
                No topo ficam todos os módulos:
                <ul className="list-disc pl-4 mt-2 space-y-1">
                    <li><strong className="text-emerald-400">Terminal:</strong> seu cockpit (onde estamos).</li>
                    <li><strong className="text-blue-400">Carteira:</strong> gestão dos seus ativos.</li>
                    <li><strong className="text-purple-400">Análise:</strong> relatórios da nossa IA.</li>
                    <li><strong className="text-pink-400">Ferramentas:</strong> macro, metas e cursos.</li>
                </ul>
            </>
        ),
        highlightId: 'tour-nav-links',
        mobileHighlightId: 'tour-nav-mobile',
        mobileContent: (
            <>
                Sua navegação fica aqui embaixo, ao alcance do polegar: <strong className="text-emerald-400">Terminal</strong>, <strong className="text-blue-400">Carteira</strong>, <strong className="text-purple-400">Research</strong> e <strong className="text-pink-400">Radar</strong>.
                <p className="mt-2">
                    Em <strong className="text-white">Mais</strong> você acessa Indicadores, Cursos, Metas e seu perfil.
                </p>
            </>
        ),
        icon: <Navigation className="text-indigo-400" size={24} />,
        badge: "MENU PRINCIPAL"
    },
    {
        title: "Resultado Comprovado",
        content: (
            <>
                <p className="mb-3">
                    Acompanhe sua evolução contra o mercado. A maioria das carteiras da internet luta para empatar com o CDI — aqui buscamos superar o <span className="text-blue-400 font-bold">Ibovespa</span> e o <span className="text-yellow-400 font-bold">S&amp;P 500</span>.
                </p>
                <p>
                    Nesta carteira simulada, a rentabilidade ponderada dos ativos passou de <span className="text-emerald-400 font-black">{DEMO_WEIGHTED}</span>, com retorno total de <span className="text-emerald-400 font-bold">{DEMO_ROI}</span> — comprando apenas o que a IA classifica como <span className="text-blue-400 font-bold">ultra seguro</span>.
                </p>
            </>
        ),
        highlightId: 'tour-equity',
        icon: <Trophy className="text-yellow-400" size={24} />,
        badge: "CASE DE SUCESSO"
    },
    {
        title: "Curadoria Quantitativa",
        content: (
            <>
                <p className="mb-3">
                    Esqueça a análise subjetiva: cada ativo recebe um <strong className="text-blue-400">Score de 0 a 100</strong>. O algoritmo penaliza <span className="text-red-400 font-bold">riscos ocultos</span> e premia <span className="text-emerald-400 font-bold">consistência</span> de balanço e caixa.
                </p>
                <div className="p-2 bg-slate-800/50 border border-slate-700 rounded-lg flex items-center gap-2">
                    <Lock size={12} className="text-slate-400 shrink-0" />
                    <p className="text-[10px] text-slate-400 italic">
                        Nomes ocultos nesta demonstração para proteção da estratégia.
                    </p>
                </div>
            </>
        ),
        highlightId: 'tour-allocation',
        icon: <BarChart3 className="text-indigo-500" size={24} />,
        badge: "SELEÇÃO IA"
    },
    {
        title: "Radar Alpha",
        content: (
            <>
                Enquanto você dorme, nossa <span className="text-purple-400 font-bold">IA monitora o mercado</span> em tempo real, sinalizando oportunidades de <span className="text-emerald-400 font-bold">compra</span> e alertas de <span className="text-red-400 font-bold">risco</span> antes que virem notícia.
            </>
        ),
        highlightId: 'tour-radar',
        icon: <Radar className="text-purple-500" size={24} />,
        badge: "INTELIGÊNCIA 24/7"
    },
    {
        title: "Cofre de Dividendos",
        content: (
            <>
                Focamos na sua <span className="text-emerald-400 font-bold">liberdade financeira</span>, não só na cotação: aqui você projeta quanto vai cair na conta todo mês — já filtrando <span className="text-red-400 font-bold">yield traps</span>.
            </>
        ),
        highlightId: 'tour-dividends',
        icon: <Lock className="text-gold" size={24} />,
        badge: "RENDA PASSIVA"
    },
    {
        title: "Próximos Passos",
        content: (
            <>
                Tour do <span className="text-emerald-400 font-bold">Terminal</span> concluído.
                <br /><br />
                Quer ver como funciona a sua <span className="text-emerald-400 font-bold">Carteira</span>? São só mais 4 passos.
            </>
        ),
        highlightId: null,
        isFinal: true,
        icon: <MousePointerClick className="text-white" size={24} />,
        badge: "DECISÃO"
    }
];

// --- PASSOS DA CARTEIRA ---
export const WALLET_STEPS: TutorialStep[] = [
    {
        title: "Sua Carteira",
        content: (
            <>
                <p className="mb-3">
                    Se o Terminal é onde você <strong>observa</strong>, aqui é onde você <strong>age</strong>.
                </p>
                <p>
                    Estes cards consolidam <span className="text-emerald-400 font-bold">patrimônio</span>, <span className="text-purple-400 font-bold">custo</span> e <span className="text-yellow-400 font-bold">resultado</span> — os mesmos números do Terminal, prontos para auditoria.
                </p>
            </>
        ),
        highlightId: 'tour-wallet-kpis',
        tab: 'OVERVIEW',
        icon: <TrendingUp className="text-emerald-500" size={24} />,
        badge: "VISÃO GERAL"
    },
    {
        title: "Ferramentas de Ação",
        content: (
            <ul className="list-disc pl-4 space-y-2">
                <li><strong className="text-emerald-400">Nova Transação:</strong> registra compra, venda ou provento.</li>
                <li><strong className="text-blue-400">Aporte Inteligente:</strong> diz onde investir dinheiro novo para manter o equilíbrio.</li>
                <li><strong className="text-gold">Rebalanceamento IA:</strong> sugere as vendas e compras do ajuste.</li>
            </ul>
        ),
        highlightId: 'tour-wallet-actions',
        tab: 'OVERVIEW',
        icon: <Zap className="text-yellow-400" size={24} />,
        badge: "EXECUÇÃO"
    },
    {
        title: "Estratégia e Alocação",
        content: (
            <>
                <p className="mb-3">
                    À esquerda, sua <strong>evolução patrimonial</strong>. À direita, a <strong>distribuição</strong> por classe — clique na engrenagem dela para definir a <strong className="text-white">% ideal</strong> que você quer em cada uma.
                </p>
                <p className="text-xs text-slate-400">
                    Logo abaixo fica a lista completa dos ativos, com preço médio, cotação e IA Score.
                </p>
            </>
        ),
        highlightId: 'tour-wallet-charts',
        tab: 'OVERVIEW',
        icon: <PieChart className="text-indigo-500" size={24} />,
        badge: "ESTRATÉGIA"
    },
    {
        title: "Aprofunde por Aba",
        content: (
            <ul className="list-disc pl-4 space-y-1.5">
                <li><strong className="text-emerald-400">Rentabilidade:</strong> sua cota contra CDI e Ibovespa, mês a mês.</li>
                <li><strong className="text-gold">Proventos:</strong> histórico e pagamentos já confirmados.</li>
                <li><strong className="text-blue-400">Extrato:</strong> cada lançamento registrado, para conferência.</li>
                <li><strong className="text-slate-300">Imposto de Renda:</strong> apuração pronta para a declaração.</li>
            </ul>
        ),
        highlightId: 'tour-wallet-tabs',
        tab: 'OVERVIEW',
        icon: <Layers className="text-blue-400" size={24} />,
        badge: "APROFUNDAMENTO"
    },
    {
        title: "Tudo Pronto",
        content: (
            <>
                Você já sabe o essencial para operar a plataforma.
                <br /><br />
                Encerrando o <strong>modo demonstração</strong> — a partir daqui, os números são os seus. Precisar rever o tour, ele está no seu <strong className="text-white">Perfil</strong>.
            </>
        ),
        highlightId: null,
        isFinal: true,
        tab: 'OVERVIEW',
        icon: <Check className="text-white" size={24} />,
        badge: "PRONTO PARA AÇÃO"
    }
];
