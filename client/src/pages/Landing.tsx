
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageMeta } from '../components/seo/PageMeta';
import {
  ShieldCheck, Bot,
  ChevronRight, Activity, Cpu, CheckCircle2, Check,
  GraduationCap, LayoutDashboard, Quote, BarChart3,
  TrendingUp, RefreshCw, Target, CalendarClock, Zap, Gem, Crown
} from 'lucide-react';
import { API_URL } from '../config';

interface LandingTicker {
  ticker: string;
  name?: string;
  price?: number;
  change?: number;
  type?: string;
}

interface LandingMarketData {
  macro?: {
    selic?: number;
    ipca?: number;
    dollar?: number;
    ibov?: number;
    btc?: number;
  };
  tickers?: LandingTicker[];
  results?: Record<string, unknown>[];
}

const formatTickerChange = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const PLATFORM_STATS = [
  { value: '14', label: 'Bolsas cobertas' },
  { value: '12.000+', label: 'Investidores' },
  { value: '6', label: 'Classes de ativos' },
  { value: '24/7', label: 'Monitoramento IA' },
] as const;

const PLATFORM_STAT_BORDERS = [
  'border-r border-b lg:border-b-0',
  'border-b lg:border-r lg:border-b-0',
  'border-r',
  '',
] as const;

const ECOSYSTEM_FEATURES = [
  {
    title: 'Motor Quantitativo',
    description: 'Cruza qualidade, valuation e risco para transformar dados financeiros em scores claros e auditáveis.',
    detail: 'QUALITY · VALUATION · RISK',
    icon: Cpu,
    iconClass: 'text-blue-300',
    iconBgClass: 'border-blue-400/15 bg-blue-400/[0.08]',
    accentClass: 'from-blue-500/70 via-blue-400/20 to-transparent',
    heightClass: 'min-h-[280px]',
    surfaceClass: 'bg-[radial-gradient(circle_at_88%_12%,rgba(59,130,246,0.10),transparent_34%),#0a0f1a]',
  },
  {
    title: 'Rankings fundamentalistas',
    description: 'Ações, FIIs e Cripto ordenados por perfil, confiança dos dados e força dos fundamentos.',
    detail: 'DEFENSIVO · MODERADO · OUSADO',
    icon: BarChart3,
    iconClass: 'text-blue-300',
    iconBgClass: 'border-blue-400/15 bg-blue-400/[0.08]',
    accentClass: 'from-blue-500/70 via-blue-400/20 to-transparent',
    heightClass: 'min-h-[280px]',
    surfaceClass: 'bg-[radial-gradient(circle_at_88%_12%,rgba(99,102,241,0.09),transparent_34%),#0a0f1a]',
  },
  {
    title: 'Sinais técnicos',
    description: 'RSI, volume e regiões de suporte organizados em alertas objetivos para apoiar suas decisões.',
    detail: 'LEITURA TÉCNICA CONTÍNUA',
    icon: Activity,
    iconClass: 'text-cyan-300',
    iconBgClass: 'border-cyan-400/15 bg-cyan-400/[0.08]',
    accentClass: 'from-cyan-500/70 via-cyan-400/20 to-transparent',
    heightClass: 'min-h-[280px]',
    surfaceClass: 'bg-[radial-gradient(circle_at_88%_12%,rgba(34,211,238,0.08),transparent_34%),#0a0f1a]',
  },
  {
    title: 'Carteira 360°',
    description: 'Patrimônio, rentabilidade, proventos, evolução e distribuição reunidos em uma única visão.',
    detail: 'PAINEL PATRIMONIAL',
    icon: LayoutDashboard,
    iconClass: 'text-emerald-300',
    iconBgClass: 'border-emerald-400/15 bg-emerald-400/[0.08]',
    accentClass: 'from-emerald-500/70 via-emerald-400/20 to-transparent',
    heightClass: 'min-h-[280px]',
    surfaceClass: 'bg-[radial-gradient(circle_at_88%_12%,rgba(16,185,129,0.08),transparent_34%),#0a0f1a]',
  },
  {
    title: 'Aporte inteligente',
    description: 'Informe o novo valor e receba uma distribuição alinhada à carteira, ao perfil e aos seus objetivos.',
    detail: 'ALOCAÇÃO ORIENTADA POR DADOS',
    icon: TrendingUp,
    iconClass: 'text-emerald-300',
    iconBgClass: 'border-emerald-400/15 bg-emerald-400/[0.08]',
    accentClass: 'from-emerald-500/70 via-emerald-400/20 to-transparent',
    heightClass: 'min-h-[280px]',
    surfaceClass: 'bg-[radial-gradient(circle_at_88%_12%,rgba(52,211,153,0.08),transparent_34%),#0a0f1a]',
  },
  {
    title: 'Vértice Academy',
    description: 'Formação financeira estruturada, do essencial ao avançado, integrada à sua jornada de investidor.',
    detail: 'CONHECIMENTO APLICÁVEL',
    icon: GraduationCap,
    iconClass: 'text-violet-300',
    iconBgClass: 'border-violet-400/15 bg-violet-400/[0.08]',
    accentClass: 'from-violet-500/70 via-violet-400/20 to-transparent',
    heightClass: 'min-h-[280px]',
    surfaceClass: 'bg-[radial-gradient(circle_at_88%_12%,rgba(139,92,246,0.09),transparent_34%),#0a0f1a]',
  },
] as const;

const COMPARISON_ROWS = [
  { label: 'Rankings quantitativos de Ações, FIIs e Cripto', vertice: 'Incluído', investidor10: 'Indicadores', spreadsheet: 'Manual', traditional: 'Parcial' },
  { label: 'Sinais técnicos em tempo real', vertice: 'Pro+', investidor10: '—', spreadsheet: '—', traditional: 'Limitado' },
  { label: 'Carteira consolidada e rentabilidade', vertice: 'Incluído', investidor10: 'Incluído', spreadsheet: 'Manual', traditional: '—' },
  { label: 'Aporte inteligente e rebalanceamento', vertice: 'Pro / Elite', investidor10: 'Limitado', spreadsheet: 'Manual', traditional: '—' },
  { label: 'Educação financeira estruturada', vertice: 'Incluído', investidor10: 'Cursos incluídos', spreadsheet: '—', traditional: 'Extra pago' },
  { label: 'Custo mensal de entrada', vertice: 'R$ 39,90 mensal', investidor10: '12× R$ 19,90 anual', spreadsheet: 'Seu tempo', traditional: 'R$ 100+' },
] as const;

