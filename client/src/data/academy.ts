export const COURSES = [
    {
        _id: 'course-pp',
        title: "Primeiros Passos",
        description: "Como configurar sua conta, importar sua carteira e entender os conceitos básicos de rentabilidade e risco.",
        thumbnail: "/assets/academy/courses/guest.png",
        requiredPlan: "GUEST",
        category: "Trilhas de Formação",
        order: 1
    },
    {
        _id: 'course-fi',
        title: "Fundamentos do Investidor",
        description: "Domine o Tesouro Direto, CDBs, Ações e FIIs. Aprenda a montar uma reserva de emergência sólida.",
        thumbnail: "/assets/academy/courses/essential.png",
        requiredPlan: "ESSENTIAL",
        category: "Trilhas de Formação",
        order: 2
    },
    {
        _id: 'course-ve',
        title: "Valuation e Estratégia",
        description: "Análise Fundamentalista profunda, múltiplos de mercado, Backtesting e o uso da IA Vértice para decisões.",
        thumbnail: "/assets/academy/courses/pro.png",
        requiredPlan: "PRO",
        category: "Trilhas de Formação",
        order: 3
    },
    {
        _id: 'course-me',
        title: "Masterclass & Estudos de Caso",
        description: "Asset Allocation avançado, Estratégia Barbell, Psicologia Financeira e análise de grandes crises históricas.",
        thumbnail: "/assets/academy/courses/black.png",
        requiredPlan: "BLACK",
        category: "Trilhas de Formação",
        order: 4
    }
];

