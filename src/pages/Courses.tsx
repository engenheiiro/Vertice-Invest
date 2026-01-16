import React from 'react';
import { GraduationCap } from 'lucide-react';
import { Header } from '../components/dashboard/Header';
import { ModulePlaceholder } from '../components/common/ModulePlaceholder';

export const Courses = () => {
    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />
            <main className="max-w-[1600px] mx-auto p-6">
                <ModulePlaceholder 
                    title="Vértice Academy"
                    description="Trilhas de aprendizado masterclass com gestores de fundos, cobrindo desde Análise Técnica até Macroeconomia Global."
                    minPlan="ESSENTIAL"
                    icon={<GraduationCap size={40} />}
                />
            </main>
        </div>
    );
};

export default Courses;