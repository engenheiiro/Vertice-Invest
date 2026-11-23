/**
 * Caracterização do SecuritySection (Perfil → Segurança & Acesso): trava o que a
 * tela MOSTRA e o que ela MANDA ao servidor (rota, método e corpo de cada fetch),
 * percorrendo caminhos sorteados (PRNG semeado) por status do MFA, ativação com
 * senha → QR → código, desativação pelo segundo fator, códigos de backup e troca
 * de senha, com respostas de sucesso, 400/403/429/500, JSON inválido, erro de
 * rede, requisição pendente e rejeições que não são `Error`.
 *
 * O serviço de autenticação é o REAL; só o `fetch` é falso. A tela não usa toast
 * (as mensagens são inline) — o rastro grava o HTML depois de cada passo.
 * Valores de senha/código são de teste, óbvios, e nunca segredos reais.
 */
import React from 'react';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SecuritySection } from './SecuritySection';
import { authService } from '../../services/auth';
import { recordApiError } from '../../utils/supportContext';

vi.mock('../../utils/supportContext', () => ({ recordApiError: vi.fn() }));

const AGORA = new Date('2026-11-22T15:00:00.000Z');

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Kind = 'ok' | 'okVazio' | 'r400' | 'r403' | 'r429' | 'r500' | 'jsonInvalido' | 'rede' | 'pendente'
  | 'naoErroObjeto' | 'naoErroString' | 'erroSemMensagem';
const MUTATION_KINDS: Kind[] = ['ok', 'ok', 'ok', 'okVazio', 'r400', 'r403', 'r429', 'r500', 'jsonInvalido', 'rede',
  'pendente', 'naoErroObjeto', 'naoErroString', 'erroSemMensagem'];
const STATUS_KINDS = ['ativo', 'inativo', 'vazio', 'rede', 'r500', 'pendente', 'atrasado'] as const;
type StatusKind = (typeof STATUS_KINDS)[number];

const OK_BODIES: Record<string, unknown> = {
  '/api/mfa/setup': { secret: 'SEGREDO-DE-TESTE', otpauth: 'otpauth://teste', qr: 'data:image/png;base64,qrteste' },
  '/api/mfa/enable': { backupCodes: ['aaaa-1111', 'bbbb-2222', 'cccc-3333'] },
  '/api/mfa/disable': { message: 'ok' },
  '/api/change-password': { message: 'ok' },
};

const PASSWORDS = ['', 'abc', 'senhaTeste1', 'senhaTeste2', '12345', '123456'];
const CODES = ['', '   ', '123456', ' 654321 ', 'abcd-efgh', '1234', '12345678901'];

interface Sim {
  rand: () => number;
  pick: <T>(arr: readonly T[]) => T;
  nextKind: Kind;
  calls: unknown[];
}

const never = () => new Promise<never>(() => {});

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function makeFetch(sim: Sim, status: StatusKind) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    sim.calls.push({ fetch: url, method: init.method, body });
    if (url === '/api/mfa/status') {
      if (status === 'rede') throw new TypeError('Failed to fetch');
      if (status === 'pendente') return never();
      if (status === 'atrasado') {
        return new Promise((resolve) => { setTimeout(() => resolve(jsonResponse(200, { mfaEnabled: true })), 3000); });
      }
      if (status === 'r500') return jsonResponse(500, {});
      if (status === 'vazio') return jsonResponse(200, {});
      return jsonResponse(200, { mfaEnabled: status === 'ativo' });
    }
    return mutationResponse(sim.nextKind, url);
  });
}

function mutationResponse(kind: Kind, url: string) {
  switch (kind) {
    case 'okVazio': return jsonResponse(200, {});
    case 'r400': return jsonResponse(400, { message: 'Dados inválidos (teste).' });
    case 'r403': return jsonResponse(403, {});
    case 'r429': return jsonResponse(429, { message: 'Muitas tentativas (teste).' });
    case 'r500': return jsonResponse(500, { message: '' });
    case 'jsonInvalido': return { ok: false, status: 502, json: async () => { throw new SyntaxError('JSON inválido (teste)'); } };
    case 'rede': throw new TypeError('Failed to fetch');
    case 'pendente': return never();
    default: return jsonResponse(200, OK_BODIES[url]);
  }
}

type ServiceMethod = 'setupMfa' | 'enableMfa' | 'disableMfa' | 'changePassword';

