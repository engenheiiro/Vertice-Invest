
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';
// @ts-ignore
import { useLocation } from 'react-router-dom';

interface DemoContextType {
    isDemoMode: boolean;
    startDemo: () => void;
    stopDemo: () => void;
    currentStep: number;
    nextStep: () => void;
    prevStep: () => void;
    resetStep: () => void;
    skipTutorial: () => void;
}

const DemoContext = createContext<DemoContextType | undefined>(undefined);

export const DemoProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const location = useLocation();
    const [isDemoMode, setIsDemoMode] = useState(false);
    const [currentStep, setCurrentStep] = useState(0);

    // Verifica se é a primeira vez do usuário ao carregar a aplicação
    useEffect(() => {
        // Só executa se tiver usuário logado e estiver na rota do Dashboard
        if (user?.id && location.pathname.includes('/dashboard')) {
            
            // CHAVE ÚNICA POR USUÁRIO: Garante que contas novas vejam o tutorial
            const storageKey = `tutorial_seen_v4_${user.id}`;
            const hasSeen = localStorage.getItem(storageKey);
            
            if (!hasSeen) {
                console.log(`✨ Novo usuário detectado (${user.name}): Agendando Tutorial...`);
                
                // Delay de 1.2s para garantir que a UI carregou e animações iniciais terminaram
                const timer = setTimeout(() => {
                    startDemo(); 
                }, 1200);
                
                return () => clearTimeout(timer);
            }
        }
    }, [user?.id, location.pathname]); 

    const startDemo = () => {
        setIsDemoMode(true);
        setCurrentStep(0);
        document.body.style.overflow = 'hidden'; // Bloqueia scroll do body durante o tour
    };

    const stopDemo = () => {
        setIsDemoMode(false);
        setCurrentStep(0);
        document.body.style.overflow = 'unset';
        
        // Marca como visto apenas para este usuário específico
        if (user?.id) {
            const storageKey = `tutorial_seen_v4_${user.id}`;
            localStorage.setItem(storageKey, 'true');
        }
    };

    const nextStep = () => {
        setCurrentStep(prev => prev + 1);
    };

    const prevStep = () => {
        setCurrentStep(prev => Math.max(0, prev - 1));
    };

    const resetStep = () => {
        setCurrentStep(0);
    };

    const skipTutorial = () => {
        stopDemo();
    };

    return (
        <DemoContext.Provider value={{ 
            isDemoMode, 
            startDemo, 
            stopDemo, 
            currentStep, 
            nextStep, 
            prevStep,
            resetStep,
            skipTutorial 
        }}>
            {children}
        </DemoContext.Provider>
    );
};

export const useDemo = () => {
    const context = useContext(DemoContext);
    if (!context) throw new Error('useDemo must be used within a DemoProvider');
    return context;
};