const LANDING_PLANS = [
  {
    name: 'Essential',
    price: '39,90',
    description: 'Comece a investir com inteligência.',
    inheritance: null,
    features: ['Terminal e cotações', 'Carteira e rentabilidade', 'Carteira Brasil 10', 'Academy e sinais com delay'],
    icon: ShieldCheck,
    borderClass: 'border-emerald-500/30',
    iconClass: 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300',
    checkClass: 'text-emerald-400',
    buttonClass: 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10',
  },
  {
    name: 'Vértice Pro',
    price: '89,90',
    originalPrice: '119,90',
    description: 'Carteiras completas e IA no seu aporte.',
    inheritance: 'Tudo do Essential +',
    features: ['Aporte Inteligente', 'Radar Alpha em tempo real', 'Carteiras de Ações, FIIs e Cripto', 'Diagnósticos com IA'],
    icon: Zap,
    recommended: true,
    borderClass: 'border-blue-500/55',
    iconClass: 'border-blue-400/30 bg-blue-600 text-white',
    checkClass: 'text-blue-400',
    buttonClass: 'border-blue-500 bg-blue-600 text-white hover:bg-blue-500',
  },
  {
    name: 'Vértice Elite',
    price: '120,00',
    description: 'Globais e automações para ir além.',
    inheritance: 'Tudo do Pro +',
    features: ['Rebalanceamento com IA', 'Carteira Global', 'Masterclasses e estudos de caso'],
    icon: Gem,
    borderClass: 'border-violet-500/35',
    iconClass: 'border-violet-400/25 bg-violet-400/[0.09] text-violet-300',
    checkClass: 'text-violet-400',
    buttonClass: 'border-violet-500/45 text-violet-300 hover:bg-violet-500/10',
  },
  {
    name: 'Vértice Black',
    price: '299,00',
    description: 'Estrutura private e atendimento dedicado.',
    inheritance: 'Tudo do Elite +',
    features: ['Carteiras estruturadas', 'Automação de IR', 'Concierge e calls com analistas'],
    icon: Crown,
    borderClass: 'border-yellow-500/35',
    iconClass: 'border-yellow-400/25 bg-yellow-400/[0.08] text-yellow-300',
    checkClass: 'text-yellow-400',
    buttonClass: 'border-yellow-500/45 text-yellow-300 hover:bg-yellow-500/10',
  },
] as const;

const LANDING_TESTIMONIALS = [
  { initials: 'RS', name: 'Ricardo S.', role: 'Designer Gráfico', image: '/assets/testimonials/ricardo.jpg', quote: 'A clareza que o motor quantitativo traz mudou minha forma de analisar investimentos. Passei a seguir dados, não dicas.' },
  { initials: 'AL', name: 'Amanda L.', role: 'Veterinária', image: '/assets/testimonials/amanda.jpg', quote: 'Não tenho tempo para analisar balanços. A visão consolidada me mostra rapidamente onde preciso prestar atenção.' },
  { initials: 'CM', name: 'Carlos M.', role: 'Servidor Público', image: '/assets/testimonials/carlos.jpg', quote: 'A interface é direta e o sistema de metas transformou objetivos distantes em uma jornada que consigo acompanhar.' },
] as const;

const FINAL_CTA_FEATURES = [
  { icon: Cpu, title: 'Research quantitativo', description: 'Dados antes da decisão' },
  { icon: LayoutDashboard, title: 'Carteira inteligente', description: 'Tudo em uma única visão' },
  { icon: Target, title: 'Metas conectadas', description: 'Progresso que você acompanha' },
] as const;

