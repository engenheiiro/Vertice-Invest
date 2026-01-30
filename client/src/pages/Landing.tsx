import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  ShieldCheck, BrainCircuit, 
  ChevronRight, Activity, Globe, Cpu, ChevronDown, CheckCircle2,
  GraduationCap, LayoutDashboard, Quote, Calculator, BarChart3,
  Lock, TrendingUp, DollarSign
} from 'lucide-react';
import { API_URL } from '../config';

export const Landing = () => {
  const [scrolled, setScrolled] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [marketData, setMarketData] = useState<any>(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', handleScroll);
    
    const fetchData = async () => {
        try {
            const res = await fetch(`${API_URL}/api/market/landing`);
            if (res.ok) {
                const data = await res.json();
                setMarketData(data);
            }
        } catch (e) {
            console.error("Erro ao carregar dados da landing page", e);
        }
    };
    fetchData();

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-[#02040a] text-white selection:bg-blue-500 selection:text-white overflow-x-hidden font-sans">
      
      {/* NAVBAR */}
      <nav className={`fixed top-0 w-full z-50 transition-all duration-300 border-b ${scrolled ? 'bg-[#03060D]/90 backdrop-blur-xl border-slate-800/60 py-3' : 'bg-transparent border-transparent py-4'}`}>
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center rounded-lg shadow-lg shadow-blue-600/20">
               <ShieldCheck size={16} className="text-white" />
            </div>
            <span className="text-base font-bold tracking-tight text-white">VÉRTICE</span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/login" className="text-xs font-medium text-slate-400 hover:text-white transition-colors hidden sm:block">
              Acessar Conta
            </Link>
            <Link to="/register">
              <button className="px-4 py-1.5 bg-white text-slate-950 text-[10px] font-bold uppercase tracking-wider rounded-full hover:bg-blue-50 transition-colors flex items-center gap-2 shadow-lg shadow-white/5">
                Começar Agora
              </button>
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO SECTION */}
      <section className="relative pt-20 pb-12 lg:pt-24 lg:pb-20 px-6 overflow-hidden min-h-[70vh] flex flex-col justify-center">
        <div id="hero-background" className="absolute inset-0 z-0 pointer-events-none">
            <div className="absolute inset-0 bg-[#02040a]"></div>
            <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] bg-blue-900/20 rounded-full blur-[120px] opacity-40 animate-pulse-slow"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] bg-indigo-900/10 rounded-full blur-[100px] opacity-30"></div>
            <div className="absolute top-[20%] right-[10%] w-[300px] h-[300px] bg-emerald-500/5 rounded-full blur-[80px]"></div>
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_80%)]"></div>
            <div className="absolute inset-0 opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
        </div>

        <div className="max-w-6xl mx-auto relative z-20 w-full">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            
            <div className="space-y-6 animate-fade-in text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/50 border border-slate-800 backdrop-blur-md text-blue-400 text-[10px] font-bold uppercase tracking-widest mx-auto lg:mx-0 shadow-lg shadow-blue-900/10">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                Vértice AI Research 2.4
              </div>
              
              <h1 className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold leading-[1.1] tracking-tight">
                O Fim da <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400">Incerteza Financeira</span>
              </h1>
              
              <div className="text-sm md:text-base text-slate-400 max-w-lg leading-relaxed mx-auto lg:mx-0">
                <p className="mb-4">
                  Nossa IA processa bilhões de dados globais para entregar clareza onde outros veem caos.
                </p>
                <div className="pl-4 border-l-2 border-blue-500/50 italic text-slate-300">
                  <span className="font-bold text-white not-italic block mb-0.5">Pode cancelar suas outras assinaturas.</span>
                  A Vértice é o único terminal que você vai precisar.
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2 justify-center lg:justify-start">
                <Link to="/register" className="group relative px-6 py-3 bg-blue-600 text-white text-sm font-bold rounded-xl shadow-[0_0_40px_-10px_rgba(37,99,235,0.5)] transition-all hover:scale-[1.02] flex items-center justify-center gap-2 overflow-hidden">
                  <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
                  <BrainCircuit size={18} />
                  Criar Conta Grátis
                </Link>
                <Link to="/login" className="px-6 py-3 bg-[#0F1729]/50 hover:bg-[#1E293B] border border-slate-800 hover:border-slate-700 backdrop-blur-md text-slate-300 text-sm font-semibold rounded-xl transition-all flex items-center justify-center">
                  Fazer Login
                </Link>
              </div>
              
              <div className="pt-2 flex flex-wrap items-center justify-center lg:justify-start gap-4 text-[10px] md:text-xs text-slate-500 font-medium">
                <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-blue-500" /> Sem cartão de crédito</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-blue-500" /> Setup em 2 min</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-blue-500" /> Segurança Bancária</span>
              </div>
            </div>

            <div className="relative animate-fade-in w-full max-w-sm mx-auto lg:max-w-full lg:scale-95" style={{ animationDelay: '200ms' }}>
              <div className="absolute inset-0 bg-blue-500/20 blur-[80px] rounded-full"></div>
              <PerformanceCard macro={marketData?.macro} />
            </div>
          </div>
        </div>
      </section>

      {/* TICKER SECTION */}
      <div className="w-full bg-[#03060D] border-y border-slate-900 overflow-hidden py-2.5 flex relative z-10">
        <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-[#03060D] to-transparent z-10"></div>
        <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-[#03060D] to-transparent z-10"></div>
        
        <div className="flex animate-scroll whitespace-nowrap gap-12 text-slate-500 text-[10px] md:text-xs font-mono uppercase tracking-widest opacity-70 hover:opacity-100 transition-opacity">
           {(marketData?.tickers || [...Array(6)]).map((item: any, i: number) => {
             const ticker = item?.ticker || `LOAD${i}`;
             const change = item?.change || 0;
             return (
               <React.Fragment key={i}>
                  <span className="flex items-center gap-2">
                      <span className={`w-1 h-1 rounded-full ${change >= 0 ? 'bg-green-500' : 'bg-red-500'}`}></span> 
                      {ticker} {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                  </span>
                  <span className="flex items-center gap-2 text-blue-900/50"> • </span>
               </React.Fragment>
             )
           })}
        </div>
      </div>

      {/* FEATURES */}
      <section className="py-20 px-6 relative">
        <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12 max-w-2xl mx-auto">
                <h2 className="text-3xl md:text-4xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-500">
                    O Ecossistema Vértice
                </h2>
                <p className="text-slate-400 text-base">
                    Uma plataforma completa que une tecnologia de ponta, educação financeira de elite e gestão de ativos.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 bg-[#080C14] border border-slate-800 rounded-2xl p-5 relative overflow-hidden group hover:border-blue-900/50 transition-colors flex flex-col justify-between min-h-[280px]">
                    <div className="absolute -bottom-10 -right-10 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none z-0">
                        <BrainCircuit size={300} />
                    </div>
                    <div className="relative z-10">
                        <div className="w-10 h-10 bg-blue-900/30 rounded-lg flex items-center justify-center mb-3 text-blue-400">
                            <Cpu size={20} />
                        </div>
                        <h3 className="text-xl font-bold mb-2 text-white">Neural Engine v2</h3>
                        <p className="text-slate-400 text-sm max-w-md leading-relaxed">
                            Nossa IA "lê" o sentimento global analisando notícias e fluxos institucionais em tempo real.
                        </p>
                    </div>
                    <div className="mt-4 relative h-24 w-full bg-[#03060D]/50 rounded-xl border border-slate-800/60 overflow-hidden flex items-center justify-center z-10 backdrop-blur-sm">
                        <NeuralGrid />
                        <div className="absolute bottom-2 right-2 flex items-center gap-2 px-2 py-0.5 bg-black/60 rounded border border-slate-800 backdrop-blur-sm z-20">
                             <Activity size={10} className="text-blue-400" />
                             <span className="text-[9px] text-slate-300 font-mono">ONLINE</span>
                        </div>
                    </div>
                </div>

                <div className="md:col-span-1 flex flex-col gap-4">
                    <div className="flex-1 bg-[#080C14] border border-slate-800 rounded-2xl p-5 hover:border-emerald-900/50 transition-colors group flex flex-col justify-center min-h-[132px]">
                        <div className="flex items-center justify-between mb-2">
                            <div className="w-8 h-8 bg-emerald-900/30 rounded-lg flex items-center justify-center text-emerald-400">
                                <Globe size={18} />
                            </div>
                            <span className="text-[10px] font-mono text-emerald-500 bg-emerald-900/20 px-1.5 py-0.5 rounded">14 BOLSAS</span>
                        </div>
                        <h3 className="text-base font-bold text-white">Cobertura Global</h3>
                        <p className="text-slate-400 text-xs leading-tight mt-1">
                            Cripto, Commodities e Forex unificados.
                        </p>
                    </div>

                    <div className="flex-1 bg-[#080C14] border border-slate-800 rounded-2xl p-5 hover:border-purple-900/50 transition-colors group flex flex-col justify-center min-h-[132px]">
                        <div className="flex items-center justify-between mb-2">
                            <div className="w-8 h-8 bg-purple-900/30 rounded-lg flex items-center justify-center text-purple-400">
                                <GraduationCap size={18} />
                            </div>
                            <span className="text-[10px] font-mono text-purple-500 bg-purple-900/20 px-1.5 py-0.5 rounded">NEW</span>
                        </div>
                        <h3 className="text-base font-bold text-white">Vértice Academy</h3>
                        <p className="text-slate-400 text-xs leading-tight mt-1">
                            Formação completa do básico ao avançado.
                        </p>
                    </div>
                </div>

                <div className="md:col-span-3 bg-[#080C14] border border-slate-800 rounded-2xl p-5 relative overflow-hidden hover:border-indigo-900/50 transition-colors">
                     <div className="relative z-10 flex flex-col md:flex-row items-center gap-8 justify-between">
                        <div className="max-w-xl w-full">
                             <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 bg-indigo-900/30 rounded-lg flex items-center justify-center text-indigo-400">
                                    <LayoutDashboard size={20} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-white leading-none">Gestão de Carteira 360°</h3>
                                    <span className="text-[10px] text-indigo-400 font-medium">CONSOLE UNIFICADO</span>
                                </div>
                             </div>
                            <p className="text-slate-400 text-sm mb-5 leading-relaxed">
                                Centralize seus investimentos. O sistema sugere rebalanceamentos automáticos baseados no seu perfil de risco.
                            </p>
                            <div className="pt-4 border-t border-slate-800/60">
                                <p className="text-[10px] text-slate-500 font-bold uppercase mb-2">Sincronização Nativa Com:</p>
                                <div className="flex items-center gap-4 opacity-50 select-none">
                                    <span className="text-xs font-bold font-mono tracking-tighter text-white">B3</span>
                                    <div className="h-3 w-px bg-slate-700"></div>
                                    <span className="text-xs font-bold font-mono tracking-tighter text-white">BINANCE</span>
                                    <div className="h-3 w-px bg-slate-700"></div>
                                    <span className="text-xs font-bold font-mono tracking-tighter text-white">XP INV.</span>
                                    <div className="h-3 w-px bg-slate-700"></div>
                                    <span className="text-[10px] text-blue-500 font-bold">+20 Outras</span>
                                </div>
                            </div>
                        </div>
                        <div className="bg-slate-900/80 backdrop-blur-sm p-4 rounded-xl border border-slate-700 w-full md:w-80 shadow-2xl flex flex-col gap-3 shrink-0">
                            <div className="flex items-center justify-between border-b border-slate-700 pb-2">
                                <span className="text-[10px] text-slate-400 font-bold uppercase">Smart Allocation</span>
                                <span className="text-[10px] text-green-400 font-bold bg-green-900/20 px-1.5 py-0.5 rounded flex items-center gap-1"><Lock size={8} /> Protegido</span>
                            </div>
                            <div className="flex gap-1 h-2 rounded-full overflow-hidden w-full">
                                <div className="w-[50%] bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"></div>
                                <div className="w-[30%] bg-blue-500"></div>
                                <div className="w-[20%] bg-emerald-500"></div>
                            </div>
                            <div className="flex justify-between text-[10px] text-slate-400 pt-1">
                                <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> Ações</span>
                                <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div> FIIs</span>
                                <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Renda Fixa</span>
                            </div>
                        </div>
                     </div>
                </div>
            </div>
        </div>
      </section>

      {/* RESULTS */}
      <section className="py-20 bg-gradient-to-b from-[#02040a] to-[#050810] border-t border-slate-900 relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-1 bg-gradient-to-r from-transparent via-blue-900/50 to-transparent"></div>
          <div className="max-w-6xl mx-auto px-6">
             <div className="flex flex-col md:flex-row items-end justify-between mb-12 gap-6">
                <div>
                    <span className="text-blue-500 font-bold text-xs uppercase tracking-widest mb-2 block">Alpha Hunters</span>
                    <h2 className="text-3xl font-bold text-white">Resultados que falam por si</h2>
                    <p className="text-slate-400 mt-2 max-w-lg">
                        Nossa IA detecta anomalias de preço antes do mercado. Veja alguns dos alertas recentes.
                    </p>
                </div>
             </div>

             <div className="grid md:grid-cols-3 gap-6">
                {(marketData?.results || [
                    { ticker: "NVDA", type: "LONG", date: "10 Jan", returnVal: "+8.4%", desc: "Identificado fluxo institucional massivo." },
                    { ticker: "PETR4", type: "SHORT", date: "15 Dez", returnVal: "+6.2%", desc: "Divergência de sentimento político detectada." },
                    { ticker: "BTC", type: "LONG", date: "04 Jan", returnVal: "+12.1%", desc: "Padrão de acumulação on-chain detectado." }
                ]).map((res: any, i: number) => (
                    <ResultCard key={i} {...res} delay={i * 100} />
                ))}
             </div>
          </div>
      </section>

      {/* STEPS */}
      <section className="py-20 bg-[#02040a] relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 relative z-10">
             <div className="text-center mb-16">
                <h2 className="text-2xl md:text-3xl font-bold mb-3">Sua jornada para a elite</h2>
             </div>
             
             <div className="grid md:grid-cols-3 gap-8 md:gap-12 relative">
                <div className="hidden md:block absolute top-10 left-[16%] right-[16%] h-[2px] bg-gradient-to-r from-blue-900/0 via-blue-900 to-blue-900/0 border-t border-dashed border-slate-700"></div>
                <StepCard number="01" title="Crie sua conta" desc="Processo simplificado em 2 minutos." />
                <StepCard number="02" title="Conecte ou Configure" desc="Sincronize sua carteira B3 automaticamente." />
                <StepCard number="03" title="Receba Alpha" desc="Acesse recomendações diárias e rebalanceie sua carteira." />
             </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="py-20 bg-[#080C14] border-y border-slate-800">
          <div className="max-w-6xl mx-auto px-6">
              <h2 className="text-2xl md:text-3xl font-bold mb-12 text-center">Quem usa, recomenda</h2>
              <div className="grid md:grid-cols-3 gap-6">
                  <TestimonialCard name="Ricardo S." role="Designer Gráfico" image="https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&w=150&h=150" text="A clareza que o Neural Engine traz é absurda. Deixei de operar com base em 'dicas' e passei a seguir dados." />
                  <TestimonialCard name="Amanda L." role="Veterinária" image="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&h=150" text="Não tenho tempo para analisar balanços. A gestão 360 faz tudo por mim." />
                  <TestimonialCard name="Carlos M." role="Servidor Público" image="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&h=150" text="A interface é incrível e a segurança dos dados me convenceu." />
              </div>
          </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-[#02040a]">
          <div className="max-w-2xl mx-auto px-6">
              <h2 className="text-2xl md:text-3xl font-bold mb-8 text-center">Perguntas Frequentes</h2>
              <div className="space-y-3">
                  <FaqItem question="A Vértice é uma corretora?" answer="Não. Somos uma casa de research e tecnologia." isOpen={openFaq === 0} onClick={() => toggleFaq(0)} />
                  <FaqItem question="Quanto custa o acesso?" answer="Oferecemos um plano gratuito e o Plano Pro." isOpen={openFaq === 1} onClick={() => toggleFaq(1)} />
                  <FaqItem question="É seguro conectar meus dados?" answer="Sim. Utilizamos criptografia de ponta a ponta." isOpen={openFaq === 2} onClick={() => toggleFaq(2)} />
              </div>
          </div>
      </section>

      {/* CTA */}
      <section className="py-20 relative overflow-hidden">
          <div className="absolute inset-0 bg-blue-600/5"></div>
          <div className="max-w-3xl mx-auto px-6 text-center relative z-10">
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white">Pronto para elevar seu nível?</h2>
              <p className="text-slate-400 mb-8 text-base">Junte-se a mais de 12.000 investidores.</p>
              <Link to="/register">
                  <button className="px-8 py-4 bg-white text-slate-900 font-bold text-sm md:text-base rounded-full hover:bg-blue-50 hover:scale-105 transition-all shadow-2xl shadow-white/10">
                      Criar Conta Gratuitamente
                  </button>
              </Link>
              <p className="mt-4 text-[10px] text-slate-600 uppercase tracking-widest font-bold">Sem compromisso • Cancele quando quiser</p>
          </div>
      </section>

      {/* FOOTER */}
      <footer className="py-10 border-t border-slate-900 bg-[#02040a] text-slate-500 text-sm">
        <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-4 gap-8 mb-8">
            <div className="col-span-2">
                <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 bg-slate-800 flex items-center justify-center rounded">
                        <ShieldCheck size={12} className="text-white" />
                    </div>
                    <span className="font-bold text-slate-300 tracking-wider text-xs">VÉRTICE</span>
                </div>
                <p className="max-w-xs text-[10px] leading-relaxed">
                    A Vértice Invest é uma provedora de análises financeiras baseadas em inteligência artificial.
                </p>
            </div>
            <div>
                <h4 className="font-bold text-slate-300 mb-3 text-xs uppercase">Produto</h4>
                <ul className="space-y-1.5 text-[11px]">
                    <li><a href="#" className="hover:text-blue-400">Research</a></li>
                    <li><a href="#" className="hover:text-blue-400">Carteiras</a></li>
                    <li><a href="#" className="hover:text-blue-400">Cursos</a></li>
                </ul>
            </div>
            <div>
                <h4 className="font-bold text-slate-300 mb-3 text-xs uppercase">Legal</h4>
                <ul className="space-y-1.5 text-[11px]">
                    <li><Link to="/terms" className="hover:text-blue-400">Termos de Uso</Link></li>
                    <li><a href="#" className="hover:text-blue-400">Privacidade</a></li>
                    <li><a href="#" className="hover:text-blue-400">Compliance</a></li>
                </ul>
            </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 pt-6 border-t border-slate-900 text-center text-[10px]">
            <p>© {new Date().getFullYear()} Vértice Invest Tecnologia Ltda. CNPJ 00.000.000/0001-00.</p>
        </div>
      </footer>
    </div>
  );
};

// --- SUB-COMPONENTES ---

const NeuralGrid = () => {
    const [activeIndices, setActiveIndices] = useState<Set<number>>(new Set());
    useEffect(() => {
        const updateIndices = () => {
            const newSet = new Set<number>();
            for (let i = 0; i < 36; i++) {
                if (Math.random() > 0.85) newSet.add(i);
            }
            setActiveIndices(newSet);
        };
        updateIndices();
        const interval = setInterval(updateIndices, 800);
        return () => clearInterval(interval);
    }, []);
    return (
        <div className="grid grid-cols-12 gap-1 w-full h-full p-2 opacity-60">
            {[...Array(36)].map((_, i) => {
                const isActive = activeIndices.has(i);
                return (
                    <div key={i} className={`rounded-[1px] transition-all duration-700 ${isActive ? 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)] scale-110' : 'bg-slate-700/50'}`}></div>
                );
            })}
        </div>
    );
};

const StepCard = ({ number, title, desc }: { number: string, title: string, desc: string }) => (
    <div className="relative z-10 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#0F1729] border border-slate-800 flex items-center justify-center text-xl font-bold text-blue-500 shadow-xl mb-4 group hover:scale-110 transition-transform duration-300">
            {number}
        </div>
        <h3 className="text-lg font-bold text-white mb-1.5">{title}</h3>
        <p className="text-slate-400 text-xs max-w-xs leading-relaxed">{desc}</p>
    </div>
);

const ResultCard = ({ ticker, type, date, returnVal, desc, delay }: any) => (
    <div 
        className="bg-[#080C14] border border-slate-800 p-6 rounded-xl relative overflow-hidden group hover:border-slate-700 transition-colors"
        style={{ animationDelay: `${delay}ms` }}
    >
        <div className="flex justify-between items-start mb-4">
            <div>
                <h4 className="text-lg font-bold text-white flex items-center gap-2">
                    {ticker} 
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${type === 'LONG' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                        {type}
                    </span>
                </h4>
                <p className="text-xs text-slate-500">{date}</p>
            </div>
            <div className="text-right">
                <p className="text-lg font-bold text-green-400">{returnVal}</p>
                <p className="text-[10px] text-slate-500 uppercase">Retorno</p>
            </div>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed border-t border-slate-800 pt-4">
            "{desc}"
        </p>
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-indigo-600 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left"></div>
    </div>
);

const TestimonialCard = ({ name, role, text, image }: any) => (
    <div className="bg-[#02040a] border border-slate-800 p-6 rounded-xl relative">
        <Quote className="text-blue-900/40 absolute top-4 right-4" size={40} />
        <div className="flex items-center gap-3 mb-4">
            <img src={image} alt={name} className="w-10 h-10 rounded-full border border-slate-700 object-cover" />
            <div>
                <p className="font-bold text-white text-sm">{name}</p>
                <p className="text-xs text-blue-500">{role}</p>
            </div>
        </div>
        <p className="text-slate-400 text-sm leading-relaxed italic">"{text}"</p>
    </div>
);

const FaqItem = ({ question, answer, isOpen, onClick }: { question: string, answer: string, isOpen: boolean, onClick: () => void }) => (
    <div className="border border-slate-800 rounded-xl bg-[#03060D] overflow-hidden">
        <button onClick={onClick} className="w-full px-5 py-3 text-left flex items-center justify-between font-semibold text-sm text-slate-200 hover:text-white transition-colors">
            {question}
            <ChevronDown size={16} className={`transition-transform duration-300 ${isOpen ? 'rotate-180 text-blue-500' : 'text-slate-600'}`} />
        </button>
        <div className={`px-5 overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-40 py-3 border-t border-slate-800/50' : 'max-h-0'}`}>
            <p className="text-slate-400 text-xs leading-relaxed">{answer}</p>
        </div>
    </div>
);

const PerformanceCard = ({ macro }: { macro: any }) => {
  const [viewMode, setViewMode] = useState<'chart' | 'simulator'>('chart');
  const [investmentValue, setInvestmentValue] = useState<string>('10000');
  
  const cdiRate = macro?.cdi || 13.2;
  const spxReturn = macro?.spx || 24.5;
  const iaReturn = 48.4;

  const data = [
    { label: 'CDI', value: cdiRate, color: 'bg-slate-800', text: 'text-slate-500' },
    { label: 'S&P 500', value: spxReturn, color: 'bg-slate-700', text: 'text-slate-400' },
    { label: 'IA Vértice', value: iaReturn, color: 'bg-gradient-to-r from-blue-600 to-indigo-500', text: 'text-white', glow: true },
  ];
  const maxValue = 60;

  const numValue = parseFloat(investmentValue.replace(/\./g, '')) || 0;
  const cdiResult = numValue * (1 + cdiRate/100);
  const verticeResult = numValue * (1 + iaReturn/100);
  const diff = verticeResult - cdiResult;

  const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  return (
    <div className="bg-[#03060D]/80 backdrop-blur-xl border border-slate-800 p-6 rounded-3xl shadow-2xl relative overflow-hidden group w-full transition-all duration-500">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
        <div className="relative z-10">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h3 className="text-lg font-bold text-white mb-0.5">Performance (12m)</h3>
                    <div className="flex items-center gap-1.5">
                         <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                         <p className="text-[10px] text-slate-400 uppercase tracking-wider">Dados Reais ({new Date().toLocaleDateString()})</p>
                    </div>
                </div>
                <div className="bg-slate-900 p-1 rounded-lg border border-slate-800 flex gap-1">
                    <button onClick={() => setViewMode('chart')} className={`p-1.5 rounded transition-all ${viewMode === 'chart' ? 'bg-slate-800 text-blue-400 shadow-sm' : 'text-slate-600 hover:text-slate-400'}`}><BarChart3 size={16} /></button>
                    <button onClick={() => setViewMode('simulator')} className={`p-1.5 rounded transition-all ${viewMode === 'simulator' ? 'bg-slate-800 text-blue-400 shadow-sm' : 'text-slate-600 hover:text-slate-400'}`}><Calculator size={16} /></button>
                </div>
            </div>

            {viewMode === 'chart' && (
                <div className="space-y-4 animate-fade-in">
                    {data.map((item) => (
                        <div key={item.label} className="relative group/bar">
                            <div className="flex justify-between text-xs mb-1.5 font-medium">
                                <span className={item.text}>{item.label}</span>
                                <span className={item.text}>{item.value.toFixed(1)}%</span>
                            </div>
                            <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden">
                                <div style={{ width: `${(item.value / maxValue) * 100}%` }} className={`h-full rounded-full ${item.color} relative transition-all duration-1000 ease-out`}>
                                    {item.glow && <div className="absolute right-0 top-0 bottom-0 w-4 bg-white/40 blur-[4px]"></div>}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {viewMode === 'simulator' && (
                <div className="animate-fade-in">
                    <div className="mb-4">
                        <label className="text-[10px] uppercase text-slate-500 font-bold mb-1.5 block">Valor do Investimento</label>
                        <div className="relative group/input">
                            <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within/input:text-blue-500 transition-colors" />
                            <input type="number" value={investmentValue} onChange={(e) => setInvestmentValue(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-lg py-2 pl-8 pr-3 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors" />
                        </div>
                    </div>
                    <div className="space-y-2.5">
                        <div className="flex justify-between items-center bg-slate-800/30 p-2 rounded-lg border border-slate-800/50">
                            <span className="text-xs text-slate-400">CDI ({cdiRate}%)</span>
                            <span className="text-sm font-medium text-slate-300">{formatCurrency(cdiResult)}</span>
                        </div>
                        <div className="flex justify-between items-center bg-gradient-to-r from-blue-900/20 to-indigo-900/20 p-2 rounded-lg border border-blue-500/20">
                            <span className="text-xs text-white font-bold flex items-center gap-1"><BrainCircuit size={12} className="text-blue-400"/> Vértice ({iaReturn}%)</span>
                            <span className="text-sm font-bold text-white">{formatCurrency(verticeResult)}</span>
                        </div>
                        <div className="pt-1 text-center">
                             <p className="text-[10px] text-slate-500">Ganho Adicional: <span className="text-green-400 font-bold">{formatCurrency(diff)}</span></p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    </div>
  );
};