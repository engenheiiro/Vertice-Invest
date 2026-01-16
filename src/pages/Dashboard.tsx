import React from 'react';
import { BrainCircuit, BookOpen, TrendingUp, LogOut, ShieldCheck, Bell, ArrowUpRight, ArrowDownRight, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useDashboardData, StockRowProps } from '../hooks/useDashboardData';

interface NavItemProps {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    disabled?: boolean;
}

interface CardProps {
    title: string;
    value: string;
    sub: string;
    icon: React.ReactNode;
}

export const Dashboard = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { marketMovers, stats } = useDashboardData();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const firstName = user?.name ? user.name.split(' ')[0] : 'Investidor';

  return (
    <div className="min-h-screen bg-slate-50/50">
      <nav className="bg-white/80 backdrop-blur-md border-b border-slate-200/60 px-6 py-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
             <div className="w-9 h-9 bg-blue-600 text-white flex items-center justify-center rounded-xl shadow-lg shadow-blue-600/20">
                <ShieldCheck size={18} />
             </div>
             <span className="text-lg font-bold text-slate-900 tracking-tight hidden sm:inline-block">VERTICE INVEST</span>
          </div>

          <div className="hidden md:flex items-center bg-slate-100/50 p-1 rounded-full border border-slate-200">
            <NavItem 
              icon={<BrainCircuit size={16} />} 
              label="IA Research" 
              active 
            />
            <NavItem 
              icon={<TrendingUp size={16} />} 
              label="Carteira" 
              disabled 
            />
            <NavItem 
              icon={<BookOpen size={16} />} 
              label="Cursos" 
              disabled 
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center bg-slate-100 rounded-full px-3 py-1.5 border border-slate-200 focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-400 transition-all">
                <Search size={14} className="text-slate-400" />
                <input type="text" placeholder="Buscar ativo..." className="bg-transparent border-none outline-none text-xs ml-2 w-24 lg:w-32 text-slate-600 placeholder:text-slate-400" />
            </div>
            
            <button className="text-slate-500 hover:text-blue-600 transition-colors relative p-2 hover:bg-slate-100 rounded-full">
               <Bell size={20} />
               <span className="absolute top-1.5 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
            
            <div className="w-px h-6 bg-slate-200 mx-1 hidden sm:block"></div>
            
            <div className="flex items-center gap-3">
                <div className="hidden lg:flex flex-col items-end mr-1">
                    <span className="text-xs font-bold text-slate-700">{firstName}</span>
                    <span className="text-[10px] text-slate-400 font-medium">Conta Pro</span>
                </div>
                <button 
                  onClick={handleLogout}
                  className="text-sm font-semibold text-slate-600 hover:text-red-600 flex items-center gap-2 transition-colors px-3 py-2 hover:bg-red-50 rounded-lg group"
                  title="Sair"
                >
                  <LogOut size={18} className="group-hover:-translate-x-0.5 transition-transform" />
                  <span className="hidden sm:inline">Sair</span>
                </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-10">
        <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Olá, {firstName}</h1>
                <p className="text-slate-500 mt-2">Aqui estão seus insights de <span className="text-blue-600 font-semibold">Deep Learning</span> para hoje.</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm w-fit">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Mercado Aberto • Atualizado há 2min
            </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
            <div className="col-span-1 md:col-span-8 space-y-8">
                <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-300 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                         <BrainCircuit size={120} className="text-blue-600" />
                    </div>
                    
                    <div className="flex items-center justify-between mb-6 relative z-10">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                                <BrainCircuit size={24} />
                            </div>
                            <h3 className="font-bold text-xl text-slate-800">Análise de Sentimento</h3>
                        </div>
                        <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full uppercase tracking-wide border border-green-200">Bullish Strong</span>
                    </div>
                    
                    <p className="text-slate-600 leading-relaxed mb-8 text-lg relative z-10">
                        A análise processada hoje indica um forte viés de alta para o setor de <strong className="text-slate-900">Semicondutores</strong> e <strong className="text-slate-900">IA Generativa</strong>. O índice de confiança institucional subiu 12%, impulsionado por novos contratos governamentais.
                    </p>
                    
                    <div className="h-64 bg-slate-50 rounded-xl border border-slate-100 flex flex-col items-center justify-center text-slate-400 gap-2 relative z-10">
                        <TrendingUp size={32} className="opacity-20" />
                        <span className="text-sm font-medium">[Gráfico Interativo de Tendência]</span>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                    <Card 
                        title="Ativos Monitorados" 
                        value={stats.monitored} 
                        sub="+12 novos" 
                        icon={<Search className="text-blue-600" size={20} />}
                    />
                    <Card 
                        title="Precisão Histórica" 
                        value={stats.precision} 
                        sub="Últimos 12 meses" 
                        icon={<ShieldCheck className="text-indigo-500" size={20} />}
                    />
                </div>
            </div>

            <div className="col-span-1 md:col-span-4 space-y-8">
                
                <div className="bg-gradient-to-br from-slate-900 to-indigo-950 text-white p-8 rounded-2xl shadow-xl relative overflow-hidden">
                    <div className="relative z-10">
                        <h3 className="font-bold text-2xl mb-2">Plano Pro</h3>
                        <p className="text-slate-300 text-sm mb-6 leading-relaxed">Acesse carteiras recomendadas ilimitadas e relatórios de deep-dive.</p>
                        <button className="w-full py-3 bg-white text-slate-900 font-bold rounded-xl text-sm hover:bg-blue-50 transition-colors shadow-lg shadow-black/10">
                            Desbloquear Full Access
                        </button>
                    </div>
                    <div className="absolute top-0 right-0 w-40 h-40 bg-blue-600 rounded-full blur-[60px] opacity-30 -translate-y-1/2 translate-x-1/2"></div>
                    <div className="absolute bottom-0 left-0 w-32 h-32 bg-purple-500 rounded-full blur-[50px] opacity-20 translate-y-1/3 -translate-x-1/3"></div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="font-bold text-slate-800">Top Movers (24h)</h3>
                        <button className="text-xs text-blue-600 font-semibold hover:underline">Ver tudo</button>
                    </div>
                    <div className="space-y-4">
                        {marketMovers.map((stock) => (
                            <React.Fragment key={stock.ticker}>
                                <StockRow {...stock} />
                                <div className="h-px bg-slate-100 last:hidden"></div>
                            </React.Fragment>
                        ))}
                    </div>
                </div>
            </div>
        </div>
      </main>
    </div>
  );
};