const EcosystemPreview = ({ index }: { index: number }) => {
  if (index === 0) {
    const metrics = [
      { label: 'Qualidade', value: '86', width: 'w-[86%]', color: 'bg-blue-400' },
      { label: 'Valuation', value: '74', width: 'w-[74%]', color: 'bg-indigo-400' },
      { label: 'Risco', value: '68', width: 'w-[68%]', color: 'bg-cyan-400' },
    ];

    return (
      <div className="grid min-h-[84px] items-center gap-2.5 sm:grid-cols-3" aria-hidden="true">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-xl border border-slate-800/80 bg-black/15 p-3.5">
            <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-slate-500">
              <span>{metric.label}</span><span className="font-mono text-slate-300">{metric.value}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className={`h-full rounded-full ${metric.width} ${metric.color}`}></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (index === 1) {
    return (
      <div className="flex min-h-[84px] flex-col justify-center space-y-1.5" aria-hidden="true">
        {[['01', 'Defensivo', '92'], ['02', 'Moderado', '88'], ['03', 'Ousado', '84']].map(([position, profile, score]) => (
          <div key={profile} className="flex items-center gap-3 rounded-lg border border-slate-800/70 bg-black/15 px-3 py-1">
            <span className="font-mono text-[9px] text-slate-600">{position}</span>
            <span className="flex-1 text-[10px] font-bold text-slate-400">{profile}</span>
            <span className="rounded-md bg-blue-400/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-blue-300">{score}</span>
          </div>
        ))}
      </div>
    );
  }

  if (index === 2) {
    const bars = ['h-4', 'h-7', 'h-5', 'h-9', 'h-7', 'h-11', 'h-8', 'h-12', 'h-10', 'h-14', 'h-11', 'h-16'];
    return (
      <div className="relative flex h-[84px] items-end gap-1.5 overflow-hidden rounded-xl border border-slate-800/70 bg-black/15 px-3 pb-2 pt-3" aria-hidden="true">
        <div className="absolute inset-x-3 top-1/2 border-t border-dashed border-cyan-400/15"></div>
        {bars.map((height, barIndex) => <span key={barIndex} className={`flex-1 rounded-t-sm ${height} ${barIndex > 8 ? 'bg-cyan-400/70' : 'bg-slate-700/70'}`}></span>)}
      </div>
    );
  }

  if (index === 3) {
    return (
      <div className="flex h-[84px] items-center gap-4 rounded-xl border border-slate-800/70 bg-black/15 px-4" aria-hidden="true">
        <div className="relative h-14 w-14 shrink-0 rounded-full bg-[conic-gradient(#3b82f6_0_46%,#10b981_46%_74%,#f59e0b_74%_90%,#8b5cf6_90%)]">
          <div className="absolute inset-[7px] flex items-center justify-center rounded-full bg-[#0a0f1a] text-[8px] font-extrabold text-slate-300">100%</div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2 text-[8px] font-bold uppercase tracking-wider text-slate-500">
          <span><i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-blue-500"></i>Ações</span>
          <span><i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"></i>FIIs</span>
          <span><i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500"></i>Renda fixa</span>
          <span><i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-violet-500"></i>Cripto</span>
        </div>
      </div>
    );
  }

  if (index === 4) {
    return (
      <div className="flex min-h-[84px] flex-col justify-center rounded-xl border border-slate-800/70 bg-black/15 p-3" aria-hidden="true">
        <div className="mb-2 flex items-center justify-between text-[9px] font-bold text-slate-500"><span>Novo aporte</span><span className="font-mono text-emerald-300">R$ 1.500</span></div>
        <div className="flex h-2 overflow-hidden rounded-full bg-slate-800">
          <span className="w-[46%] bg-emerald-400"></span><span className="w-[34%] bg-blue-400"></span><span className="w-[20%] bg-violet-400"></span>
        </div>
        <div className="mt-3 flex justify-between text-[8px] font-bold uppercase tracking-wider text-slate-600"><span>46% Ações</span><span>34% FIIs</span><span>20% Cripto</span></div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[84px] items-center justify-between rounded-xl border border-slate-800/70 bg-black/15 px-3 py-3" aria-hidden="true">
      <div className="absolute left-8 right-8 top-[26px] h-px bg-violet-400/15"></div>
      {[
        ['01', 'Fundamentos'],
        ['02', 'Análise'],
        ['03', 'Estratégias'],
      ].map(([step, title], stepIndex) => (
        <div key={step} className="relative z-10 flex w-[30%] flex-col items-center text-center">
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg border font-mono text-[8px] font-bold ${stepIndex === 0 ? 'border-violet-300 bg-violet-400 text-[#10091d]' : 'border-violet-400/20 bg-[#111020] text-violet-300'}`}>{step}</span>
          <p className="mt-2 text-[8px] font-bold text-slate-500">{title}</p>
        </div>
      ))}
    </div>
  );
};

const MARKET_REFRESH_INTERVAL_MS = 60_000;

export const Landing = () => {
  const [scrolled, setScrolled] = useState(false);
  const [marketData, setMarketData] = useState<LandingMarketData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', handleScroll);

    let isMounted = true;
    let isInitialLoad = true;
    let isRefreshing = false;
    const controllers = new Set<AbortController>();

    const fetchData = async () => {
      if (isRefreshing) return;

      isRefreshing = true;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      controllers.add(controller);

      try {
        const res = await fetch(`${API_URL}/api/market/landing`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          if (isMounted) setMarketData(data);
        }
      } catch {
        // falha silenciosa: landing continua funcional sem dados de mercado
      } finally {
        clearTimeout(timeoutId);
        controllers.delete(controller);
        isRefreshing = false;
        if (isInitialLoad && isMounted) setLoading(false);
        isInitialLoad = false;
      }
    };

    void fetchData();
    const refreshInterval = window.setInterval(() => void fetchData(), MARKET_REFRESH_INTERVAL_MS);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      isMounted = false;
      window.clearInterval(refreshInterval);
      controllers.forEach((controller) => controller.abort());
    };
  }, []);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Vértice Invest',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    description: 'Plataforma de análise quantitativa para Ações, FIIs e Cripto com rankings, sinais técnicos e carteira inteligente.',
    url: 'https://verticeinvest.com.br',
    inLanguage: 'pt-BR',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL' },
    publisher: { '@type': 'Organization', name: 'Vértice Invest', url: 'https://verticeinvest.com.br' },
  };

  return (
    <>
    <PageMeta
      canonical="/"
      description="Plataforma de análise quantitativa de Ações, FIIs e Criptomoedas. Rankings fundamentalistas, sinais técnicos, carteira inteligente e aporte automático para investidores brasileiros."
      jsonLd={jsonLd}
    />
    <div className="min-h-screen overflow-x-hidden bg-[#05070d] font-sans text-white selection:bg-blue-500 selection:text-white" style={{ colorScheme: 'dark' }}>
      
      {/* NAVBAR */}
      <nav aria-label="Navegação principal" className={`fixed top-0 w-full z-50 border-b backdrop-blur-xl transition-all duration-300 ${scrolled ? 'bg-[#05070d]/90 border-slate-400/10 py-3' : 'bg-[#05070d]/80 border-slate-400/10 py-4'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center rounded-lg shadow-lg shadow-blue-600/20">
               <ShieldCheck size={16} className="text-white" />
            </div>
            <span className="text-base font-bold tracking-tight text-white">VÉRTICE</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-6">
              <a href="#inicio" className="text-[12.5px] leading-none font-semibold text-slate-400 hover:text-white transition-colors">Início</a>
              <a href="#recursos" className="text-[12.5px] leading-none font-semibold text-slate-400 hover:text-white transition-colors">Recursos</a>
              <a href="#planos" className="text-[12.5px] leading-none font-semibold text-slate-400 hover:text-white transition-colors">Planos</a>
            </div>
            <Link to="/login" className="hidden sm:block text-[12.5px] leading-none font-semibold text-slate-200 hover:text-white transition-colors">
              Acessar Conta
            </Link>
            <Link to="/register" className="flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-950 shadow-lg shadow-white/5 transition-colors hover:bg-blue-50">
              Começar Agora
            </Link>
          </div>
        </div>
      </nav>

      <main>
      {/* HERO SECTION */}
      <section id="inicio" className="relative scroll-mt-16 pt-20 pb-12 md:pt-24 md:pb-16 xl:pb-20 px-4 sm:px-6 overflow-hidden min-h-[70vh] flex flex-col justify-center">
        <div id="hero-background" className="absolute inset-0 z-0 pointer-events-none">
            <div className="absolute inset-0 bg-[#05070d]"></div>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_38%,rgba(37,99,235,0.09),transparent_38%)]"></div>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_88%_78%,rgba(99,102,241,0.04),transparent_28%)]"></div>
        </div>

        <div className="max-w-7xl mx-auto px-0 xl:px-2 relative z-20 w-full">
          <div className="grid xl:grid-cols-[minmax(0,420px)_1fr] gap-10 md:gap-14 xl:gap-12 items-center">
            
            <div className="space-y-6 animate-fade-in text-center xl:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/50 border border-slate-800 backdrop-blur-md text-blue-400 text-[10px] font-bold uppercase tracking-widest mx-auto xl:mx-0 shadow-lg shadow-blue-900/10">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                Vértice AI Research 2.4
              </div>
              
              <h1 className="mx-auto max-w-[720px] text-[40px] sm:text-5xl md:text-6xl xl:mx-0 xl:text-7xl font-bold leading-[1.1] tracking-tight text-white">
                O Fim da <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400">Incerteza Financeira</span>
              </h1>
              <p className="sr-only">Análise quantitativa de Ações, FIIs e Criptomoedas — Rankings, sinais técnicos e carteira inteligente para investidores brasileiros.</p>

              <div className="text-sm md:text-[15px] text-slate-400 max-w-lg leading-relaxed mx-auto xl:mx-0">
                <p className="mb-0">
                  Nossa IA analisa Ações, FIIs e Cripto com dados fundamentalistas e técnicos para entregar clareza onde outros veem caos.
                </p>
                <div className="mt-[18px] rounded-r-[10px] border-l-2 border-blue-500/60 bg-blue-600/[0.06] px-4 py-3 text-[12.5px] leading-normal italic text-slate-400">
                  <span className="mb-0.5 block text-[13.5px] font-extrabold not-italic text-slate-100">Pode cancelar suas outras assinaturas.</span>
                  A Vértice é o único terminal que você vai precisar.
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2 justify-center xl:justify-start">
                <Link to="/register" className="group relative px-7 py-3 bg-blue-600 text-white text-sm font-bold rounded-xl shadow-[0_0_40px_-10px_rgba(37,99,235,0.5)] transition-all hover:scale-[1.02] hover:bg-blue-500 flex items-center justify-center overflow-hidden">
                  <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
                  Criar Conta Grátis
                </Link>
                <Link to="/login" className="flex items-center justify-center rounded-xl border border-slate-800 bg-[#101620]/80 px-6 py-3 text-sm font-semibold text-slate-300 backdrop-blur-md transition-all hover:border-slate-700 hover:bg-slate-800">
                  Fazer Login
                </Link>
              </div>
              
              <div className="pt-2 flex flex-wrap xl:flex-nowrap items-center justify-center xl:justify-start gap-x-3 gap-y-2 xl:gap-x-2.5 text-[10px] md:text-[11px] text-slate-500 font-medium">
                <span className="flex items-center gap-1.5 whitespace-nowrap"><CheckCircle2 size={12} className="text-blue-500" /> Sem cartão de crédito</span>
                <span className="flex items-center gap-1.5 whitespace-nowrap"><CheckCircle2 size={12} className="text-blue-500" /> Setup em 2 min</span>
                <span className="flex items-center gap-1.5 whitespace-nowrap"><CheckCircle2 size={12} className="text-blue-500" /> Cancele quando quiser</span>
              </div>
            </div>

            <div className="relative animate-fade-in w-full sm:w-[calc(100%-4rem)] max-w-[900px] xl:max-w-none xl:w-full mx-auto xl:[perspective:1600px] xl:-mr-16 2xl:-mr-24" style={{ animationDelay: '200ms' }}>
              {/* Moldura 3D com o print real do dashboard */}
              <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-[#05070d] [transform-origin:left_center] xl:[transform:rotateY(-8deg)_rotateX(2deg)] shadow-[0_24px_60px_rgba(0,0,0,0.38)]">
                <img
                  src="/assets/landing/hero-dashboard.png"
                  alt="Dashboard Vértice: carteira consolidada, evolução do patrimônio e distribuição de ativos"
                  width={1353}
                  height={876}
                  loading="eager"
                  decoding="async"
                  className="block w-full h-auto [image-rendering:-webkit-optimize-contrast]"
                />
              </div>

              {/* Ações em destaque — mesmas cores e hierarquia visual do produto */}
              <div
                aria-hidden="true"
                className="absolute -left-2 sm:-left-5 top-4 sm:top-8 flex items-center gap-2.5 rounded-xl border border-blue-500/35 bg-[#0a0f1a]/95 px-2.5 sm:px-3 py-2 sm:py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-md animate-fade-in"
                style={{ animationDelay: '450ms' }}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15 ring-1 ring-inset ring-blue-400/15">
                  <TrendingUp size={16} className="text-blue-400" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] sm:text-[11px] font-extrabold text-slate-100 leading-none">Aporte Inteligente</p>
                    <span className="rounded bg-blue-500/15 px-1 py-0.5 text-[7px] font-extrabold tracking-wider text-blue-300">IA</span>
                  </div>
                  <p className="mt-1 hidden text-[9.5px] text-slate-500 sm:block">Distribuição ideal do novo valor</p>
                </div>
              </div>

              <div
                aria-hidden="true"
                className="absolute -right-4 sm:-right-8 top-[38%] hidden sm:flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-[#0a0f1a]/95 px-3 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-md animate-fade-in"
                style={{ animationDelay: '550ms' }}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-inset ring-emerald-400/15">
                  <Bot size={17} className="text-emerald-400" />
                </div>
                <div>
                  <p className="text-[11px] font-extrabold text-slate-100 leading-none">Research com IA</p>
                  <p className="mt-1 text-[9.5px] text-slate-500">Análises geradas por IA</p>
                </div>
              </div>

              <div
                aria-hidden="true"
                className="absolute -left-2 sm:-left-8 bottom-4 sm:bottom-10 flex items-center gap-2.5 rounded-xl border border-yellow-400/35 bg-[#0a0f1a]/95 px-2.5 sm:px-3 py-2 sm:py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-md animate-fade-in"
                style={{ animationDelay: '650ms' }}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-400/15 ring-1 ring-inset ring-yellow-300/15">
                  <RefreshCw size={16} className="text-yellow-400" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] sm:text-[11px] font-extrabold text-slate-100 leading-none">Rebalanceamento IA</p>
                    <span className="rounded bg-yellow-400/15 px-1 py-0.5 text-[7px] font-extrabold tracking-wider text-yellow-300">ELITE</span>
                  </div>
                  <p className="mt-1 hidden text-[9.5px] text-slate-500 sm:block">Plano automático para voltar ao alvo</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TICKER SECTION */}
      <section aria-label="Cotações do mercado" className="relative z-10 flex min-h-[44px] w-full border-y border-slate-800/70 bg-[#070a12]">
        <div className="relative z-20 flex shrink-0 items-center gap-2 border-r border-slate-800/70 bg-[#070a12] px-3 sm:px-5">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40 motion-reduce:animate-none"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"></span>
          </span>
          <span className="hidden text-[9px] font-extrabold uppercase tracking-[0.16em] text-slate-300 sm:inline">Mercado ao vivo</span>
        </div>

        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-[#070a12] to-transparent sm:w-16"></div>
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-[#070a12] to-transparent sm:w-16"></div>

          {loading ? (
            <div className="flex h-full items-center gap-8 px-6">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="flex shrink-0 items-center gap-2.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-700"></span>
                  <span className="h-2.5 w-20 animate-pulse rounded-full bg-slate-800"></span>
                </div>
              ))}
            </div>
          ) : (marketData?.tickers || []).length > 0 ? (
            <div className="flex h-full w-max min-w-full animate-scroll whitespace-nowrap [animation-duration:55s] hover:[animation-play-state:paused] motion-reduce:animate-none">
              {[0, 1].map((copyIndex) => (
                <div key={copyIndex} aria-hidden={copyIndex === 1 ? true : undefined} className="flex shrink-0 items-center gap-7 pr-7 sm:gap-9 sm:pr-9">
                  {(marketData?.tickers || []).map((item: LandingTicker, i: number) => {
                    const change = formatTickerChange(item.change);
                    const isPositive = change >= 0;
                    return (
                      <React.Fragment key={`${copyIndex}-${item.ticker}-${i}`}>
                        <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.08em] sm:text-[11px]">
                          <span className={`h-1.5 w-1.5 rounded-full ${isPositive ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                          <span className="font-bold text-slate-300">{item.ticker}</span>
                          <span className={`tabular-nums ${isPositive ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                            {isPositive ? '+' : ''}{change.toFixed(2)}%
                          </span>
                        </span>
                        <span className="h-3 w-px bg-slate-800" aria-hidden="true"></span>
                      </React.Fragment>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
              Dados de mercado temporariamente indisponíveis
            </div>
          )}
        </div>
      </section>

      {/* PLATFORM STATS */}
      <section aria-label="Indicadores da plataforma" className="relative z-10 border-b border-slate-800/70 bg-[#070a12]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent"></div>
        <dl className="mx-auto grid max-w-7xl grid-cols-2 px-4 sm:px-6 lg:grid-cols-4 lg:px-8">
          {PLATFORM_STATS.map((stat, index) => (
            <div
              key={stat.label}
              className={`group relative flex min-h-[104px] flex-col items-center justify-center border-slate-800/70 px-3 text-center transition-colors duration-300 hover:bg-blue-500/[0.025] sm:min-h-[112px] ${PLATFORM_STAT_BORDERS[index]}`}
            >
              <dd className="bg-gradient-to-b from-white to-slate-300 bg-clip-text font-mono text-[27px] font-extrabold leading-none tracking-tight text-transparent tabular-nums sm:text-[30px]">
                {stat.value}
              </dd>
              <dt className="mt-2 text-[9px] font-bold uppercase tracking-[0.14em] text-blue-300/65 sm:text-[10px]">
                {stat.label}
              </dt>
              <span className="absolute bottom-0 left-1/2 h-px w-0 -translate-x-1/2 bg-blue-400/60 transition-all duration-300 group-hover:w-10" aria-hidden="true"></span>
            </div>
          ))}
        </dl>
      </section>

      {/* GOALS */}
      <section id="metas" className="relative scroll-mt-16 overflow-hidden border-b border-slate-800/70 bg-[#05070d] px-4 py-20 sm:px-6 lg:py-24">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_76%_48%,rgba(16,185,129,0.045),transparent_34%)]" aria-hidden="true"></div>

        <div className="relative mx-auto grid max-w-7xl items-center gap-12 xl:grid-cols-[minmax(0,390px)_minmax(0,1fr)] xl:gap-14">
          <div className="max-w-xl xl:max-w-none">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-300">
              <Target size={13} /> Sistema de Metas
            </div>

            <h2 className="text-3xl font-bold leading-[1.12] tracking-tight text-white sm:text-4xl lg:text-[42px]">
              Do primeiro R$ 100 mil à sua
              <span className="mt-1 block bg-gradient-to-r from-emerald-300 via-cyan-300 to-blue-400 bg-clip-text text-transparent">
                independência financeira
              </span>
            </h2>
            <p className="mt-5 text-sm leading-7 text-slate-400 sm:text-[15px]">
              Transforme objetivos distantes em uma jornada visível. A Vértice conecta suas metas à carteira, atualiza o progresso e projeta quando cada marco será alcançado.
            </p>

            <div className="mt-7 space-y-5">
              <div className="flex gap-3.5">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/15 bg-emerald-400/[0.08] text-emerald-300">
                  <CalendarClock size={17} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Projeção inteligente</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Veja a previsão de conquista e quanto falta para chegar ao próximo marco.</p>
                </div>
              </div>

              <div className="flex gap-3.5">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/15 bg-cyan-400/[0.08] text-cyan-300">
                  <RefreshCw size={17} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Progresso conectado à carteira</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Cada novo aporte atualiza automaticamente o valor e o ritmo das suas metas.</p>
                </div>
              </div>

              <div className="flex gap-3.5">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-400/15 bg-blue-400/[0.08] text-blue-300">
                  <TrendingUp size={17} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Ritmo que orienta decisões</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Saiba se está adiantado ou atrasado e ajuste sua estratégia com clareza.</p>
                </div>
              </div>
            </div>

            <Link to="/register" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-xs font-extrabold text-[#04110d] transition-colors hover:bg-emerald-400">
              Criar minha primeira meta <ChevronRight size={15} />
            </Link>
          </div>

          <figure className="relative min-w-0">
            <div className="pointer-events-none absolute -inset-8 rounded-[40px] bg-emerald-500/[0.025] blur-3xl" aria-hidden="true"></div>
            <div className="relative aspect-[1.55/1] overflow-hidden rounded-2xl border border-slate-700/70 bg-[#05090e] shadow-2xl shadow-black/40 sm:aspect-auto">
              <img
                src="/assets/landing/goals-dashboard.png"
                alt="Painel do Sistema de Metas da Vértice com objetivos patrimoniais, progresso e datas projetadas"
                className="h-full w-full object-cover object-left-top sm:h-auto sm:object-contain"
                loading="lazy"
                decoding="async"
              />
            </div>

            <figcaption className="sr-only">Visualização do Sistema de Metas disponível na plataforma Vértice.</figcaption>
          </figure>
        </div>
      </section>

      {/* FEATURES */}
      <section id="recursos" className="relative scroll-mt-16 overflow-hidden border-b border-slate-800/70 bg-[#05070d] px-4 py-20 sm:px-6 lg:py-24">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(37,99,235,0.07),transparent_32%)]" aria-hidden="true"></div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/25 to-transparent" aria-hidden="true"></div>

        <div className="relative mx-auto max-w-7xl">
          <div className="mx-auto mb-12 max-w-3xl text-center sm:mb-14">
            <div className="mb-4 text-[10px] font-extrabold uppercase tracking-[0.2em] text-blue-400 sm:text-[11px]">
              O Ecossistema Vértice
            </div>
            <h2 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-[42px]">
              Tudo que você assinava separado,
              <span className="block bg-gradient-to-r from-blue-300 via-indigo-300 to-violet-300 bg-clip-text text-transparent">
                em um só lugar.
              </span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-slate-400 sm:text-[15px]">
              Pesquisa, acompanhamento e educação trabalham juntos para transformar informação em decisões mais claras.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-900/55 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
              6 módulos conectados à sua jornada
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ECOSYSTEM_FEATURES.map((feature, index) => {
              const Icon = feature.icon;

              return (
                <article
                  key={feature.title}
                  className={`group relative overflow-hidden rounded-2xl border border-slate-800/90 p-5 shadow-[0_16px_45px_rgba(0,0,0,0.16)] transition-all duration-300 hover:-translate-y-1 hover:border-slate-700 hover:shadow-[0_20px_55px_rgba(0,0,0,0.28)] sm:p-6 ${feature.heightClass} ${feature.surfaceClass}`}
                >
                  <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${feature.accentClass} opacity-75 transition-opacity group-hover:opacity-100`} aria-hidden="true"></div>
                  <div className="pointer-events-none absolute inset-[1px] rounded-[15px] ring-1 ring-inset ring-white/[0.018]" aria-hidden="true"></div>

                  <div className="relative flex h-full flex-col">
                    <div className="flex items-start justify-between gap-4">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl border shadow-inner shadow-white/[0.025] ${feature.iconBgClass}`}>
                        <Icon size={19} className={feature.iconClass} />
                      </div>
                      <span className="rounded-full border border-slate-800/80 bg-black/10 px-2 py-1 font-mono text-[8px] font-bold tracking-[0.14em] text-slate-600">MÓDULO 0{index + 1}</span>
                    </div>

                    <h3 className="mt-4 text-base font-bold text-slate-100 sm:text-[17px]">{feature.title}</h3>
                    <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400 sm:text-[13px]">{feature.description}</p>
                    <p className="mt-2.5 text-[8px] font-extrabold uppercase tracking-[0.16em] text-slate-600 transition-colors group-hover:text-slate-500">
                      {feature.detail}
                    </p>

                    <div className="mt-auto pt-4">
                      <EcosystemPreview index={index} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* COMPARISON */}
      <section className="relative border-b border-slate-800/70 bg-[#05070d] px-4 py-20 sm:px-6 lg:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-blue-400 sm:text-[11px]">Comparativo</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Por que trocar pelo Vértice</h2>
            <p className="mt-4 text-sm leading-6 text-slate-400">Menos ferramentas desconectadas. Mais contexto para decidir e acompanhar sua evolução.</p>
          </div>

          <p className="mb-3 text-center text-[9px] font-bold uppercase tracking-wider text-slate-600 sm:hidden">Deslize para comparar →</p>
          <div className="overflow-hidden rounded-2xl border border-slate-800/90 bg-[#080c15] shadow-2xl shadow-black/20">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-800 bg-[#0d1424] text-[11px] font-bold text-slate-400 sm:text-xs">
                  <th className="w-[32%] px-5 py-5 sm:px-6">
                    <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-slate-600">Recursos e experiência</span>
                  </th>
                  <th className="w-[17%] border-x border-blue-500/15 bg-blue-500/[0.09] px-4 py-4 text-center">
                    <span className="block text-sm font-extrabold text-blue-300">Vértice</span>
                    <span className="mt-1 block text-[8px] font-extrabold uppercase tracking-[0.14em] text-blue-400/70">Tudo integrado</span>
                  </th>
                  <th className="w-[17%] border-r border-slate-800 bg-slate-900/40 px-4 py-4 text-center">
                    <span className="block text-sm font-extrabold text-slate-300">Investidor10</span>
                    <span className="mt-1 block text-[8px] font-extrabold uppercase tracking-[0.14em] text-slate-600">Plano PRO</span>
                  </th>
                  <th className="w-[17%] px-4 py-4 text-center">Planilhas</th>
                  <th className="w-[17%] px-4 py-4 text-center">Research tradicional</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, index) => (
                  <tr key={row.label} className="group border-b border-slate-800/70 transition-colors last:border-b-0 hover:bg-white/[0.018]">
                    <th className="px-5 py-4 text-[11px] font-semibold text-slate-300 sm:px-6 sm:text-xs">
                      <span className="flex items-center gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-800 bg-slate-900/80 font-mono text-[8px] text-slate-600 transition-colors group-hover:border-blue-500/25 group-hover:text-blue-400">0{index + 1}</span>
                        {row.label}
                      </span>
                    </th>
                    <td className="border-x border-blue-500/10 bg-blue-500/[0.04] px-4 py-4 text-center text-[11px] font-bold text-emerald-400 sm:text-xs">
                      <span className="inline-flex items-center justify-center gap-1.5"><Check size={12} strokeWidth={2.5} /> {row.vertice}</span>
                    </td>
                    <td className="border-r border-slate-800/70 bg-slate-900/[0.18] px-4 py-4 text-center text-[11px] font-semibold text-slate-600 sm:text-xs">{row.investidor10}</td>
                    <td className="px-4 py-4 text-center text-[11px] text-slate-600 sm:text-xs">{row.spreadsheet}</td>
                    <td className="px-4 py-4 text-center text-[11px] text-slate-600 sm:text-xs">{row.traditional}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="border-t border-slate-800/70 bg-[#070b13] px-5 py-3 text-[9px] leading-4 text-slate-600 sm:px-6">
              <span>Comparação baseada em recursos publicamente anunciados. Planos e condições podem mudar.</span>
            </div>
          </div>
        </div>
      </section>

      {/* PLANS */}
      <section id="planos" className="relative scroll-mt-16 overflow-hidden border-b border-slate-800/70 bg-[#05070d] px-4 py-20 sm:px-6 lg:py-24">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(37,99,235,0.07),transparent_30%)]" aria-hidden="true"></div>
        <div className="relative mx-auto max-w-7xl">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-blue-400 sm:text-[11px]">Planos</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Um plano para cada nível de investidor</h2>
            <p className="mt-4 text-sm leading-6 text-slate-400">Evolua sem trocar de plataforma. Cada nível adiciona novas camadas de análise e automação.</p>
          </div>

          <div className="grid snap-x snap-mandatory grid-flow-col auto-cols-[86%] gap-4 overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:grid-cols-4">
            {LANDING_PLANS.map((plan) => {
              const Icon = plan.icon;
              const recommended = 'recommended' in plan && plan.recommended;
              const originalPrice = 'originalPrice' in plan ? plan.originalPrice : undefined;

              return (
                <article key={plan.name} className={`relative flex min-h-[480px] snap-center flex-col overflow-hidden rounded-2xl border bg-[#0a0e16] p-5 transition-transform duration-300 hover:-translate-y-1 sm:p-6 ${plan.borderClass}`}>
                  {recommended && <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 to-violet-500"></div>}
                  <div className="flex items-start justify-between gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${plan.iconClass}`}><Icon size={18} /></div>
                    {recommended && <span className="rounded-md border border-blue-400/25 bg-blue-400/10 px-2 py-1 text-[8px] font-extrabold uppercase tracking-wider text-blue-300">Recomendado</span>}
                  </div>

                  <h3 className="mt-5 text-lg font-extrabold text-slate-100">{plan.name}</h3>
                  <p className="mt-1.5 min-h-10 text-xs leading-5 text-slate-500">{plan.description}</p>
                  <div className="mt-4 flex items-end gap-1">
                    <span className="mb-1 text-xs font-semibold text-slate-500">R$</span>
                    <span className="text-3xl font-extrabold tracking-tight text-white">{plan.price}</span>
                    <span className="mb-1 text-[10px] text-slate-600">/mês</span>
                  </div>
                  {originalPrice ? <p className="mt-1 text-[9px] text-slate-600">De <span className="line-through">R$ {originalPrice}</span> por tempo limitado</p> : <div className="h-[13px]"></div>}

                  <div className="my-5 h-px bg-slate-800/80"></div>
                  {plan.inheritance && <p className={`mb-3 self-start rounded-full border px-2.5 py-1 text-[8px] font-bold ${plan.iconClass}`}>✦ {plan.inheritance}</p>}
                  <ul className="space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-[11px] font-semibold leading-4 text-slate-300">
                        <Check size={13} className={`mt-0.5 shrink-0 ${plan.checkClass}`} /> {feature}
                      </li>
                    ))}
                  </ul>

                  <Link to="/pricing" className={`mt-auto inline-flex items-center justify-center gap-1.5 rounded-xl border px-4 py-3 text-[10px] font-extrabold uppercase tracking-wider transition-colors ${plan.buttonClass}`}>
                    Conhecer plano <ChevronRight size={13} />
                  </Link>
                </article>
              );
            })}
          </div>

          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <p className="text-[9px] leading-5 text-slate-600">Assinatura mensal com renovação automática. Pagamento seguro processado pelo Mercado Pago.</p>
            <div className="flex items-center gap-2 opacity-55">
              <img src="/assets/payment/visa.svg" alt="Visa" className="h-5" />
              <img src="/assets/payment/mastercard.svg" alt="Mastercard" className="h-5" />
              <img src="/assets/payment/pix.svg" alt="Pix" className="h-5" />
            </div>
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="border-b border-slate-800/70 bg-[#080c15] px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-blue-400">Experiências</p>
            <h2 className="mt-3 text-3xl font-bold text-white">Quem usa, recomenda</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {LANDING_TESTIMONIALS.map((testimonial) => (
              <article key={testimonial.initials} className="relative rounded-2xl border border-slate-800/80 bg-[#0a0f1a] p-6">
                <Quote size={30} className="absolute right-5 top-5 text-blue-500/15" />
                <p className="relative pr-6 text-[13px] leading-6 text-slate-300">“{testimonial.quote}”</p>
                <div className="mt-6 flex items-center gap-3 border-t border-slate-800/70 pt-4">
                  <img src={testimonial.image} alt={testimonial.name} className="h-9 w-9 rounded-full border border-slate-700 object-cover" />
                  <div><p className="text-xs font-bold text-slate-200">{testimonial.name}</p><p className="mt-0.5 text-[9px] text-blue-400">{testimonial.role}</p></div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section id="cta-final" className="relative scroll-mt-16 overflow-hidden bg-[#05070d] px-4 py-16 sm:px-6 lg:py-20">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_50%,rgba(37,99,235,0.055),transparent_28%),radial-gradient(circle_at_82%_50%,rgba(124,58,237,0.04),transparent_26%)]" aria-hidden="true"></div>
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl border border-blue-400/15 bg-[linear-gradient(125deg,rgba(12,19,32,0.98),rgba(8,12,21,0.98)_55%,rgba(13,11,27,0.98))] shadow-[0_22px_65px_rgba(0,0,0,0.32)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(59,130,246,0.10),transparent_30%),radial-gradient(circle_at_88%_100%,rgba(139,92,246,0.07),transparent_28%)]" aria-hidden="true"></div>
          <div className="relative grid items-center gap-8 px-6 py-8 sm:px-8 sm:py-9 lg:grid-cols-[1.35fr_0.65fr] lg:gap-10 lg:px-10 lg:py-10">
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/[0.08] px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.18em] text-blue-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-40 motion-reduce:animate-none"></span>
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-400"></span>
                </span>
                Sua próxima decisão começa aqui
              </div>

              <h2 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-[42px]">
                Pronto para investir com
                <span className="block bg-gradient-to-r from-blue-300 via-cyan-300 to-violet-300 bg-clip-text text-transparent">mais clareza?</span>
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm font-semibold leading-6 !text-[#8B95A3] sm:text-base lg:mx-0">
                Junte-se a mais de 12.000 investidores que trocaram achismo por dados.
              </p>

              <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row lg:justify-start">
                <Link to="/register" className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-7 py-3 text-sm font-extrabold text-white shadow-[0_9px_28px_rgba(37,99,235,0.20)] transition-all hover:-translate-y-0.5 hover:bg-blue-500 sm:w-auto">
                  Criar conta gratuitamente <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link to="/login" className="inline-flex w-full items-center justify-center rounded-xl border border-slate-700/80 bg-white/[0.03] px-6 py-3 text-sm font-bold text-slate-300 transition-colors hover:border-slate-600 hover:bg-white/[0.05] hover:text-white sm:w-auto">
                  Já tenho uma conta
                </Link>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[10px] font-semibold text-slate-500 lg:justify-start">
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-400" /> Sem cartão de crédito</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-400" /> Setup em 2 minutos</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-400" /> Cancele quando quiser</span>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-sm lg:max-w-none">
              <div className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-blue-500/[0.07] to-violet-500/[0.05] blur-lg" aria-hidden="true"></div>
              <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-black/20 p-4 backdrop-blur-sm sm:p-5">
                <div className="flex items-end justify-between gap-4 border-b border-white/[0.07] pb-4">
                  <div>
                    <p className="font-mono text-4xl font-extrabold tracking-tight text-white sm:text-[40px]">12.000<span className="text-blue-400">+</span></p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Investidores na comunidade</p>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-400/15 bg-blue-400/[0.07] text-blue-300">
                    <TrendingUp size={18} />
                  </div>
                </div>
                <div className="mt-4 space-y-2.5">
                  {FINAL_CTA_FEATURES.map(({ icon: FeatureIcon, title, description }) => {
                    return (
                      <div key={title} className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800/80 text-blue-300"><FeatureIcon size={15} /></span>
                        <div>
                          <p className="text-[11px] font-extrabold text-slate-200">{title}</p>
                          <p className="mt-0.5 text-[9px] text-slate-500">{description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-slate-800/70 bg-[#05070d] text-slate-500">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-10 sm:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-800"><ShieldCheck size={13} className="text-white" /></div>
              <span className="text-xs font-extrabold tracking-[0.12em] text-slate-300">VÉRTICE</span>
            </div>
            <p className="max-w-sm text-[10px] leading-5 text-slate-600">Análises quantitativas, gestão patrimonial e educação financeira reunidas em uma única plataforma.</p>
          </div>
          <div>
            <h4 className="mb-3 text-[9px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Produto</h4>
            <ul className="space-y-2 text-[10px]">
              <li><a href="#recursos" className="hover:text-blue-400">Research e recursos</a></li>
              <li><a href="#metas" className="hover:text-blue-400">Sistema de Metas</a></li>
              <li><a href="#planos" className="hover:text-blue-400">Planos</a></li>
              <li><Link to="/pricing" className="hover:text-blue-400">Comparar assinaturas</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-[9px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Legal</h4>
            <ul className="space-y-2 text-[10px]">
              <li><Link to="/terms" className="hover:text-blue-400">Termos de Uso</Link></li>
              <li><Link to="/privacy" className="hover:text-blue-400">Privacidade</Link></li>
              <li><Link to="/terms" className="hover:text-blue-400">Compliance</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-800/60 px-6 py-5 text-center text-[9px] leading-5 text-slate-700">
          <p className="mx-auto max-w-3xl">Conteúdo informativo e educacional; não constitui recomendação individualizada de investimento. Investimentos envolvem risco de perda de capital.</p>
          <p className="mt-1">© {new Date().getFullYear()} Vértice Invest Tecnologia Ltda.</p>
        </div>
      </footer>
    </div>
    </>
  );
};
