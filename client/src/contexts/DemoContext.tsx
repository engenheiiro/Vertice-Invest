
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';
// @ts-ignore
import { useLocation } from 'react-router-dom';
import { authService } from '../services/auth';

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
    const { user, updateUserTutorialStatus } = useAuth();
    const location = useLocation();
    const [isDemoMode, setIsDemoMode] = useState(false);
    const [currentStep, setCurrentStep] = useState(0);

    // Verifica se é a primeira vez do usuário ao carregar a aplicação
    useEffect(() => {
        // Só executa se tiver usuário logado e estiver na rota do Dashboard
        if (user?.id && location.pathname.includes('/dashboard')) {
            
            // LÓGICA V5: Verifica a flag persistida no banco, não no localStorage.
            if (user.hasSeenTutorial === false) {
                console.log(`✨ Novo usuário detectado (${user.name}): Agendando Tutorial...`);
                
                const timer = setTimeout(() => {
                    startDemo(); 
                }, 1200);
                
                return () => clearTimeout(timer);
            }
        }
    }, [user?.id, user?.hasSeenTutorial, location.pathname]); 

    const startDemo = () => {
        setIsDemoMode(true);
        setCurrentStep(0);
        document.body.style.overflow = 'hidden'; 
    };

    const stopDemo = () => {
        setIsDemoMode(false);
        setCurrentStep(0);
        document.body.style.overflow = 'unset';
        
        // Marca como visto no BANCO DE DADOS
        if (user?.id && !user.hasSeenTutorial) {
            authService.markTutorialSeen().catch(err => console.error("Falha ao salvar status do tutorial:", err));
            updateUserTutorialStatus(); // Atualiza contexto local imediatamente
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