function armResponse(sim: Sim, method: ServiceMethod, forced?: Kind) {
  const kind = forced ?? sim.pick(MUTATION_KINDS);
  sim.nextKind = kind;
  sim.calls.push({ resposta: kind });
  const spy = (rejection: unknown) => vi.spyOn(authService, method).mockRejectedValueOnce(rejection);
  if (kind === 'naoErroObjeto') spy({ status: 400 });
  if (kind === 'naoErroString') spy(sim.pick(['Código expirado (teste).', '']));
  if (kind === 'erroSemMensagem') spy(new Error(''));
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 25; i += 1) await Promise.resolve();
  });
};

const q = (label: string) => screen.queryByLabelText(label) as HTMLInputElement | null;
const btn = (name: string) => screen.queryAllByRole('button', { name });

type Action = { name: string; weight: number; run: () => void | Promise<void> };

function pickWeighted(sim: Sim, actions: Action[]): Action {
  const total = actions.reduce((s, a) => s + a.weight, 0);
  let r = sim.rand() * total;
  for (const a of actions) {
    r -= a.weight;
    if (r < 0) return a;
  }
  return actions[actions.length - 1];
}

function availableActions(sim: Sim, container: HTMLElement): Action[] {
  const actions: Action[] = [];
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-label$="2FA"]');
  if (toggle) actions.push({ name: 'toggle', weight: 3, run: () => { fireEvent.click(toggle); } });
  const typeInto = (label: string, pool: string[], weight = 3) => {
    const el = q(label);
    if (!el) return;
    const value = sim.pick(pool);
    actions.push({ name: `digita ${label}=${JSON.stringify(value)}`, weight, run: () => { fireEvent.change(el, { target: { value } }); } });
  };
  typeInto('Senha atual', PASSWORDS);
  typeInto('Código de 6 dígitos', CODES, 5);
  typeInto('Código do app ou de recuperação', CODES);
  typeInto('Senha Atual', PASSWORDS, 2);
  typeInto('Nova Senha', PASSWORDS, 2);
  const nova = q('Nova Senha');
  // Confirmação: metade das vezes repete a nova senha, para chegar à API.
  typeInto('Confirmar Nova Senha', nova ? [nova.value, nova.value, ...PASSWORDS] : PASSWORDS, 2);
  const atual = q('Senha Atual');
  const confirma = q('Confirmar Nova Senha');
  if (atual && nova && confirma) {
    const value = sim.pick(['senhaTeste2', '123456', 'senhaTeste1']);
    actions.push({
      name: `preenche senha nova=${value}`,
      weight: 3,
      run: () => {
        fireEvent.change(atual, { target: { value: 'senhaTeste1' } });
        fireEvent.change(nova, { target: { value } });
        fireEvent.change(confirma, { target: { value } });
      },
    });
  }
  const clickWith = (label: string, buttons: HTMLElement[], weight: number, method?: ServiceMethod) => {
    const el = buttons[buttons.length - 1];
    if (!el) return;
    actions.push({ name: `clica ${label}`, weight, run: () => { if (method) armResponse(sim, method); fireEvent.click(el); } });
  };
  clickWith('Continuar', btn('Continuar'), 6, 'setupMfa');
  clickWith('Ativar (confirmar)', btn('Ativar 2FA').filter((b) => !b.hasAttribute('aria-label')), 10, 'enableMfa');
  clickWith('Desativar', btn('Desativar'), 4, 'disableMfa');
  clickWith('Atualizar Senha', btn('Atualizar Senha'), 4, 'changePassword');
  btn('Cancelar').forEach((el, i) => actions.push({ name: `clica Cancelar#${i}`, weight: 1, run: () => { fireEvent.click(el); } }));
  clickWith('Copiar todos', btn('Copiar todos'), 3);
  clickWith('Copiado!', btn('Copiado!'), 1);
  clickWith('Fechar códigos de backup', btn('Fechar códigos de backup'), 1);
  clickWith('Alterar Senha', screen.queryAllByRole('button', { name: /Alterar Senha/ }), 2);
  clickWith('Fechar alteração de senha', btn('Fechar alteração de senha'), 1);
  const ms = sim.pick([500, 1000, 1600, 2100]);
  actions.push({ name: `espera ${ms}ms`, weight: 3, run: () => { act(() => { vi.advanceTimersByTime(ms); }); } });
  return actions;
}

