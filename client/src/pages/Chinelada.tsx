import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BatteryCharging,
  Bolt,
  Coffee,
  Crosshair,
  Crown,
  RotateCcw,
  Shield,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';

type GameStatus = 'ready' | 'playing' | 'finished';
type RoachKind = 'comum' | 'ligeira' | 'cascuda' | 'dourada';

interface Roach {
  id: number;
  kind: RoachKind;
  x: number;
  lane: number;
  hp: number;
  maxHp: number;
  reward: number;
  speed: number;
  direction: 1 | -1;
}

interface SaveData {
  reputation: number;
  bestScore: number;
  totalKills: number;
  rubberLevel: number;
  staminaLevel: number;
  sprayLevel: number;
}

const SAVE_KEY = 'chinelada-save-v1';
const DEFAULT_SAVE: SaveData = {
  reputation: 0,
  bestScore: 0,
  totalKills: 0,
  rubberLevel: 0,
  staminaLevel: 0,
  sprayLevel: 0,
};

const ROACH_DATA: Record<RoachKind, { label: string; hp: number; reward: number; speed: number; color: string }> = {
  comum: { label: 'Barata comum', hp: 1, reward: 7, speed: 8, color: '#402318' },
  ligeira: { label: 'Barata ligeira', hp: 1, reward: 11, speed: 14, color: '#6b3020' },
  cascuda: { label: 'Barata cascuda', hp: 3, reward: 24, speed: 6, color: '#263318' },
  dourada: { label: 'Barata dourada', hp: 2, reward: 60, speed: 11, color: '#a86f13' },
};

const RUN_UPGRADES = [
  { id: 'power', title: 'Chinelo pesado', description: '+1 de dano por tapa', icon: Bolt, color: 'text-orange-300' },
  { id: 'crit', title: 'Mira de mãe', description: '+10% de chance crítica', icon: Crosshair, color: 'text-rose-300' },
  { id: 'coffee', title: 'Cafezinho', description: '+25 de energia agora', icon: Coffee, color: 'text-amber-300' },
  { id: 'auto', title: 'Inseticida', description: 'Dano automático por segundo', icon: Zap, color: 'text-lime-300' },
] as const;

const META_UPGRADES = [
  { id: 'rubberLevel', title: 'Borracha reforçada', description: '+1 dano inicial', icon: Shield },
  { id: 'staminaLevel', title: 'Alongamento de pulso', description: '+15 energia máxima', icon: BatteryCharging },
  { id: 'sprayLevel', title: 'Dedetização preventiva', description: '+1 auto-dano inicial', icon: Sparkles },
] as const;

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? { ...DEFAULT_SAVE, ...JSON.parse(raw) } : DEFAULT_SAVE;
  } catch {
    return DEFAULT_SAVE;
  }
}

