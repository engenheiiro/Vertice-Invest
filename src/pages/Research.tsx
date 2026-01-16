import React from 'react';
import { BrainCircuit } from 'lucide-react';
import { Header } from '../components/dashboard/Header';
import { ModulePlaceholder } from '../components/common/ModulePlaceholder';

export const Research = () => {
    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />
            <main className="max-w-[1600px] mx-auto p-6">
                <ModulePlaceholder 
                    title="Vértice Research Pro"
                    description="Relatórios institucionais, Valuation automático de ativos globais e acesso ao nosso Datastream em tempo real."
                    minPlan="PRO"
                    icon={<BrainCircuit size={40} />}
                />
            </main>
        </div>
    );
};

export default Research;