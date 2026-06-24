import React, { useState, useLayoutEffect, useEffect, useRef, useCallback } from 'react';
import { useDemo } from '../../contexts/DemoContext';
import { X, ChevronRight, ChevronLeft, Check } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useIsMobile } from '../../hooks/useIsMobile';
import { DASHBOARD_STEPS, WALLET_STEPS, TutorialStep } from './tutorialSteps';

type Placement = 'bottom' | 'top' | 'center' | 'left-side' | 'right-side';

export const TutorialOverlay: React.FC = () => {
    const { isDemoMode, currentStep, nextStep, prevStep, skipTutorial, resetStep } = useDemo();
    const navigate = useNavigate();
    const location = useLocation();
    const isMobile = useIsMobile();

    // Seleciona os passos baseados na rota atual
    const steps = location.pathname === '/wallet' ? WALLET_STEPS : DASHBOARD_STEPS;

    // Proteção contra índice inválido ao trocar de rota
    const safeStepIndex = Math.min(currentStep, steps.length - 1);
    const rawStep: TutorialStep | undefined = steps[safeStepIndex];

    // Resolve alvo/conteúdo efetivos por viewport (variante mobile do passo de navegação)
    const effectiveHighlightId = rawStep
        ? (isMobile && rawStep.mobileHighlightId ? rawStep.mobileHighlightId : rawStep.highlightId)
        : null;
    const effectiveContent = rawStep
        ? (isMobile && rawStep.mobileContent ? rawStep.mobileContent : rawStep.content)
        : null;

    const cardRef = useRef<HTMLDivElement | null>(null);
    const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
    const [cardPosition, setCardPosition] = useState<{ top: number, left: number, placement: Placement }>({ top: 0, left: 0, placement: 'center' });

    useLayoutEffect(() => {
        if (!isDemoMode || !rawStep) return;

        const updatePosition = () => {
            const targetId = effectiveHighlightId;
            const element = targetId ? document.getElementById(targetId) : null;
            const rect = element?.getBoundingClientRect();

            // Guard: sem alvo, ou alvo oculto (display:none -> rect zerado) => card centralizado
            if (!element || !rect || rect.width < 1 || rect.height < 1) {
                setTargetRect(null);
                setCardPosition({ top: 0, left: 0, placement: 'center' });
                return;
            }

            setTargetRect(rect);

            // Mede o card de verdade (a altura varia muito conforme o conteúdo)
            const cardWidth = cardRef.current?.offsetWidth || Math.min(window.innerWidth * 0.9, 420);
            const cardHeight = cardRef.current?.offsetHeight || 250;
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceRight = window.innerWidth - rect.right;

            let top = rect.bottom + 24;
            let left = rect.left;
            let placement: Placement = 'bottom';

            // Barra de navegação inferior fixa (mobile): card SEMPRE acima do alvo
            if (targetId === 'tour-nav-mobile') {
                left = rect.left;
                top = rect.top - cardHeight - 24;
                placement = 'top';
            }
            // Lógica Especial para Radar Alpha (Forçar Esquerda)
            else if (targetId === 'tour-radar') {
                left = rect.left - cardWidth - 24;
                top = rect.top;
                placement = 'left-side';

                if (left < 10) {
                    left = rect.left;
                    top = rect.bottom + 24;
                    placement = 'bottom';
                }
            }
            // Lógica Especial para Abas da Carteira (preferir abaixo)
            else if (targetId?.startsWith('tour-tab-')) {
                if (spaceRight > cardWidth + 20 && window.innerWidth >= 1024) {
                    top = rect.bottom + 12;
                }
                placement = 'bottom';
            }
            else {
                // Lógica Padrão Inteligente
                if (rect.left > window.innerWidth / 2) {
                    left = rect.right - cardWidth;
                    if (left < 20) left = 20;

                    // Sidebar estreita à direita -> Card à esquerda
                    if (rect.width < 350 && rect.left > cardWidth) {
                        left = rect.left - cardWidth - 24;
                        top = rect.top;
                        placement = 'left-side';
                    }
                } else {
                    if (left + cardWidth > window.innerWidth) {
                        left = window.innerWidth - cardWidth - 20;
                    }
                }

                if (placement !== 'left-side') {
                    if (spaceBelow < cardHeight + 40) {
                        top = rect.top - cardHeight - 24;
                        placement = 'top';
                    }
                }
            }

            // Clamp para dentro da viewport — evita corte em telas pequenas (notebook/mobile)
            left = Math.max(10, Math.min(left, window.innerWidth - cardWidth - 10));
            top = Math.max(10, Math.min(top, window.innerHeight - cardHeight - 10));

            setCardPosition({ top, left, placement });
        };

        // Rola o alvo até o centro da viewport antes de medir (alvos abaixo da dobra)
        const targetEl = effectiveHighlightId ? document.getElementById(effectiveHighlightId) : null;
        if (targetEl) {
            targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }

        // Atualiza imediatamente e após a renderização/scroll suave assentar
        updatePosition();
        const t1 = setTimeout(updatePosition, 100);
        const t2 = setTimeout(updatePosition, 400);

        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [safeStepIndex, isDemoMode, effectiveHighlightId, location.pathname]);

    const handleNext = useCallback(() => {
        if (!rawStep) return;
        if (rawStep.isFinal) {
            if (location.pathname === '/wallet') {
                // Fim do tour da carteira -> Encerra Demo
                skipTutorial();
                navigate('/dashboard');
            } else {
                // Fim do tour do dashboard -> Vai para Carteira
                resetStep(); // Reseta contador para 0
                navigate('/wallet');
            }
        } else {
            nextStep();
        }
    }, [rawStep, location.pathname, skipTutorial, navigate, resetStep, nextStep]);

    // Navegação por teclado (Esc fecha, setas/Enter navegam)
    useEffect(() => {
        if (!isDemoMode) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                skipTutorial();
            } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
                e.preventDefault();
                handleNext();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (safeStepIndex > 0) prevStep();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isDemoMode, handleNext, prevStep, skipTutorial, safeStepIndex]);

    if (!isDemoMode || !rawStep) return null;

    const isFinal = !!rawStep.isFinal;
    const canGoBack = safeStepIndex > 0;

    return (
        <div className="fixed inset-0 z-[9999] overflow-hidden pointer-events-none font-sans">

            {/* BACKDROP INTELIGENTE */}
            {targetRect ? (
                <div
                    className="absolute transition-all duration-700 ease-[cubic-bezier(0.25,0.1,0.25,1)] border border-blue-500/30 rounded-xl shadow-[0_0_40px_rgba(59,130,246,0.2)] animate-pulse bg-transparent"
                    style={{
                        top: targetRect.top - 4,
                        left: targetRect.left - 4,
                        width: targetRect.width + 8,
                        height: targetRect.height + 8,
                        boxShadow: '0 0 0 9999px rgba(2, 4, 10, 0.45)'
                    }}
                />
            ) : (
                <div className="absolute inset-0 bg-deep/45 backdrop-blur-sm transition-opacity duration-700"></div>
            )}

            {/* CARD DE CONTEÚDO */}
            <div
                ref={cardRef}
                role="dialog"
                aria-modal="true"
                aria-label={`Tutorial: ${rawStep.title}`}
                className={`pointer-events-auto absolute transition-all duration-700 ease-[cubic-bezier(0.25,0.1,0.25,1)] w-[90%] max-w-[420px] flex flex-col ${cardPosition.placement === 'center' ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' : ''}`}
                style={cardPosition.placement !== 'center' ? { top: cardPosition.top, left: cardPosition.left } : {}}
            >
                <div className="bg-elevated border border-slate-700/60 rounded-2xl shadow-2xl relative overflow-hidden group">

                    {/* Barra de Progresso Superior */}
                    <div className="absolute top-0 left-0 w-full h-1 bg-slate-800">
                        <div
                            className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-500 transition-all duration-500"
                            style={{ width: `${((safeStepIndex + 1) / steps.length) * 100}%` }}
                        ></div>
                    </div>

                    {/* Efeito Glow de Fundo */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 rounded-full blur-[50px] pointer-events-none group-hover:bg-blue-600/20 transition-colors"></div>

                    <div className="p-6 relative z-10">
                        {/* Header do Card */}
                        <div className="flex justify-between items-start mb-5">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-700 shadow-sm">
                                    {rawStep.icon}
                                </div>
                                <div>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-400 block mb-0.5">
                                        {rawStep.badge}
                                    </span>
                                    <h3 className="text-lg font-bold text-white tracking-tight leading-none">{rawStep.title}</h3>
                                </div>
                            </div>
                            <button
                                onClick={skipTutorial}
                                className="text-slate-500 hover:text-white transition-colors p-1.5 hover:bg-slate-800 rounded-lg"
                                title="Fechar Tutorial"
                                aria-label="Fechar Tutorial"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Conteúdo */}
                        <div className="text-sm text-slate-300 leading-relaxed mb-6 border-l-2 border-slate-700 pl-4">
                            {effectiveContent}
                        </div>

                        {/* Footer / Ações */}
                        <div className="flex items-center justify-between pt-4 border-t border-slate-800/50">
                            <div className="flex items-center gap-3">
                                {canGoBack && (
                                    <button
                                        onClick={prevStep}
                                        className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-white transition-colors px-1 py-1 rounded-lg"
                                        aria-label="Passo anterior"
                                    >
                                        <ChevronLeft size={14} /> Voltar
                                    </button>
                                )}
                                <div className="flex gap-1.5">
                                    {steps.map((_, i) => (
                                        <div
                                            key={i}
                                            className={`h-1.5 rounded-full transition-all duration-300 ${i === safeStepIndex ? 'w-6 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 'w-1.5 bg-slate-700'}`}
                                        />
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={handleNext}
                                className={`
                                    flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all shadow-lg active:scale-95
                                    ${isFinal
                                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-900/20'
                                        : 'bg-white text-slate-950 hover:bg-blue-50 shadow-white/10'
                                    }
                                `}
                            >
                                {isFinal ? (location.pathname === '/wallet' ? 'Concluir Demo' : 'Sim, continuar') : 'Próximo'}
                                {isFinal ? <Check size={14} /> : <ChevronRight size={14} />}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Seta Indicativa */}
                {cardPosition.placement !== 'center' && cardPosition.placement !== 'left-side' && (
                    <div
                        className={`absolute w-4 h-4 bg-elevated border-l border-t border-slate-700/60 transform rotate-45 left-8
                        ${cardPosition.placement === 'bottom' ? '-top-2 border-b-0 border-r-0 bg-elevated' : '-bottom-2 border-l-0 border-t-0 border-r border-b border-slate-700/60 bg-elevated'}
                        `}
                    ></div>
                )}

                {/* Seta Indicativa Lateral (Direita do card) */}
                {cardPosition.placement === 'left-side' && (
                    <div
                        className="absolute top-8 -right-2 w-4 h-4 bg-elevated border-t border-r border-slate-700/60 transform rotate-45"
                    ></div>
                )}
            </div>

        </div>
    );
};