const NavItem: React.FC<NavItemProps> = ({ icon, label, active = false, disabled = false }) => (
  <button 
    disabled={disabled}
    className={`
      flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all relative
      ${active 
        ? 'bg-blue-50 text-blue-600 shadow-sm ring-1 ring-blue-100' 
        : 'text-slate-500 hover:text-slate-900'}
      ${disabled ? 'opacity-50 cursor-not-allowed hover:text-slate-500' : ''}
    `}
  >
    {icon}
    {label}
  </button>
);

const Card: React.FC<CardProps> = ({ title, value, sub, icon }) => (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-blue-200 transition-colors">
        <div className="flex items-start justify-between mb-4">
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                {icon}
            </div>
            <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-md">{sub}</span>
        </div>
        <p className="text-sm text-slate-500 font-semibold mb-1">{title}</p>
        <p className="text-3xl font-bold text-slate-900 tracking-tight">{value}</p>
    </div>
);

const StockRow: React.FC<StockRowProps> = ({ ticker, name, change, positive, price }) => (
    <div className="flex items-center justify-between group cursor-pointer hover:bg-slate-50 p-2 rounded-lg -mx-2 transition-colors">
        <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold ${positive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {ticker[0]}
            </div>
            <div>
                <p className="font-bold text-slate-900 text-sm group-hover:text-blue-600 transition-colors">{ticker}</p>
                <p className="text-xs text-slate-500 font-medium">{name}</p>
            </div>
        </div>
        <div className="text-right">
            <p className="text-sm font-bold text-slate-900">${price}</p>
            <div className={`flex items-center justify-end gap-1 text-xs font-bold ${positive ? 'text-green-600' : 'text-red-500'}`}>
                {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {change}
            </div>
        </div>
    </div>
);