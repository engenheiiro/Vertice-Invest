
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface DemoContextType {
    isDemoMode: boolean;
    startDemo: () => void;
    stopDemo: () => void;
    currentStep: number;
    nextStep: () => void;
    prevStep: () => void;
    resetStep: () => void; // Novo método
    skipTutorial: () => void;
}

const DemoContext = createContext<DemoContextType | undefined>(undefined);

export const DemoProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isDemoMode, setIsDemoMode] = useState(false);
    const [currentStep, setCurrentStep] = useState(0);

    // Verifica se é a primeira vez do usuário
    useEffect(() => {
        const hasSeenTutorial = localStorage.getItem('hasSeenTutorial_v2');
        const user = localStorage.getItem('user'); // Só mostra se estiver logado
        
        if (!hasSeenTutorial && user) {
            // Pequeno delay para não assustar o usuário assim que entra
            setTimeout(() => {
                // startDemo(); // Auto-start desativado para evitar conflito com login
            }, 1000);
        }
    }, []);

    const startDemo = () => {
        setIsDemoMode(true);
        setCurrentStep(0);
        document.body.style.overflow = 'hidden'; // Bloqueia scroll durante tutorial
    };

    const stopDemo = () => {
        setIsDemoMode(false);
        setCurrentStep(0);
        document.body.style.overflow = 'unset';
        localStorage.setItem('hasSeenTutorial_v2', 'true');
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
