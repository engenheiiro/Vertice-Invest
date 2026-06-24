import React from 'react';
import { Zap, TrendingUp, BarChart3, Lock, Navigation, MousePointerClick, Eye, Trophy, Radar, PieChart, Layout, Coins, FileText, Settings, Check } from 'lucide-react';

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
    'tour-wallet-intro',
    'tour-wallet-kpis',
    'tour-wallet-actions',
    'tour-wallet-charts',
    'tour-tab-performance',
    'tour-tab-dividends',
    'tour-tab-statement',
    'tour-wallet-list',
] as const;

// --- PASSOS DO DASHBOARD ---
export const DASHBOARD_STEPS: TutorialStep[] = [
    {
        title: "Bem-vindo à Elite",
        content: (
            <>
                <p className="mb-3">
                    Bem-vindo à elite da análise de dados. Está na hora de você <span className="text-emerald-400 font-bold">aumentar seu patrimônio</span>.
                </p>
                <p className="mb-3">
                    Deixe de depender de <span className="text-yellow-400 font-bold">vídeos</span> ou <span className="text-yellow-400 font-bold">casas de análises</span> com <span className="text-red-500 font-bold">interesses comerciais</span>.
                </p>
                <p className="text-xs text-slate-300 italic border-t border-slate-700 pt-2 mt-2">
                    Um bom investidor precisa saber as ferramentas que tem, <span className="text-white font-bold underline decoration-blue-500">não pule</span>!
                </p>
            </>
        ),
        highlightId: null,
        icon: <Zap className="text-blue-500" size={24} />,
        badge: "VÉRTICE INVEST"
    },
    {
        title: "Simulação de Carteira",
        content: (
            <>
                <p className="mb-3">
                    O que você verá ao fundo é uma carteira preenchida com os ativos que nossa <span className="text-blue-400 font-bold">IA</span> recomenda para você.
                </p>
                <p className="mb-3">
                    Ela mostra como estaria seu patrimônio <span className="text-emerald-400 font-bold">HOJE</span> se você tivesse começado a investir com a gente em <span className="text-blue-400 font-bold">2024</span>, comprando algumas cotas dos ativos que indicamos na carteira.
                </p>
                <p>
                    Mas antes, vou te mostrar a estrutura do nosso site:
                </p>
            </>
        ),
        highlightId: null,
        icon: <Eye className="text-emerald-400" size={24} />,
        badge: "DEMO MODE"
    },
    {
        title: "Navegação Estratégica",
        content: (
            <>
                Aqui no topo você tem acesso a todos os módulos do ecossistema:
                <ul className="list-disc pl-4 mt-2 space-y-1">
                    <li><strong className="text-emerald-400">Terminal:</strong> Seu cockpit de comando geral (onde estamos).</li>
                    <li><strong className="text-blue-400">Carteira:</strong> Gestão profunda de ativos e rebalanceamento.</li>
                    <li><strong className="text-purple-400">Research:</strong> Relatórios detalhados da nossa IA.</li>
                    <li><strong className="text-pink-400">Indicadores:</strong> Monitoramento Macro (Selic, IPCA, Bonds).</li>
                    <li><strong className="text-gold">Cursos:</strong> Acesso à Vértice Academy.</li>
                </ul>
            </>
        ),
        highlightId: 'tour-nav-links',
        mobileHighlightId: 'tour-nav-mobile',
        mobileContent: (
            <>
                Aqui embaixo fica sua barra de navegação principal, sempre ao alcance do polegar:
                <ul className="list-disc pl-4 mt-2 space-y-1">
                    <li><strong className="text-emerald-400">Terminal:</strong> Seu cockpit de comando geral (onde estamos).</li>
                    <li><strong className="text-blue-400">Carteira:</strong> Gestão profunda de ativos.</li>
                    <li><strong className="text-purple-400">Research:</strong> Relatórios da nossa IA.</li>
                    <li><strong className="text-pink-400">Radar:</strong> Oportunidades em tempo real.</li>
                </ul>
                <p className="mt-2">
                    Toque em <strong className="text-white">Mais</strong> para acessar Indicadores, Cursos, Metas e seu perfil.
                </p>
            </>
        ),
        icon: <Navigation className="text-indigo-400" size={24} />,
        badge: "MENU PRINCIPAL"
    },
    {
        title: "Patrimônio vs. Benchmark",
        content: (
            <>
                Acompanhe sua evolução contra o mercado. A maioria das <span className="text-red-400 font-bold">carteiras da internet</span> luta para empatar com o CDI. Aqui, buscamos superar o <span className="text-blue-400 font-bold">Ibovespa</span> e o <span className="text-yellow-400 font-bold">S&P 500</span> através de alocação tática inteligente.
            </>
        ),
        highlightId: 'tour-equity',
        icon: <TrendingUp className="text-emerald-500" size={24} />,
        badge: "PERFORMANCE REAL"
    },
    {
        title: "Resultado Comprovado",
        content: (
            <>
                <p className="mb-4">
                    Veja nos painéis destacados o poder da tecnologia: nesta carteira simulada, a rentabilidade ponderada dos ativos passou de <span className="text-emerald-400 font-black text-lg">+96%</span>, com um retorno total da carteira de <span className="text-emerald-400 font-bold">+42%</span>.
                </p>
                <p>
                    Isso foi feito comprando ativos que nossa IA classifica como <span className="text-blue-400 font-bold">ultra seguros</span>, eliminando o risco de perda a longo prazo. É a inteligência artificial trabalhando pela sua aposentadoria.
                </p>
            </>
        ),
        highlightId: 'tour-equity',
        icon: <Trophy className="text-yellow-400" size={24} />,
        badge: "CASE DE SUCESSO"
    },
    {
        title: "Radar Alpha",
        content: (
            <>
                <p className="mb-3">
                    Enquanto você dorme, nossa <span className="text-purple-400 font-bold">IA monitora o mercado</span> em tempo real.
                </p>
                <p>
                    O Radar Alpha identifica oportunidades de <span className="text-emerald-400 font-bold">Compra</span> e alertas de <span className="text-red-400 font-bold">Risco</span> baseados em fluxo institucional e assimetria de preço, antes que virem notícia.
                </p>
            </>
        ),
        highlightId: 'tour-radar',
        icon: <Radar className="text-purple-500" size={24} />,
        badge: "INTELIGÊNCIA 24/7"
    },
    {
        title: "Curadoria Quantitativa",
        content: (
            <>
                <p className="mb-3">
                    Esqueça a análise subjetiva. Nossa tabela classifica ativos por <strong className="text-blue-400">Score de Qualidade (0-100)</strong>.
                </p>
                <p className="mb-3">
                    O algoritmo penaliza <span className="text-red-400 font-bold">Riscos Ocultos</span> e <span className="text-emerald-400 font-bold">Premia Consistência</span> de balanço e fluxo de caixa.
                </p>
                <div className="mt-4 p-2 bg-slate-800/50 border border-slate-700 rounded-lg flex items-center gap-2">
                    <Lock size={12} className="text-slate-400" />
                    <p className="text-[10px] text-slate-400 italic">
                        Nomes dos ativos ocultos nesta demonstração para proteção da estratégia.
                    </p>
                </div>
            </>
        ),
        highlightId: 'tour-allocation',
        icon: <BarChart3 className="text-indigo-500" size={24} />,
        badge: "SELEÇÃO IA"
    },
    {
        title: "Previsibilidade de Renda",
        content: (
            <>
                Diferente de outras plataformas que focam apenas na cotação, focamos na sua <span className="text-emerald-400 font-bold">Liberdade Financeira</span>.
                <br /><br />
                O <strong className="text-gold">Cofre de Dividendos</strong> projeta exatamente quanto vai cair na sua conta, filtrando <span className="text-red-400 font-bold">Yield Traps</span> (armadilhas de dividendos).
            </>
        ),
        highlightId: 'tour-dividends',
        icon: <Lock className="text-gold" size={24} />,
        badge: "CASH FLOW"
    },
    {
        title: "Próximos Passos",
        content: (
            <>
                Demonstração da sessão <span className="text-emerald-400 font-bold">Terminal</span> concluída. Agora é com você:
                <br /><br />
                Gostaria de continuar a demonstração, seguindo para a aba <span className="text-emerald-400 font-bold">Carteira</span>?
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
        title: "Módulo de Gestão",
        content: (
            <>
                <p className="mb-3">
                    Bem-vindo à sua <strong>Carteira</strong>.
                </p>
                <p>
                    Diferente do <span className="text-emerald-400 font-bold">Terminal</span> (focado em dados de mercado), aqui é onde você <strong>age</strong>. É o seu centro de controle operacional para aportes, rebalanceamento e controle tributário.
                </p>
            </>
        ),
        highlightId: 'tour-wallet-intro',
        tab: 'OVERVIEW',
        icon: <Layout className="text-emerald-500" size={24} />,
        badge: "VISÃO GERAL"
    },
    {
        title: "Dados Unificados",
        content: (
            <>
                Os mesmos indicadores essenciais que você vê no Terminal aparecem aqui, mas consolidados para auditoria.
                <br /><br />
                Acompanhe <span className="text-emerald-400 font-bold">Patrimônio</span>, <span className="text-purple-400 font-bold">Custo</span> e <span className="text-yellow-400 font-bold">Resultado</span> em um único bloco.
            </>
        ),
        highlightId: 'tour-wallet-kpis',
        tab: 'OVERVIEW',
        icon: <TrendingUp className="text-blue-500" size={24} />,
        badge: "AUDITORIA"
    },
    {
        title: "Ferramentas de Ação",
        content: (
            <>
                Aqui você opera sua estratégia:
                <ul className="list-disc pl-4 mt-3 space-y-2 text-xs">
                    <li><strong className="text-emerald-400">Nova Transação:</strong> Registro manual rápido.</li>
                    <li><strong className="text-blue-400">Aporte Inteligente:</strong> Algoritmo que diz onde investir dinheiro novo para manter o equilíbrio.</li>
                    <li><strong className="text-gold">Rebalanceamento IA:</strong> (Black) Automação de venda e compra.</li>
                </ul>
            </>
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
                    À esquerda, veja sua <strong>Evolução Patrimonial</strong>. À direita, o gráfico de <strong>Distribuição</strong>.
                </p>
                <p className="flex items-center gap-2 p-2 bg-slate-800 rounded border border-slate-700">
                    <Settings size={14} className="text-slate-400" />
                    <span className="text-[10px]">
                        Você pode clicar na engrenagem do gráfico de Distribuição para definir manualmente a <strong className="text-white">% Ideal</strong> que deseja para cada classe de ativo.
                    </span>
                </p>
            </>
        ),
        highlightId: 'tour-wallet-charts',
        tab: 'OVERVIEW',
        icon: <PieChart className="text-indigo-500" size={24} />,
        badge: "ESTRATÉGIA"
    },
    {
        title: "Rentabilidade Detalhada",
        content: (
            <>
                Na aba <strong>Rentabilidade</strong>, você encontra um gráfico comparativo avançado.
                <br /><br />
                Ele mostra o retorno real da sua carteira (cotas) comparado contra o <span className="text-yellow-400 font-bold">CDI</span> e o <span className="text-slate-400 font-bold">Ibovespa</span>, além de uma tabela mês a mês.
            </>
        ),
        highlightId: 'tour-tab-performance',
        tab: 'PERFORMANCE',
        icon: <BarChart3 className="text-emerald-500" size={24} />,
        badge: "PERFORMANCE"
    },
    {
        title: "Controle de Proventos",
        content: (
            <>
                A aba <strong>Proventos</strong> organiza todos os dividendos recebidos e provisionados.
                <br /><br />
                Veja o histórico mensal em barras e a lista futura de pagamentos confirmados.
            </>
        ),
        highlightId: 'tour-tab-dividends',
        tab: 'DIVIDENDS',
        icon: <Coins className="text-gold" size={24} />,
        badge: "RENDA PASSIVA"
    },
    {
        title: "Extrato Completo",
        content: (
            <>
                Por fim, a aba <strong>Extrato</strong> funciona como sua conta corrente de investimentos.
                <br /><br />
                Cada compra, venda, aporte ou recebimento de dividendo fica registrado aqui de forma imutável para sua conferência.
            </>
        ),
        highlightId: 'tour-tab-statement',
        tab: 'STATEMENT',
        icon: <FileText className="text-blue-400" size={24} />,
        badge: "HISTÓRICO"
    },
    {
        title: "Detalhamento de Ativos",
        content: (
            <>
                Abaixo dos gráficos, você tem a lista completa dos seus ativos, separados por classe (Ações, FIIs, etc).
                <br /><br />
                Você pode expandir cada grupo para ver preço médio, cotação atual e o <strong>IA Score</strong> individual.
            </>
        ),
        highlightId: 'tour-wallet-list',
        tab: 'OVERVIEW',
        icon: <Layout className="text-slate-400" size={24} />,
        badge: "INVENTÁRIO"
    },
    {
        title: "Tour Concluído",
        content: (
            <>
                Você agora domina as principais ferramentas da plataforma Vértice Invest.
                <br /><br />
                O <strong>Modo Demonstração</strong> será encerrado para que você possa começar a construir seu próprio legado.
            </>
        ),
        highlightId: null,
        isFinal: true,
        tab: 'OVERVIEW',
        icon: <Check className="text-white" size={24} />,
        badge: "PRONTO PARA AÇÃO"
    }
];
