/**
 * 7.2 / 7.3 — Divergência altista + filtro por volume no signalEngine.
 *
 * Cobre as funções PURAS adicionadas ao motor de sinais:
 *   • detectBullishDivergence — preço faz fundo mais baixo enquanto o RSI faz
 *     fundo mais alto (momentum melhora) → possível virada.
 *   • _rsiSeries — RSI "dia a dia" alinhado ao histórico (mais recente→antigo).
 *   • _volumeStats — confirmação de volume (atual ≥ 1.2× média 20 pregões) com
 *     degradação segura quando não há dado de volume.
 *   • _divergenceUrgency — escalonamento de urgência pela força da sobrevenda.
 *
 * 100% determinístico: nenhuma das funções toca rede/DB.
 */
import { describe, it, expect, vi } from 'vitest';
import { signalEngine } from '../services/engines/signalEngine.js';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ─── Helpers de construção de série (cronológica: antigo→recente) ────────────
// O motor consome o array do MAIS RECENTE para o MAIS ANTIGO, então invertemos.
const toCloses = (chrono) => [...chrono].reverse();

// Série com DIVERGÊNCIA ALTISTA: 2º fundo de preço mais baixo, mas com declínio
// mais suave → RSI faz fundo mais ALTO. Termina em recuperação (preço sobe).
const divergentSeries = () => {
  const c = [];
  for (let i = 0; i < 16; i++) c.push(60 + i * 0.5); // aquecimento (sobe)
  let p = 68;
  for (let i = 0; i < 8; i++) { p -= 3; c.push(p); }   // queda forte → fundo A (RSI baixo)
  for (let i = 0; i < 6; i++) { p += 2.5; c.push(p); } // recuperação parcial
  for (let i = 0; i < 10; i++) { p -= 1.6; c.push(p); } // queda suave → fundo B (mais baixo, RSI maior)
  for (let i = 0; i < 3; i++) { p += 1.2; c.push(p); }  // reação final (preço acima do fundo)
  return toCloses(c);
};

// ─── detectBullishDivergence ────────────────────────────────────────────────
describe('detectBullishDivergence — virada por divergência preço/RSI', () => {
  it('detecta divergência: preço faz fundo mais baixo, RSI faz fundo mais alto', () => {
    const res = signalEngine.detectBullishDivergence(divergentSeries(), 14);
    expect(res).not.toBeNull();
    // preço: fundo recente mais BAIXO que o anterior
    expect(res.priceLow).toBeLessThan(res.priorPriceLow);
    // RSI: fundo recente mais ALTO que o anterior (momentum melhorando)
    expect(res.rsiAtLow).toBeGreaterThan(res.priorRsiLow);
    // fundo recente em zona fraca (< 45) — pré-requisito do sinal
    expect(res.rsiAtLow).toBeLessThan(45);
  });

  it('série curta (< mínimo) retorna null', () => {
    expect(signalEngine.detectBullishDivergence([10, 11, 12, 13], 14)).toBeNull();
  });

  it('entrada inválida (não-array) retorna null', () => {
    expect(signalEngine.detectBullishDivergence(null, 14)).toBeNull();
  });

  it('tendência monotônica (sem pivôs de baixa) retorna null', () => {
    const up = Array.from({ length: 45 }, (_, i) => 50 + i * 0.7);
    expect(signalEngine.detectBullishDivergence(toCloses(up), 14)).toBeNull();
  });

  it('fundo recente MAIS ALTO que o anterior (sem lower low) retorna null', () => {
    const c = [];
    let p = 100;
    for (let i = 0; i < 16; i++) { p -= 0.2; c.push(p); }
    for (let i = 0; i < 8; i++) { p -= 3; c.push(p); }   // fundo A profundo
    for (let i = 0; i < 8; i++) { p += 2; c.push(p); }
    for (let i = 0; i < 6; i++) { p -= 1.5; c.push(p); } // fundo B raso (mais alto que A)
    for (let i = 0; i < 3; i++) { p += 1.2; c.push(p); }
    expect(signalEngine.detectBullishDivergence(toCloses(c), 14)).toBeNull();
  });
});

// ─── _rsiSeries ──────────────────────────────────────────────────────────────
describe('_rsiSeries — RSI alinhado ao histórico', () => {
  it('out[i] casa com calculateRSI(closes.slice(i)); cauda sem janela é null', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 50 + Math.sin(i) * 5);
    const series = signalEngine._rsiSeries(closes, 14);
    expect(series.length).toBe(closes.length);
    // posição 0 deve bater com o cálculo direto
    expect(series[0]).toBeCloseTo(signalEngine.calculateRSI(closes, 14), 6);
    // sem dados suficientes para fechar a janela → null no fim
    expect(series[closes.length - 1]).toBeNull();
  });
});

// ─── _volumeStats ────────────────────────────────────────────────────────────
describe('_volumeStats — filtro por volume (7.3)', () => {
  it('sem dados de volume → não bloqueia (confirmed=true, hasData=false)', () => {
    const v = signalEngine._volumeStats([{ close: 1 }, { close: 2 }]);
    expect(v.hasData).toBe(false);
    expect(v.confirmed).toBe(true);
    expect(v.ratio).toBeNull();
  });

  it('volume atual ≥ 1.2× média 20 → confirmado', () => {
    const hist = [{ volume: 3000 }, ...Array.from({ length: 20 }, () => ({ volume: 1000 }))];
    const v = signalEngine._volumeStats(hist);
    expect(v.hasData).toBe(true);
    expect(v.confirmed).toBe(true);
    expect(v.ratio).toBeGreaterThan(1.2);
  });

  it('volume atual abaixo do gatilho (< 1.2×) → NÃO confirmado', () => {
    const hist = [{ volume: 1050 }, ...Array.from({ length: 20 }, () => ({ volume: 1000 }))];
    const v = signalEngine._volumeStats(hist);
    expect(v.confirmed).toBe(false);
    expect(v.ratio).toBeLessThan(1.2);
  });

  it('ignora volumes inválidos/zerados ao montar a base', () => {
    const hist = [{ volume: 5000 }, ...Array.from({ length: 19 }, () => ({ volume: 1000 })), { volume: 0 }, { volume: NaN }];
    const v = signalEngine._volumeStats(hist);
    // 20 volumes válidos (5000 + 19×1000); média 1200, atual 5000 → confirmado
    expect(v.hasData).toBe(true);
    expect(v.avgVolume).toBeCloseTo(1200, 6);
    expect(v.confirmed).toBe(true);
  });
});

// ─── _divergenceUrgency ──────────────────────────────────────────────────────
describe('_divergenceUrgency — urgência pela força da sobrevenda', () => {
  it('RSI < 25 = CRITICAL, < 35 = HIGH, demais = MEDIUM', () => {
    expect(signalEngine._divergenceUrgency(20)).toBe('CRITICAL');
    expect(signalEngine._divergenceUrgency(30)).toBe('HIGH');
    expect(signalEngine._divergenceUrgency(42)).toBe('MEDIUM');
  });
});