// Caminhos dirigidos (o sorteio sozinho raramente chegava ao fim de cada fluxo).
// Cada passo é ignorado se o alvo não existe na tela daquele cenário.
const step = {
  toggle: (container: HTMLElement): Action => ({
    name: 'toggle',
    weight: 0,
    run: () => {
      const el = container.querySelector<HTMLButtonElement>('button[aria-label$="2FA"]');
      if (el) fireEvent.click(el);
    },
  }),
  type: (label: string, value: string): Action => ({
    name: `digita ${label}=${JSON.stringify(value)}`,
    weight: 0,
    run: () => { const el = q(label); if (el) fireEvent.change(el, { target: { value } }); },
  }),
  click: (sim: Sim, name: string | RegExp, method?: ServiceMethod, forced?: Kind): Action => ({
    name: `clica ${String(name)}${forced ? ` (${forced})` : ''}`,
    weight: 0,
    run: () => {
      const all = screen.queryAllByRole('button', { name });
      const el = all[all.length - 1];
      if (!el) return;
      if (method) armResponse(sim, method, forced);
      fireEvent.click(el);
    },
  }),
  wait: (ms: number): Action => ({ name: `espera ${ms}ms`, weight: 0, run: () => { act(() => { vi.advanceTimersByTime(ms); }); } }),
};

function directedPrefix(sim: Sim, container: HTMLElement): Action[] {
  const mostlyOk = () => sim.pick<Kind | undefined>(['ok', 'ok', undefined]);
  const toQr = [step.toggle(container), step.type('Senha atual', 'senhaTeste1'), step.click(sim, 'Continuar', 'setupMfa', 'ok')];
  const scripts: Action[][] = [
    [],
    [],
    toQr,
    [...toQr, step.type('Código de 6 dígitos', sim.pick(CODES)), step.click(sim, 'Ativar 2FA', 'enableMfa', mostlyOk()),
      step.click(sim, 'Copiar todos'), step.wait(sim.pick([1000, 1600]))],
    [step.toggle(container), step.type('Código do app ou de recuperação', sim.pick([' 654321 ', 'abcd-efgh ', '1'])),
      step.click(sim, 'Desativar', 'disableMfa')],
    [step.click(sim, /Alterar Senha/), step.type('Senha Atual', 'senhaTeste1'), step.type('Nova Senha', 'senhaTeste2'),
      step.type('Confirmar Nova Senha', 'senhaTeste2'), step.click(sim, 'Atualizar Senha', 'changePassword', mostlyOk()),
      step.wait(sim.pick([1000, 1900, 2100]))],
  ];
  return sim.pick(scripts);
}

// useId gera ids que mudam com a ordem de montagem: troca por apelido estável.
function normalize(html: string): string {
  const ids = new Map<string, string>();
  return html.replace(/:r[0-9a-z]+:/g, (m) => {
    if (!ids.has(m)) ids.set(m, `id#${ids.size + 1}`);
    return ids.get(m) as string;
  });
}

const digest = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

async function runScenario(seed: number) {
  const rand = mulberry32(seed);
  const sim: Sim = {
    rand,
    pick: (arr) => arr[Math.floor(rand() * arr.length)],
    nextKind: 'ok',
    calls: [],
  };
  const status = sim.pick(STATUS_KINDS);
  const hasClipboard = rand() < 0.8;
  const writeText = vi.fn((text: string) => { sim.calls.push({ clipboard: text }); });
  Object.defineProperty(navigator, 'clipboard', { value: hasClipboard ? { writeText } : undefined, configurable: true });
  vi.stubGlobal('fetch', makeFetch(sim, status));

  const steps: unknown[] = [];
  const { container, unmount } = render(<SecuritySection />);
  await flush();
  steps.push({ passo: `inicio(status=${status}, clipboard=${hasClipboard})`, html: normalize(container.innerHTML) });
  const prefix = directedPrefix(sim, container);
  const total = prefix.length + 4 + Math.floor(rand() * 14);
  for (let i = 0; i < total; i += 1) {
    const action = prefix[i] ?? pickWeighted(sim, availableActions(sim, container));
    sim.calls = [];
    await action.run();
    await flush();
    const apiErrors = vi.mocked(recordApiError).mock.calls.splice(0);
    steps.push({ passo: action.name, chamadas: sim.calls, apiErrors, html: normalize(container.innerHTML) });
  }
  unmount();
  // Status que chega depois de desmontar e timers pendentes não podem estourar.
  act(() => { vi.advanceTimersByTime(5000); });
  await flush();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return steps;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(AGORA);
  vi.mocked(recordApiError).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('caracterização do SecuritySection', () => {
  it('rastro (HTML + chamadas) de caminhos sorteados', async () => {
    const hashes: string[] = [];
    const full: Record<string, unknown> = {};
    for (let seed = 1; seed <= 160; seed += 1) {
      const steps = await runScenario(seed);
      const json = JSON.stringify(steps);
      hashes.push(`${seed}: ${digest(json)}`);
      if (seed % 40 === 0) full[`seed ${seed}`] = steps.map((s) => ({ ...(s as object), html: digest((s as { html: string }).html) }));
    }
    expect(hashes).toMatchSnapshot();
    expect(full).toMatchSnapshot();
  }, 120_000);
});
