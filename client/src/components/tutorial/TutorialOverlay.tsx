
import React, { useEffect, useState, useLayoutEffect } from 'react';
import { useDemo } from '../../contexts/DemoContext';
import { X, ChevronRight, Check, Zap, TrendingUp, Shield, BarChart3, Lock, Navigation, MousePointerClick, Eye, Trophy, Radar } from 'lucide-react';
// @ts-ignore
import { useNavigate } from 'react-router-dom';

const STEPS = [
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
        highlightId: null, // Centro da tela
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
                    Ela mostra como estaria seu patrimônio <span className="text-emerald-400 font-bold">HOJE</span> se você tivesse começado a investir com a gente em <span className="text-blue-400 font-bold">2024</span>, comprando apenas <strong>1 cota</strong> de cada ativo que indicamos na carteira.
                </p>
                <p>
                    Mas antes, vou te mostrar a estrutura do nosso site:
                </p>
            </>
        ),
        highlightId: null, // Centro da tela
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
                    <li><strong className="text-[#D4AF37]">Cursos:</strong> Acesso à Vértice Academy.</li>
                </ul>
            </>
        ),
        highlightId: 'tour-nav-links',
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
                    Veja nos painéis destacados o poder da tecnologia: nossa IA entregou uma rentabilidade superior a <span className="text-emerald-400 font-black text-lg">+90%</span>.
                </p>
                <p>
                    Isso foi feito comprando ativos que nossa IA classifica como <span className="text-blue-400 font-bold">ultra seguros</span>, eliminando o risco de perda a longo prazo. É a inteligência artificial trabalhando pela sua aposentadoria.
                </p>
            </>
        ),
        highlightId: 'tour-equity', // Foca nos painéis de KPIs para mostrar os números
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
                <br/><br/>
                O <strong className="text-[#D4AF37]">Cofre de Dividendos</strong> projeta exatamente quanto vai cair na sua conta, filtrando <span className="text-red-400 font-bold">Yield Traps</span> (armadilhas de dividendos).
            </>
        ),
        highlightId: 'tour-dividends',
        icon: <Lock className="text-[#D4AF37]" size={24} />,
        badge: "CASH FLOW"
    },
    {
        title: "Próximos Passos",
        content: (
            <>
                Demonstração da sessão <span className="text-emerald-400 font-bold">Terminal</span> concluída. Agora é com você:
                <br/><br/>
                Gostaria de continuar a demonstração, seguindo para a aba <span className="text-emerald-400 font-bold">Carteira</span>?
            </>
        ),
        highlightId: null,
        isFinal: true,
        icon: <MousePointerClick className="text-white" size={24} />,
        badge: "DECISÃO"
    }
];

