
import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ShieldCheck, Sparkles, GraduationCap, Lock, PieChart, BrainCircuit, Layers, Activity } from 'lucide-react';

export const AuthLayout: React.FC = () => {
  const [activeSlide, setActiveSlide] = useState(0);
  const location = useLocation();

  const isWideContent = location.pathname === '/terms';

  const slides = [
    {
      icon: <Sparkles size={18} className="text-cyan-400" />,
      title: "IA Research & Valuation",
      desc: "Nossa inteligência artificial analisa fundamentos, macroeconomia e múltiplos históricos para identificar assimetrias de valor."
    },
    {
      icon: <BrainCircuit size={18} className="text-purple-400" />,
      title: "Machine Learning Tático",
      desc: "Redes neurais proprietárias que rastreiam o fluxo de capital institucional e detectam padrões invisíveis ao olho humano."
    },
    {
      icon: <PieChart size={18} className="text-blue-400" />,
      title: "Gestão Buy & Hold 2.0",
      desc: "Ferramentas exclusivas para rebalanceamento inteligente de carteira, focadas na maximização de dividendos e longo prazo."
    },
    {
      icon: <Layers size={18} className="text-emerald-400" />,
      title: "Simulação de Cenários",
      desc: "Estresse sua carteira contra 10.000 cenários econômicos possíveis (Monte Carlo) antes de tomar qualquer decisão."
    },
    {
      icon: <Activity size={18} className="text-rose-400" />,
      title: "Sentinela de Risco 24/7",
      desc: "Monitoramento contínuo de volatilidade e correlação de ativos. Seja alertado antes que o mercado vire."
    },
    {
      icon: <GraduationCap size={18} className="text-indigo-400" />,
      title: "Educação Financeira",
      desc: "Acesse masterclasses e trilhas de conhecimento desenvolvidas por analistas CNPI e gestores de fundos de elite."
    }
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [slides.length]);

  return (
    // MUDANÇA: h-screen e overflow-hidden garantem que não haja scroll na página
    <div className="h-screen w-full bg-[#03060D] relative flex items-center justify-center p-4 font-sans selection:bg-blue-600 selection:text-white overflow-hidden">
      
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
         <div className="absolute top-[-20%] left-[-10%] w-[80vw] h-[80vw] bg-blue-900/10 rounded-full blur-[150px]"></div>
         <div className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] bg-indigo-900/10 rounded-full blur-[150px]"></div>
         <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.04]"></div>
      </div>

      {/* 
        Container Responsivo:
        - lg:max-h-[600px] limita a altura no notebook
      */}
      <div className="relative z-10 w-full max-w-[450px] lg:max-w-[800px] xl:max-w-[950px] bg-white rounded-2xl shadow-2xl shadow-black/80 overflow-hidden flex flex-col lg:flex-row border border-slate-800 ring-1 ring-white/10 lg:max-h-[85vh] xl:max-h-none">
        
        {/* Coluna da Esquerda (Carrossel) */}
        <div className="w-full lg:w-[45%] xl:w-[50%] bg-[#080C14] relative p-6 lg:p-8 xl:p-12 flex flex-col justify-between text-white overflow-hidden border-b lg:border-b-0 lg:border-r border-slate-800 min-h-[220px] lg:min-h-auto">
            <div className="absolute inset-0 bg-gradient-to-b from-[#0F1729] to-[#080C14] z-0"></div>
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/5 rounded-full blur-[60px] z-0"></div>
            
            <div className="relative z-10 flex items-center gap-2.5">
                <div className="w-7 h-7 bg-blue-600 flex items-center justify-center rounded shadow-lg shadow-blue-600/20 shrink-0">
                    <ShieldCheck size={16} className="text-white" />
                </div>
                <span className="font-bold text-base tracking-[0.15em] uppercase text-white">Vertice Invest</span>
            </div>

            <div className="relative z-10 my-auto py-4 lg:py-0">
                <div className="h-[140px] lg:h-[160px] xl:h-[200px] relative">
                  {slides.map((slide, index) => (
                    <div 
                      key={index}
                      className={`absolute inset-0 transition-all duration-700 ease-out transform flex flex-col justify-center
                        ${index === activeSlide ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 pointer-events-none'}
                      `}
                    >
                      <div className="mb-2 lg:mb-3 inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-300 text-[9px] font-bold uppercase tracking-wider w-fit backdrop-blur-md">
                          {slide.icon}
                          <span>Diferencial Exclusivo</span>
                      </div>
                      
                      <h2 className="text-xl lg:text-xl xl:text-3xl font-bold leading-tight mb-2 text-white">
                        {slide.title}
                      </h2>
                      <p className="text-slate-400 leading-relaxed text-xs lg:text-xs xl:text-sm max-w-sm">
                        {slide.desc}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="flex gap-1.5 mt-2">
                  {slides.map((_, idx) => (
                    <div 
                      key={idx} 
                      className={`h-1 rounded-full transition-all duration-300 ${idx === activeSlide ? 'w-6 bg-blue-600' : 'w-1 bg-slate-700'}`}
                    />
                  ))}
                </div>
            </div>

            <div className="relative z-10 hidden lg:flex items-center gap-3 opacity-90">
                <div className="flex -space-x-3">
                   <img src="https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=100&h=100" alt="User" className="w-7 h-7 rounded-full border-2 border-[#080C14] object-cover grayscale opacity-70 hover:grayscale-0 hover:opacity-100 transition-all" />
                   <img src="https://images.unsplash.com/photo-1573496359-136d4755f357?auto=format&fit=crop&w=100&h=100" alt="User" className="w-7 h-7 rounded-full border-2 border-[#080C14] object-cover grayscale opacity-70 hover:grayscale-0 hover:opacity-100 transition-all" />
                   <img src="https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=100&h=100" alt="User" className="w-7 h-7 rounded-full border-2 border-[#080C14] object-cover grayscale opacity-70 hover:grayscale-0 hover:opacity-100 transition-all" />
                </div>
                <div>
                   <p className="text-[9px] text-slate-300 font-bold uppercase tracking-wide">Comunidade Premium</p>
                   <p className="text-[9px] text-slate-500 font-medium">Investidores qualificados</p>
                </div>
            </div>
        </div>

        {/* Coluna da Direita (Formulário) */}
        <div className="w-full lg:w-[55%] xl:w-[50%] bg-white p-6 lg:p-6 xl:p-12 flex flex-col justify-center relative">
            <div 
              key={location.pathname}
              className={`relative z-10 w-full ${isWideContent ? 'max-w-xl' : 'max-w-[340px]'} mx-auto animate-fade-in`}
            >
                <Outlet />
            </div>
            
            <div className="mt-4 lg:mt-6 pt-3 text-center border-t border-slate-50">
                <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest flex items-center justify-center gap-1.5">
                    <Lock size={9} />
                    Ambiente Seguro SSL • 256-bit
                </p>
            </div>
        </div>

      </div>
    </div>
  );
};