function pickRoach(id: number, difficulty: number): Roach {
  const roll = Math.random();
  const kind: RoachKind = roll > 0.96 ? 'dourada' : roll > 0.76 ? 'cascuda' : roll > 0.5 ? 'ligeira' : 'comum';
  const data = ROACH_DATA[kind];
  const direction = Math.random() > 0.5 ? 1 : -1;
  return {
    id,
    kind,
    x: direction === 1 ? 4 : 96,
    lane: Math.floor(Math.random() * 4),
    hp: data.hp,
    maxHp: data.hp,
    reward: data.reward,
    speed: data.speed + Math.min(difficulty * 0.35, 7),
    direction,
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('pt-BR').format(Math.floor(value));
}

function RoachDrawing({ color, golden }: { color: string; golden?: boolean }) {
  const shellLight = golden ? '#ffe58a' : '#9a5a38';
  const shellDark = golden ? '#70420b' : '#160d0a';
  const limbColor = golden ? '#8d5a12' : '#24120e';
  return (
    <svg viewBox="0 0 120 96" className="h-full w-full overflow-visible" aria-hidden="true">
      <defs>
        <radialGradient id="roach-shell" cx="36%" cy="22%" r="78%">
          <stop offset="0" stopColor={shellLight} />
          <stop offset="0.42" stopColor={color} />
          <stop offset="1" stopColor={shellDark} />
        </radialGradient>
        <linearGradient id="roach-wing" x1="0" x2="1" y1="0" y2="1">
          <stop stopColor={golden ? '#f8c84b' : '#63341f'} />
          <stop offset="0.55" stopColor={color} />
          <stop offset="1" stopColor={shellDark} />
        </linearGradient>
        <radialGradient id="roach-head" cx="38%" cy="22%" r="80%">
          <stop stopColor={golden ? '#e7a92d' : '#5f3222'} />
          <stop offset="1" stopColor={shellDark} />
        </radialGradient>
        <filter id="roach-blur"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>

      <ellipse cx="62" cy="82" rx="38" ry="10" fill="#160c08" opacity=".48" filter="url(#roach-blur)" />

      <g fill="none" stroke={limbColor} strokeLinecap="round" strokeLinejoin="round" strokeWidth="5">
        <g>
          <path d="M42 33 24 21 8 18M39 47 18 45 4 54M42 61 22 70 9 84" />
          <circle cx="24" cy="21" r="3" fill={limbColor} /><circle cx="18" cy="45" r="3" fill={limbColor} /><circle cx="22" cy="70" r="3" fill={limbColor} />
          <animateTransform attributeName="transform" type="rotate" values="-2 42 48;2 42 48;-2 42 48" dur=".32s" repeatCount="indefinite" />
        </g>
        <g>
          <path d="M78 33 96 21 112 18M81 47 102 45 116 54M78 61 98 70 111 84" />
          <circle cx="96" cy="21" r="3" fill={limbColor} /><circle cx="102" cy="45" r="3" fill={limbColor} /><circle cx="98" cy="70" r="3" fill={limbColor} />
          <animateTransform attributeName="transform" type="rotate" values="2 78 48;-2 78 48;2 78 48" dur=".32s" repeatCount="indefinite" />
        </g>
        <path d="M52 20C40 7 29 2 17 1M68 20C80 7 91 2 103 1" strokeWidth="3" />
      </g>

      <ellipse cx="60" cy="55" rx="28" ry="34" fill={shellDark} opacity=".85" />
      <ellipse cx="60" cy="48" rx="29" ry="35" fill="url(#roach-shell)" stroke={shellDark} strokeWidth="3" />
      <path d="M60 18C47 22 39 34 38 52c0 14 7 23 19 29 1-18 2-40 3-63Z" fill="url(#roach-wing)" stroke={shellDark} strokeWidth="1.5" />
      <path d="M60 18c13 4 21 16 22 34 0 14-7 23-19 29-1-18-2-40-3-63Z" fill="url(#roach-wing)" stroke={shellDark} strokeWidth="1.5" />
      <path d="M60 21v58" opacity=".7" stroke={golden ? '#ffe296' : '#b66c47'} strokeWidth="1.5" />
      <path d="M43 31c5-8 11-11 17-12M41 43c4-8 9-12 15-14" fill="none" opacity=".45" stroke={shellLight} strokeLinecap="round" strokeWidth="3" />

      <ellipse cx="60" cy="22" rx="18" ry="13" fill={shellDark} opacity=".75" />
      <ellipse cx="60" cy="17" rx="17" ry="12" fill="url(#roach-head)" stroke={shellDark} strokeWidth="3" />
      <path d="M49 13c5-5 13-6 20-2" fill="none" opacity=".55" stroke={shellLight} strokeLinecap="round" strokeWidth="3" />
      <circle cx="51" cy="13" r="2.5" fill="#fff4c7" /><circle cx="69" cy="13" r="2.5" fill="#fff4c7" />
      <circle cx="51" cy="13" r="1" fill="#1b0d08" /><circle cx="69" cy="13" r="1" fill="#1b0d08" />
    </svg>
  );
}

function SlipperMark() {
  return (
    <svg viewBox="0 0 120 220" className="h-full w-full drop-shadow-[0_22px_14px_rgba(0,0,0,0.38)]" aria-hidden="true">
      <path d="M60 4C33 4 17 19 16 48L9 180c-1 23 14 36 39 37l21-1c26-2 41-18 40-42L103 48C101 20 87 4 60 4Z" fill="#f46036" stroke="#a92d1b" strokeWidth="5" />
      <path d="M21 53c18 3 31 15 39 39 8-24 20-36 39-40" fill="none" stroke="#ffd0b5" strokeLinecap="round" strokeWidth="13" />
      <path d="M60 86v36" stroke="#ffd0b5" strokeLinecap="round" strokeWidth="12" />
      <path d="M21 169c24 11 52 10 82-4" fill="none" opacity=".25" stroke="#7e2419" strokeWidth="5" />
    </svg>
  );
}

function StatPill({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: string; accent: string }) {
  return (
    <div className="flex min-w-[130px] items-center gap-3 rounded-2xl border border-white/10 bg-[#231d19]/85 px-4 py-3 shadow-xl backdrop-blur-md">
      <div className={`rounded-xl bg-white/5 p-2 ${accent}`}><Icon className="h-5 w-5" /></div>
      <div><p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-stone-400">{label}</p><p className="text-lg font-black text-stone-50">{value}</p></div>
    </div>
  );
}

export function Chinelada() {
  const [save, setSave] = useState<SaveData>(loadSave);
  const [status, setStatus] = useState<GameStatus>('ready');
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [kills, setKills] = useState(0);
  const [combo, setCombo] = useState(0);
  const [stamina, setStamina] = useState(100 + save.staminaLevel * 15);
  const [power, setPower] = useState(1 + save.rubberLevel);
  const [crit, setCrit] = useState(0.05);
  const [autoDamage, setAutoDamage] = useState(save.sprayLevel);
  const [upgradeLevels, setUpgradeLevels] = useState<Record<string, number>>({ power: 0, crit: 0, coffee: 0, auto: 0 });
  const [roach, setRoach] = useState<Roach>(() => pickRoach(1, 0));
  const [impact, setImpact] = useState<{ id: number; x: number; lane: number; text: string; critical: boolean } | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [earnedReputation, setEarnedReputation] = useState(0);
  const idRef = useRef(2);
  const audioRef = useRef<AudioContext | null>(null);
  const maxStamina = 100 + save.staminaLevel * 15;

  useEffect(() => {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  }, [save]);

  const beep = useCallback((frequency: number, duration = 0.06) => {
    if (!soundOn) return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = audioRef.current || new AudioContextClass();
      audioRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(80, frequency / 2), context.currentTime + duration);
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    } catch {
      // Audio feedback is optional; gameplay must keep working if unavailable.
    }
  }, [soundOn]);

  const finishRun = useCallback(() => {
    setStatus(current => {
      if (current !== 'playing') return current;
      const legacy = Math.max(1, Math.floor(score / 350) + Math.floor(kills / 8));
      setEarnedReputation(legacy);
      setSave(previous => ({
        ...previous,
        reputation: previous.reputation + legacy,
        bestScore: Math.max(previous.bestScore, score),
        totalKills: previous.totalKills + kills,
      }));
      beep(120, 0.25);
      return 'finished';
    });
  }, [beep, kills, score]);

  useEffect(() => {
    if (status !== 'playing') return;
    const timer = window.setInterval(() => {
      setStamina(value => {
        const next = Math.max(0, value - 0.09);
        if (next === 0) window.setTimeout(finishRun, 0);
        return next;
      });
      setRoach(current => {
        const nextX = current.x + current.speed * 0.055 * current.direction;
        if (nextX > 109 || nextX < -9) {
          setCombo(0);
          setStamina(value => Math.max(0, value - 8));
          return pickRoach(idRef.current++, kills);
        }
        return { ...current, x: nextX };
      });
    }, 55);
    return () => window.clearInterval(timer);
  }, [finishRun, kills, status]);

  useEffect(() => {
    if (status !== 'playing' || autoDamage <= 0) return;
    const timer = window.setInterval(() => {
      setRoach(current => {
        const nextHp = current.hp - autoDamage;
        if (nextHp > 0) return { ...current, hp: nextHp };
        const reward = current.reward;
        setKills(value => value + 1);
        setCoins(value => value + reward);
        setScore(value => value + reward * 10);
        return pickRoach(idRef.current++, kills + 1);
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [autoDamage, kills, status]);

  const startRun = () => {
    setScore(0);
    setCoins(0);
    setKills(0);
    setCombo(0);
    setStamina(maxStamina);
    setPower(1 + save.rubberLevel);
    setCrit(0.05);
    setAutoDamage(save.sprayLevel);
    setUpgradeLevels({ power: 0, crit: 0, coffee: 0, auto: 0 });
    setEarnedReputation(0);
    setRoach(pickRoach(idRef.current++, 0));
    setStatus('playing');
    beep(520, 0.12);
  };

  const hitRoach = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (status !== 'playing' || stamina < 3) return;
    const isCritical = Math.random() < crit;
    const damage = power * (isCritical ? 2 : 1);
    setStamina(value => Math.max(0, value - 3));
    setImpact({ id: Date.now(), x: roach.x, lane: roach.lane, text: isCritical ? `CRÍTICO! -${damage}` : `-${damage}`, critical: isCritical });
    window.setTimeout(() => setImpact(null), 430);
    beep(isCritical ? 290 : 190);
    setRoach(current => {
      const nextHp = current.hp - damage;
      if (nextHp > 0) return { ...current, hp: nextHp };
      const nextCombo = combo + 1;
      const multiplier = 1 + Math.min(nextCombo, 20) * 0.05;
      const reward = Math.round(current.reward * multiplier);
      setCombo(nextCombo);
      setKills(value => value + 1);
      setCoins(value => value + reward);
      setScore(value => value + reward * 10);
      beep(current.kind === 'dourada' ? 880 : 420, 0.11);
      return pickRoach(idRef.current++, kills + 1);
    });
  };

  const miss = () => {
    if (status !== 'playing') return;
    setCombo(0);
    setStamina(value => Math.max(0, value - 5));
    beep(90);
  };

  const upgradeCost = (id: string) => 25 + (upgradeLevels[id] || 0) * 30;

  const buyRunUpgrade = (id: typeof RUN_UPGRADES[number]['id']) => {
    const cost = upgradeCost(id);
    if (status !== 'playing' || coins < cost) return;
    setCoins(value => value - cost);
    setUpgradeLevels(levels => ({ ...levels, [id]: (levels[id] || 0) + 1 }));
    if (id === 'power') setPower(value => value + 1);
    if (id === 'crit') setCrit(value => Math.min(0.65, value + 0.1));
    if (id === 'coffee') setStamina(value => Math.min(maxStamina, value + 25));
    if (id === 'auto') setAutoDamage(value => value + 1);
    beep(660, 0.1);
  };

  const buyMetaUpgrade = (id: keyof Pick<SaveData, 'rubberLevel' | 'staminaLevel' | 'sprayLevel'>) => {
    if (status === 'playing') return;
    const cost = 2 + save[id] * 2;
    if (save.reputation < cost) return;
    setSave(previous => ({ ...previous, reputation: previous.reputation - cost, [id]: previous[id] + 1 }));
    beep(760, 0.14);
  };

  const reputationPreview = Math.max(1, Math.floor(score / 350) + Math.floor(kills / 8));
  const energyPercent = Math.max(0, Math.min(100, (stamina / maxStamina) * 100));

  return (
    <main className="min-h-screen overflow-hidden bg-[#17120f] font-sans text-stone-100 selection:bg-orange-400/30">
      <div className="pointer-events-none fixed inset-0 opacity-[0.055] [background-image:url('data:image/svg+xml,%3Csvg_viewBox=%220_0_180_180%22_xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter_id=%22n%22%3E%3CfeTurbulence_type=%22fractalNoise%22_baseFrequency=%220.7%22_numOctaves=%224%22_stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect_width=%22100%25%22_height=%22100%25%22_filter=%22url(%23n)%22_opacity=%220.8%22/%3E%3C/svg%3E')]" />

      <header className="relative z-20 border-b border-white/10 bg-[#1b1512]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 -rotate-6 place-items-center rounded-xl bg-orange-500 text-xl font-black text-[#25130d] shadow-[0_6px_0_#9a3412]">CH</div>
            <div><h1 className="text-xl font-black uppercase italic tracking-tight text-orange-100">Chinelada!</h1><p className="text-[10px] font-bold uppercase tracking-[0.24em] text-orange-400">A noite é longa. Elas também.</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatPill icon={Trophy} label="Recorde" value={formatNumber(Math.max(save.bestScore, score))} accent="text-amber-300" />
            <StatPill icon={Crown} label="Respeito" value={formatNumber(save.reputation)} accent="text-violet-300" />
            <button onClick={() => setSoundOn(value => !value)} className="rounded-xl border border-white/10 bg-white/5 p-3 text-stone-300 transition hover:bg-white/10 hover:text-white" aria-label={soundOn ? 'Desativar som' : 'Ativar som'}>
              {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      <div className="relative mx-auto grid max-w-[1500px] gap-5 px-4 py-5 lg:grid-cols-[270px_minmax(0,1fr)_300px] lg:px-8">
        <aside className="order-2 rounded-[28px] border border-white/10 bg-[#211a16]/90 p-5 lg:order-1">
          <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-400">Durante a run</p><h2 className="text-xl font-black">Kit anti-praga</h2></div><span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-300">🪙 {coins}</span></div>
          <div className="space-y-3">
            {RUN_UPGRADES.map(item => {
              const cost = upgradeCost(item.id);
              const Icon = item.icon;
              const affordable = coins >= cost && status === 'playing';
              return (
                <button key={item.id} onClick={() => buyRunUpgrade(item.id)} disabled={!affordable} className={`group w-full rounded-2xl border p-4 text-left transition ${affordable ? 'border-orange-400/30 bg-orange-400/10 hover:-translate-y-0.5 hover:border-orange-300/60' : 'border-white/5 bg-black/10 opacity-55'}`}>
                  <div className="flex items-start gap-3"><div className="rounded-xl bg-black/20 p-2"><Icon className={`h-5 w-5 ${item.color}`} /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-extrabold">{item.title}</p><span className="text-[10px] font-black text-stone-500">NV. {upgradeLevels[item.id]}</span></div><p className="mt-1 text-[11px] leading-4 text-stone-400">{item.description}</p><p className="mt-2 text-xs font-black text-amber-300">🪙 {cost}</p></div></div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="order-1 min-w-0 lg:order-2">
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-white/10 bg-[#211a16] px-4 py-3"><p className="text-[9px] font-black uppercase tracking-widest text-stone-500">Pontuação</p><p className="text-xl font-black text-orange-100">{formatNumber(score)}</p></div>
            <div className="rounded-2xl border border-white/10 bg-[#211a16] px-4 py-3"><p className="text-[9px] font-black uppercase tracking-widest text-stone-500">Baratas</p><p className="text-xl font-black text-lime-300">{kills}</p></div>
            <div className="rounded-2xl border border-white/10 bg-[#211a16] px-4 py-3"><p className="text-[9px] font-black uppercase tracking-widest text-stone-500">Combo</p><p className="text-xl font-black text-rose-300">x{combo}</p></div>
          </div>

          <div className="relative overflow-hidden rounded-[30px] border-4 border-[#49382d] bg-[#b18d65] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
            <div onClick={miss} className="relative block h-[510px] w-full cursor-crosshair overflow-hidden text-left sm:h-[570px]" aria-label="Área do jogo">
              {/* Back wall and ceiling line establish the first isometric axis. */}
              <div className="absolute inset-x-0 top-0 h-[35%] bg-gradient-to-b from-[#ead9bd] to-[#c9ac87] [background-image:linear-gradient(120deg,rgba(255,255,255,.22),transparent_42%)]" />
              <div className="absolute inset-x-0 top-[34%] h-5 bg-[#4a3124] shadow-[0_10px_18px_rgba(30,15,8,.45)]" />

              {/* Diamond floor: converging diagonals create the almost-isometric camera. */}
              <div className="absolute -inset-x-[18%] bottom-[-8%] top-[34%] origin-top bg-[#aa7a4f] [background-image:linear-gradient(30deg,rgba(65,38,22,.38)_2px,transparent_2px),linear-gradient(150deg,rgba(65,38,22,.38)_2px,transparent_2px),linear-gradient(30deg,rgba(255,226,180,.18)_1px,transparent_1px),linear-gradient(150deg,rgba(255,226,180,.18)_1px,transparent_1px)] [background-position:0_0,0_0,55px_32px,55px_32px] [background-size:110px_64px] [transform:perspective(700px)_rotateX(10deg)]" />
              <div className="absolute bottom-0 left-0 top-[34%] w-[14%] bg-gradient-to-r from-[#4a2e20] to-[#7a5037] [clip-path:polygon(0_0,100%_12%,100%_88%,0_100%)]" />
              <div className="absolute bottom-0 right-0 top-[34%] w-[14%] bg-gradient-to-l from-[#4a2e20] to-[#7a5037] [clip-path:polygon(0_12%,100%_0,100%_100%,0_88%)]" />

              {/* Isometric kitchen cabinets with top and side faces. */}
              <div className="absolute left-[2%] top-[17%] h-[20%] w-[34%]">
                <div className="absolute inset-x-0 top-0 h-[28%] -skew-y-[7deg] bg-[#edd1a0] shadow-lg" />
                <div className="absolute inset-x-[4%] bottom-0 top-[22%] grid grid-cols-2 gap-1 -skew-y-[7deg] bg-[#684635] p-1.5">
                  <div className="border border-[#3e281f] bg-[#805b45]"><span className="mx-auto mt-4 block h-1 w-5 rounded-full bg-[#d7b680]" /></div>
                  <div className="border border-[#3e281f] bg-[#805b45]"><span className="mx-auto mt-4 block h-1 w-5 rounded-full bg-[#d7b680]" /></div>
                </div>
              </div>
              <div className="absolute right-[3%] top-[12%] h-[26%] w-[29%]">
                <div className="absolute inset-x-0 top-0 h-[24%] skew-y-[8deg] bg-[#e7c58d] shadow-lg" />
                <div className="absolute inset-x-[5%] bottom-0 top-[19%] grid grid-cols-2 gap-1 skew-y-[8deg] bg-[#54382c] p-1.5">
                  <div className="bg-[#72503d]" /><div className="bg-[#72503d]" />
                </div>
                <div className="absolute left-[24%] top-[-34%] h-16 w-14 rounded-b-lg bg-gradient-to-br from-[#8aa0a0] to-[#3d5154] shadow-xl"><div className="mx-auto mt-2 h-9 w-8 rounded bg-[#17262b]" /></div>
              </div>

              <div className="absolute left-[43%] top-[7%] h-20 w-24 -skew-y-[3deg] border-[7px] border-[#604435] bg-[#182229] shadow-xl"><div className="absolute inset-2 bg-gradient-to-br from-[#142531] to-[#385363]"><div className="absolute bottom-2 left-3 h-8 w-4 rounded-t-full bg-[#dfc270]" /><div className="absolute bottom-2 right-4 h-12 w-5 rounded-t-full bg-[#8aaf83]" /></div></div>
              <div className="absolute right-[37%] top-[10%] h-16 w-16 rounded-full border-[7px] border-[#6f513e] bg-[#f2e1bd] shadow-lg"><div className="absolute left-1/2 top-1/2 h-1 w-5 origin-left -rotate-45 bg-[#5c4437]" /><div className="absolute left-1/2 top-1/2 h-1 w-4 origin-left rotate-90 bg-[#b14b32]" /></div>

              {/* Foreground props reinforce depth and frame the play area. */}
              <div className="absolute -bottom-9 -left-6 z-[8] h-36 w-36 rotate-[18deg] rounded-[50%] border-[12px] border-[#49614a] bg-gradient-to-br from-[#8eaa73] to-[#334936] shadow-2xl"><div className="absolute left-1/2 top-[-46px] h-20 w-3 -translate-x-1/2 -rotate-12 rounded-full bg-[#48613f]" /></div>
              <div className="absolute -bottom-5 -right-8 z-[8] h-32 w-40 -rotate-[12deg] bg-[#5a3828] shadow-2xl [clip-path:polygon(10%_18%,85%_0,100%_78%,20%_100%)]"><div className="absolute inset-4 bg-[#714936] [clip-path:inherit]" /></div>

              {[0, 1, 2, 3].map(lane => <div key={lane} className="absolute inset-x-[12%] border-t border-black/[0.03]" style={{ top: `${46 + lane * 12}%` }} />)}

              <button
                onClick={hitRoach}
                disabled={status !== 'playing'}
                className="group absolute z-10 h-[76px] w-[94px] disabled:cursor-default sm:h-[92px] sm:w-[112px]"
                style={{ left: `${roach.x}%`, top: `${41 + roach.lane * 12}%`, transform: `translateX(-50%) scale(${0.72 + roach.lane * 0.13}) scaleX(${roach.direction})`, transformOrigin: '50% 85%' }}
                aria-label={`${ROACH_DATA[roach.kind].label}, ${roach.hp} de vida`}
              >
                {roach.maxHp > 1 && <span className="absolute -top-3 left-1/2 z-20 h-1.5 w-12 -translate-x-1/2 overflow-hidden rounded-full bg-black/35"><span className="block h-full bg-lime-400" style={{ width: `${(roach.hp / roach.maxHp) * 100}%` }} /></span>}
                <span className="block h-full w-full origin-bottom transition-transform duration-100 group-hover:scale-110 group-active:scale-75 [filter:drop-shadow(0_14px_7px_rgba(31,15,7,.45))]">
                  <RoachDrawing color={ROACH_DATA[roach.kind].color} golden={roach.kind === 'dourada'} />
                </span>
              </button>

              {impact && <div key={impact.id} className={`pointer-events-none absolute z-30 animate-[ping_.42s_ease-out_1] text-center font-black drop-shadow-lg ${impact.critical ? 'text-2xl text-yellow-200' : 'text-lg text-white'}`} style={{ left: `${impact.x}%`, top: `${42 + impact.lane * 12}%` }}>{impact.text}</div>}

              {status !== 'playing' && (
                <div className="absolute inset-0 z-40 grid place-items-center bg-[#17110d]/78 px-5 text-center backdrop-blur-sm">
                  {status === 'ready' ? (
                    <div className="max-w-md animate-fade-in">
                      <div className="mx-auto mb-3 h-36 w-24 rotate-12"><SlipperMark /></div>
                      <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-400">A cozinha foi invadida</p>
                      <h2 className="mt-2 text-4xl font-black uppercase italic leading-none text-orange-50 sm:text-5xl">Sua casa.<br />Suas regras.</h2>
                      <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-stone-300">Clique nas baratas antes que escapem. Cada chinelada gasta energia — escolha bem seus upgrades.</p>
                      <button onClick={(event) => { event.stopPropagation(); startRun(); }} className="mt-6 rounded-2xl bg-orange-500 px-8 py-4 text-sm font-black uppercase tracking-widest text-[#2b150d] shadow-[0_7px_0_#9a3412] transition hover:-translate-y-1 active:translate-y-1 active:shadow-none">Começar a caçada</button>
                    </div>
                  ) : (
                    <div className="max-w-md animate-fade-in">
                      <p className="text-xs font-black uppercase tracking-[0.3em] text-rose-300">O braço pediu arrego</p>
                      <h2 className="mt-2 text-5xl font-black uppercase italic text-white">Fim da run</h2>
                      <div className="my-6 grid grid-cols-3 gap-2"><div className="rounded-xl bg-white/5 p-3"><b className="block text-xl text-orange-200">{formatNumber(score)}</b><span className="text-[9px] uppercase text-stone-400">pontos</span></div><div className="rounded-xl bg-white/5 p-3"><b className="block text-xl text-lime-300">{kills}</b><span className="text-[9px] uppercase text-stone-400">baratas</span></div><div className="rounded-xl bg-violet-400/10 p-3"><b className="block text-xl text-violet-300">+{earnedReputation}</b><span className="text-[9px] uppercase text-stone-400">respeito</span></div></div>
                      <button onClick={(event) => { event.stopPropagation(); startRun(); }} className="rounded-2xl bg-orange-500 px-8 py-4 text-sm font-black uppercase tracking-widest text-[#2b150d] shadow-[0_7px_0_#9a3412] transition hover:-translate-y-1"><RotateCcw className="mr-2 inline h-4 w-4" />Tentar de novo</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="relative z-20 border-t-4 border-[#49382d] bg-[#251c17] px-5 py-4">
              <div className="mb-2 flex items-center justify-between text-xs font-black"><span className="flex items-center gap-2 uppercase tracking-wider text-stone-300"><BatteryCharging className="h-4 w-4 text-lime-300" /> Energia do braço</span><span className={energyPercent < 25 ? 'text-rose-300' : 'text-stone-300'}>{Math.ceil(stamina)} / {maxStamina}</span></div>
              <div className="h-4 overflow-hidden rounded-full border border-white/10 bg-black/35 p-0.5"><div className={`h-full rounded-full transition-[width] duration-150 ${energyPercent < 25 ? 'bg-gradient-to-r from-rose-600 to-orange-400' : 'bg-gradient-to-r from-lime-500 to-emerald-300'}`} style={{ width: `${energyPercent}%` }} /></div>
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-stone-500"><span>Dano {power}</span><span>Crítico {Math.round(crit * 100)}%</span><span>Auto {autoDamage}/s</span><span>Próx. respeito +{reputationPreview}</span></div>
            </div>
          </div>
        </section>

        <aside className="order-3 rounded-[28px] border border-white/10 bg-[#211a16]/90 p-5">
          <div className="mb-5"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Entre as runs</p><h2 className="text-xl font-black">Legado da casa</h2><p className="mt-2 text-xs leading-5 text-stone-400">Melhorias permanentes. Elas continuam ativas depois que seu braço cansar.</p></div>
          <div className="space-y-3">
            {META_UPGRADES.map(item => {
              const level = save[item.id];
              const cost = 2 + level * 2;
              const Icon = item.icon;
              const affordable = save.reputation >= cost && status !== 'playing';
              return (
                <button key={item.id} onClick={() => buyMetaUpgrade(item.id)} disabled={!affordable} className={`w-full rounded-2xl border p-4 text-left transition ${affordable ? 'border-violet-400/30 bg-violet-400/10 hover:border-violet-300/60' : 'border-white/5 bg-black/10 opacity-60'}`}>
                  <div className="flex items-start gap-3"><div className="rounded-xl bg-violet-400/10 p-2 text-violet-300"><Icon className="h-5 w-5" /></div><div className="flex-1"><div className="flex items-center justify-between"><p className="text-sm font-extrabold">{item.title}</p><span className="text-[10px] font-black text-stone-500">NV. {level}</span></div><p className="mt-1 text-[11px] text-stone-400">{item.description}</p><p className="mt-2 text-xs font-black text-violet-300"><Crown className="mr-1 inline h-3 w-3" /> {cost}</p></div></div>
                </button>
              );
            })}
          </div>
          <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-black/10 p-4">
            <div className="flex items-center justify-between text-xs"><span className="font-bold text-stone-400">Exterminadas na carreira</span><b>{formatNumber(save.totalKills + (status === 'playing' ? kills : 0))}</b></div>
            <div className="mt-2 flex items-center justify-between text-xs"><span className="font-bold text-stone-400">Maior pontuação</span><b>{formatNumber(Math.max(save.bestScore, score))}</b></div>
          </div>
          <div className="mt-4 rounded-2xl bg-orange-400/10 p-4 text-xs leading-5 text-orange-100"><b className="block text-orange-300">Dica de chinelada</b>Baratas douradas valem muito mais. As cascudas precisam de vários golpes.</div>
        </aside>
      </div>
    </main>
  );
}