export const LESSONS: Record<string, any[]> = {
    'course-pp': [
        { _id: 'pp-1', title: "Como configurar sua conta e importar sua carteira na Vértice.", description: "Aprenda a dar os primeiros passos e integrar seus ativos.", thumbnail: "/assets/academy/lessons/pp-1.png", youtubeId: "M7lc1UVf-VE", duration: 600 },
        { _id: 'pp-2', title: "Entendendo o Dashboard: Rentabilidade e CDI.", description: "Como interpretar os gráficos e métricas da sua conta.", thumbnail: "/assets/academy/lessons/pp-2.png", youtubeId: "M7lc1UVf-VE", duration: 720 },
        { _id: 'pp-3', title: "O que é inflação e Juros Compostos.", description: "Os pilares matemáticos que destroem ou constroem riqueza.", thumbnail: "/assets/academy/lessons/pp-3.png", youtubeId: "jNQXAC9IVRw", duration: 840 },
        { _id: 'pp-4', title: "Renda Fixa vs Renda Variável: O básico.", description: "Entenda a diferença fundamental entre os tipos de ativos.", thumbnail: "/assets/academy/lessons/pp-4.png", youtubeId: "9bZkp7q19f0", duration: 900 },
        { _id: 'pp-5', title: "Descobrindo seu Perfil de Risco.", description: "Saiba qual estratégia combina com seu estômago financeiro.", thumbnail: "/assets/academy/lessons/pp-5.png", youtubeId: "dQw4w9WgXcQ", duration: 600 },
    ],
    'course-fi': [
        { _id: 'fi-1', title: "Tesouro Direto a fundo: Selic, IPCA+ e Prefixado.", description: "Tudo sobre o investimento mais seguro do país.", thumbnail: "/assets/academy/lessons/fi-1.png", youtubeId: "dQw4w9WgXcQ", duration: 1200 },
        { _id: 'fi-2', title: "CDBs, LCIs e LCAs: Entendendo o FGC.", description: "Como investir em bancos com a proteção do Fundo Garantidor.", thumbnail: "/assets/academy/lessons/fi-2.png", youtubeId: "dQw4w9WgXcQ", duration: 1100 },
        { _id: 'fi-3', title: "O que são Ações e como a Bolsa funciona.", description: "O mercado de capitais desmistificado.", thumbnail: "/assets/academy/lessons/fi-3.png", youtubeId: "dQw4w9WgXcQ", duration: 1500 },
        { _id: 'fi-4', title: "O que são FIIs e a mágica dos dividendos.", description: "Receba aluguéis mensais sem ter um imóvel físico.", thumbnail: "/assets/academy/lessons/fi-4.png", youtubeId: "dQw4w9WgXcQ", duration: 1300 },
        { _id: 'fi-5', title: "Como montar uma reserva de emergência à prova de balas.", description: "Onde colocar o dinheiro que você não pode perder.", thumbnail: "/assets/academy/lessons/fi-5.png", youtubeId: "dQw4w9WgXcQ", duration: 900 },
    ],
    'course-ve': [
        { _id: 've-1', title: "Análise Fundamentalista: Lendo o balanço de uma empresa.", description: "Aprenda a separar empresas boas de empresas ruins.", thumbnail: "/assets/academy/lessons/ve-1.png", youtubeId: "dQw4w9WgXcQ", duration: 1800 },
        { _id: 've-2', title: "Múltiplos de Preço e Eficiência (P/L, P/VP, ROE, Margem).", description: "Os indicadores que os profissionais usam para precificar.", thumbnail: "/assets/academy/lessons/ve-2.png", youtubeId: "dQw4w9WgXcQ", duration: 1600 },
        { _id: 've-3', title: "Como analisar FIIs de Tijolo e Papel.", description: "Métricas específicas para o mercado imobiliário.", thumbnail: "/assets/academy/lessons/ve-3.png", youtubeId: "dQw4w9WgXcQ", duration: 1400 },
        { _id: 've-4', title: "Engenharia de Prompts: Extraindo o máximo do Vértice AI.", description: "Potencialize suas análises com inteligência artificial.", thumbnail: "/assets/academy/lessons/ve-4.png", youtubeId: "dQw4w9WgXcQ", duration: 1200 },
        { _id: 've-5', title: "Backtesting: Como testar estratégias no passado com o Radar Alpha.", description: "Não opere na sorte, teste sua tese com dados históricos.", thumbnail: "/assets/academy/lessons/ve-5.png", youtubeId: "dQw4w9WgXcQ", duration: 1500 },
        { _id: 've-6', title: "Criptomoedas: Bitcoin, Ethereum e Ciclos de Halving.", description: "O novo ouro digital e como se posicionar.", thumbnail: "/assets/academy/lessons/ve-6.png", youtubeId: "dQw4w9WgXcQ", duration: 1800 },
    ],
    'course-me': [
        { _id: 'me-1', title: "Asset Allocation e Correlação de Ativos (Blindagem de Carteira).", description: "A matemática por trás de uma carteira inabalável.", thumbnail: "/assets/academy/lessons/me-1.png", youtubeId: "dQw4w9WgXcQ", duration: 2000 },
        { _id: 'me-2', title: "Estratégia Barbell: Misturando segurança extrema com risco extremo.", description: "A estratégia de Nassim Taleb para antifragilidade.", thumbnail: "/assets/academy/lessons/me-2.png", youtubeId: "dQw4w9WgXcQ", duration: 1800 },
        { _id: 'me-3', title: "Estudo de Caso: A quebra do Lehman Brothers e a Crise de 2008.", description: "Lições históricas sobre o colapso do sistema financeiro.", thumbnail: "/assets/academy/lessons/me-3.png", youtubeId: "dQw4w9WgXcQ", duration: 2400 },
        { _id: 'me-4', title: "Estudo de Caso: Anatomia de fraudes (Americanas, Enron).", description: "Como identificar mentiras em relatórios financeiros.", thumbnail: "/assets/academy/lessons/me-4.png", youtubeId: "dQw4w9WgXcQ", duration: 2100 },
        { _id: 'me-5', title: "Finanças Comportamentais: Vieses cognitivos (FOMO, FUD).", description: "Por que seu cérebro te faz perder dinheiro.", thumbnail: "/assets/academy/lessons/me-5.png", youtubeId: "dQw4w9WgXcQ", duration: 1600 },
        { _id: 'me-6', title: "Lotes Fiscais (FIFO) avançado e elisão fiscal legal.", description: "Otimização tributária para grandes investidores.", thumbnail: "/assets/academy/lessons/me-6.png", youtubeId: "dQw4w9WgXcQ", duration: 1900 },
    ]
};