export const TutorialOverlay: React.FC = () => {
    const { isDemoMode, currentStep, nextStep, skipTutorial } = useDemo();
    const navigate = useNavigate();
    const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
    const [cardPosition, setCardPosition] = useState<{ top: number, left: number, placement: 'bottom' | 'top' | 'center' | 'left-side' }>({ top: 0, left: 0, placement: 'center' });
    
    const step = STEPS[currentStep];

    useLayoutEffect(() => {
        if (!isDemoMode) return;

        const updatePosition = () => {
            if (step.highlightId) {
                const element = document.getElementById(step.highlightId);
                if (element) {
                    const rect = element.getBoundingClientRect();
                    setTargetRect(rect);

                    const cardWidth = 420; // Largura máx do card
                    const cardHeight = 250; // Altura estimada
                    const spaceBelow = window.innerHeight - rect.bottom;
                    const spaceRight = window.innerWidth - rect.right;
                    
                    let top = rect.bottom + 24;
                    let left = rect.left;
                    let placement: 'bottom' | 'top' | 'center' | 'left-side' = 'bottom';

                    // Lógica de posicionamento horizontal
                    // Se o elemento estiver muito à direita (ex: sidebar), alinhar o card à esquerda do elemento ou alinhar pela direita
                    if (rect.left > window.innerWidth / 2) {
                        // Tenta alinhar a direita do card com a direita do elemento
                        left = rect.right - cardWidth;
                        
                        // Se mesmo assim vazar para a esquerda (tela pequena), ajusta
                        if (left < 20) left = 20;
                        
                        // Se o elemento for uma sidebar estreita, talvez seja melhor jogar o card para a esquerda do elemento
                        // Exemplo: Tour de dividendos ou Radar
                        if (rect.width < 350 && rect.left > cardWidth) {
                             left = rect.left - cardWidth - 24;
                             top = rect.top; // Alinha topo
                             placement = 'left-side';
                        }
                    } else {
                        // Lógica padrão para elementos à esquerda ou centro
                        if (left + cardWidth > window.innerWidth) {
                            left = window.innerWidth - cardWidth - 20;
                        }
                    }

                    // Lógica de posicionamento vertical (se não for lateral)
                    if (placement !== 'left-side') {
                        if (spaceBelow < cardHeight + 40) {
                            top = rect.top - cardHeight - 24;
                            placement = 'top';
                        }
                    }

                    setCardPosition({ top, left, placement });
                } else {
                    setTargetRect(null);
                    setCardPosition({ top: 0, left: 0, placement: 'center' });
                }
            } else {
                setTargetRect(null);
                setCardPosition({ top: 0, left: 0, placement: 'center' });
            }
        };

        const timer = setTimeout(updatePosition, 100);
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [currentStep, isDemoMode, step.highlightId]);

    const handleNext = () => {
        if (step.isFinal) {
            // "Sim, continuar" -> Vai para a carteira e encerra o tutorial do terminal
            skipTutorial();
            navigate('/wallet');
        } else {
            nextStep();
        }
    };

    if (!isDemoMode) return null;

    return (
        <div className="fixed inset-0 z-[9999] overflow-hidden pointer-events-none font-sans">
            
            {/* BACKDROP INTELIGENTE */}
            {targetRect ? (
                // Modo Spotlight (Elemento Focado)
                // Ajustado para usar BOX SHADOW com a mesma opacidade do modo fullscreen (0.45)
                <div 
                    className="absolute transition-all duration-700 ease-[cubic-bezier(0.25,0.1,0.25,1)] border border-blue-500/30 rounded-xl shadow-[0_0_40px_rgba(59,130,246,0.2)] animate-pulse bg-transparent"
                    style={{
                        top: targetRect.top - 4,
                        left: targetRect.left - 4,
                        width: targetRect.width + 8,
                        height: targetRect.height + 8,
                        // Aqui está o truque: A sombra gigante cria o overlay escuro ao redor do elemento focado.
                        // Ajustado alpha para 0.45 para igualar ao modo fullscreen.
                        boxShadow: '0 0 0 9999px rgba(2, 4, 10, 0.45)' 
                    }}
                />
            ) : (
                // Modo Fullscreen (Passos Iniciais)
                // Opacidade ajustada para 0.45 (45%)
                <div className="absolute inset-0 bg-[#02040a]/45 backdrop-blur-sm transition-opacity duration-700"></div>
            )}

            {/* CARD DE CONTEÚDO */}
            <div 
                className={`pointer-events-auto absolute transition-all duration-700 ease-[cubic-bezier(0.25,0.1,0.25,1)] w-[90%] max-w-[420px] flex flex-col ${cardPosition.placement === 'center' ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' : ''}`}
                style={cardPosition.placement !== 'center' ? { top: cardPosition.top, left: cardPosition.left } : {}}
            >
                <div className="bg-[#0F1729] border border-slate-700/60 rounded-2xl shadow-2xl relative overflow-hidden group">
                    
                    {/* Barra de Progresso Superior */}
                    <div className="absolute top-0 left-0 w-full h-1 bg-slate-800">
                        <div 
                            className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-500 transition-all duration-500"
                            style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
                        ></div>
                    </div>

                    {/* Efeito Glow de Fundo */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 rounded-full blur-[50px] pointer-events-none group-hover:bg-blue-600/20 transition-colors"></div>

                    <div className="p-6 relative z-10">
                        {/* Header do Card */}
                        <div className="flex justify-between items-start mb-5">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-700 shadow-sm">
                                    {step.icon}
                                </div>
                                <div>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-400 block mb-0.5">
                                        {step.badge}
                                    </span>
                                    <h3 className="text-lg font-bold text-white tracking-tight leading-none">{step.title}</h3>
                                </div>
                            </div>
                            <button 
                                onClick={skipTutorial}
                                className="text-slate-500 hover:text-white transition-colors p-1.5 hover:bg-slate-800 rounded-lg"
                                title="Fechar Tutorial"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Conteúdo */}
                        <div className="text-sm text-slate-300 leading-relaxed mb-6 border-l-2 border-slate-700 pl-4">
                            {step.content}
                        </div>

                        {/* Footer / Ações */}
                        <div className="flex items-center justify-between pt-4 border-t border-slate-800/50">
                            <div className="flex gap-1.5">
                                {STEPS.map((_, i) => (
                                    <div 
                                        key={i} 
                                        className={`h-1.5 rounded-full transition-all duration-300 ${i === currentStep ? 'w-6 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 'w-1.5 bg-slate-700'}`} 
                                    />
                                ))}
                            </div>

                            <button 
                                onClick={handleNext}
                                className={`
                                    flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all shadow-lg active:scale-95
                                    ${step.isFinal 
                                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-900/20' 
                                        : 'bg-white text-slate-950 hover:bg-blue-50 shadow-white/10'
                                    }
                                `}
                            >
                                {step.isFinal ? 'Sim, continuar' : 'Próximo'}
                                {step.isFinal ? <Check size={14} /> : <ChevronRight size={14} />}
                            </button>
                        </div>
                    </div>
                </div>
                
                {/* Seta Indicativa (Renderiza apenas se não for centro e não for lateral) */}
                {cardPosition.placement !== 'center' && cardPosition.placement !== 'left-side' && (
                    <div 
                        className={`absolute w-4 h-4 bg-[#0F1729] border-l border-t border-slate-700/60 transform rotate-45 left-8
                        ${cardPosition.placement === 'bottom' ? '-top-2 border-b-0 border-r-0 bg-[#0F1729]' : '-bottom-2 border-l-0 border-t-0 border-r border-b border-slate-700/60 bg-[#0F1729]'}
                        `}
                    ></div>
                )}
                
                {/* Seta Indicativa Lateral (Direita do card, apontando para o elemento à direita) */}
                {cardPosition.placement === 'left-side' && (
                    <div 
                        className="absolute top-8 -right-2 w-4 h-4 bg-[#0F1729] border-t border-r border-slate-700/60 transform rotate-45"
                    ></div>
                )}
            </div>

        </div>
    );
};
