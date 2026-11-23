/**
 * Caracterização do CoursePlayer, gravada no código de antes da quebra em
 * partes. Cenários gerados por PRNG semeado variam o curso (carregando, negado,
 * sem rede, sem aulas, aulas com/sem vídeo), o progresso (vazio, parcial,
 * completo, falho), a tentativa anterior do teste, a aula pedida na query, a
 * presença do usuário e as respostas do quiz/envio/certificado. Cada cenário
 * roda uma sequência de interações (aulas, player, marcar concluída, teste,
 * respostas, envio, nova tentativa, certificado, voltar) e guarda, a cada
 * passo, o resumo do HTML, a rota, as chamadas à API e os toasts.
 */
import React from 'react';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

type PlayerProps = {
  onProgress: (s: { played: number; playedSeconds?: number }) => void;
  onEnded: () => void;
  onError: (e: unknown) => void;
};

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  addToast: vi.fn(),
  user: { current: { id: 'u1' } as { id: string } | null },
  player: { props: null as PlayerProps | null },
  location: { current: '' },
}));

vi.mock('react-player', () => ({
  default: (props: PlayerProps & { url: string }) => {
    mocks.player.props = props;
    return <div data-testid="react-player">{props.url}</div>;
  },
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user.current }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../services/auth', () => ({ authService: { api: mocks.api } }));

import { CoursePlayer } from './CoursePlayer';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const pick = <T,>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const digest = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

type Kind = 'ok' | 'failMsg' | 'failBare' | 'reject' | 'pending';
type Lesson = { _id: string; title: string; description?: string; duration?: number; youtubeId?: string };
type Question = { text: string; options: string[] };
type Scenario = {
  lessons: Lesson[];
  completed: string[];
  attempts: Array<{ passed: boolean; score: number }>;
  query: string;
  user: boolean;
  course: Kind;
  progress: Kind;
  progressPost: Kind;
  quiz: Kind;
  questions: Question[];
  submit: Kind;
  submitPassed: boolean;
  score: number;
  cert: Kind;
  actions: string[];
  guide?: { seed: number; steps: number };
};

const LESSON_SETS: Lesson[][] = [
  [],
  [{ _id: 'a1', title: 'Única', description: 'Só uma', duration: 600, youtubeId: 'ytA' }],
  [
    { _id: 'l1', title: 'Aula Um', description: 'Primeira', duration: 600, youtubeId: 'yt1' },
    { _id: 'l2', title: 'Aula Dois', description: 'Segunda', duration: 300, youtubeId: 'yt2' },
    { _id: 'l3', title: 'Aula Três', description: 'Terceira', duration: 120 },
  ],
  [
    { _id: 'm1', title: 'Texto Inicial', description: 'Sem vídeo', duration: 59 },
    { _id: 'm2', title: 'Vídeo Longo', duration: 3601, youtubeId: 'ytM2' },
    { _id: 'm3', title: 'Sem Duração', description: 'Desc', youtubeId: 'ytM3' },
    { _id: 'm4', title: 'Fim', description: 'Último', duration: 900, youtubeId: 'ytM4' },
  ],
];
const QUESTION_SETS: Question[][] = [
  [{ text: 'Quanto é 1+1?', options: ['1', '2'] }],
  [{ text: 'Quanto é 1+1?', options: ['1', '2'] }, { text: 'Cor do céu?', options: ['Azul', 'Verde', 'Cinza'] }],
  [
    { text: 'P1', options: ['A', 'B', 'C', 'D'] },
    { text: 'P2', options: ['E', 'F'] },
    { text: 'P3', options: ['G', 'H', 'I'] },
  ],
];
const KINDS: Kind[] = ['ok', 'ok', 'ok', 'failMsg', 'failBare', 'reject', 'pending'];

const never = () => new Promise<never>(() => {});
type Resp = { ok: boolean; json: () => Promise<unknown>; blob: () => Promise<string> };
const respond = (kind: Kind, body: unknown, message: string): Promise<Resp> => {
  if (kind === 'pending') return never();
  if (kind === 'reject') return Promise.reject(new Error(`rede ${message}`));
  if (kind === 'ok') return Promise.resolve({ ok: true, json: async () => body, blob: async () => 'pdf' });
  const errBody = kind === 'failMsg' ? { message } : {};
  return Promise.resolve({ ok: false, json: async () => errBody, blob: async () => '' });
};

function makeScenario(seed: number): Scenario {
  const rng = mulberry32(seed);
  const lessons = pick(rng, LESSON_SETS);
  const mode = pick(rng, ['vazio', 'parcial', 'completo', 'completo', 'completo', 'aleatorio']);
  let completed: string[] = [];
  if (mode === 'parcial') completed = lessons.slice(0, Math.floor(rng() * lessons.length)).map((l) => l._id);
  if (mode === 'completo') completed = lessons.map((l) => l._id);
  if (mode === 'aleatorio') completed = lessons.filter(() => rng() < 0.5).map((l) => l._id);
  const attempts = pick(rng, [[], [], [{ passed: true, score: 88.4 }], [{ passed: false, score: 40 }, { passed: true, score: 99 }]]);
  const query = pick(rng, ['', '', 'nao-existe', ...lessons.map((l) => l._id)]);
  const guide = { seed: seed * 7919, steps: 4 + Math.floor(rng() * 8) };
  return {
    lessons,
    completed,
    attempts,
    query,
    user: rng() < 0.85,
    course: rng() < 0.8 ? 'ok' : pick(rng, ['failMsg', 'failBare', 'reject', 'pending'] as Kind[]),
    progress: rng() < 0.85 ? 'ok' : pick(rng, ['failBare', 'reject'] as Kind[]),
    progressPost: pick(rng, ['ok', 'ok', 'failBare', 'reject'] as Kind[]),
    quiz: pick(rng, KINDS),
    questions: pick(rng, QUESTION_SETS),
    submit: pick(rng, KINDS),
    submitPassed: rng() < 0.5,
    score: pick(rng, [0, 50, 66.6667, 70, 100]),
    cert: pick(rng, KINDS),
    actions: [],
    guide,
  };
}

function wireApi(sc: Scenario) {
  mocks.api.mockImplementation((url: string) => {
    if (url === '/api/academy/courses/c1') return respond(sc.course, { course: { title: 'Curso X' }, lessons: sc.lessons }, 'Plano insuficiente');
    if (url === '/api/academy/progress/c1') {
      const progress = [...sc.completed.map((id) => ({ lessonId: id, completed: true })), { lessonId: 'zz', completed: false }];
      return respond(sc.progress, { progress, quizAttempts: sc.attempts }, 'sem progresso');
    }
    if (url === '/api/academy/progress') return respond(sc.progressPost, {}, 'falhou');
    if (url === '/api/academy/quiz/c1') return respond(sc.quiz, { questions: sc.questions }, 'Quiz fechado');
    if (url === '/api/academy/quiz/submit') {
      const attempt = { passed: sc.submitPassed, score: sc.score };
      return respond(sc.submit, { passed: sc.submitPassed, score: sc.score, passingScore: 70, attempt }, 'Tentativas esgotadas');
    }
    if (url === '/api/academy/certificate/c1') return respond(sc.cert, {}, 'Certificado indisponível');
    return respond('failBare', {}, '');
  });
}

const LocationProbe = () => {
  const loc = useLocation();
  mocks.location.current = `${loc.pathname}${loc.search}`;
  return null;
};

const flush = async () => {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

const buttonWith = (root: HTMLElement, text: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
const enabledWith = (root: HTMLElement, text: string) =>
  Array.from(root.querySelectorAll('button')).some((b) => !b.disabled && b.textContent?.includes(text));
const clickText = (root: HTMLElement, ...texts: string[]) => {
  for (const t of texts) {
    const b = buttonWith(root, t);
    if (b) {
      fireEvent.click(b);
      return true;
    }
  }
  return false;
};
const optionButtons = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('.space-y-8 > .space-y-4')).map((q) => Array.from(q.querySelectorAll('.grid > button')));

/** Ações que a tela oferece agora; o roteiro semeado escolhe entre elas. */
function available(root: HTMLElement): string[] {
  const has = (...texts: string[]) => texts.some((t) => enabledWith(root, t));
  const out: string[] = [];
  if (root.querySelector('.space-y-2 > button:not([disabled])')) out.push('lesson', 'lesson');
  if (has('Teste Final & Certificado', 'Certificado Disponível')) out.push('test');
  if (has('Marcar esta aula como concluída')) out.push('mark');
  if (has('Usar Player Avançado', 'Modo de Compatibilidade')) out.push('toggle');
  if (root.querySelector('[data-testid="react-player"]')) out.push('progress', 'progress', 'ended', 'perror');
  if (optionButtons(root).length) out.push('answer', 'answerAll', 'answerAll', 'answerAll');
  if (has('Finalizar Teste', 'Enviando...')) out.push('submit', 'submit', 'submit');
  if (has('Tentar Novamente')) out.push('retry', 'retry');
  if (has('Iniciar Teste')) out.push('start', 'start');
  if (has('Baixar Certificado', 'Gerando...')) out.push('cert', 'cert');
  if (!out.length && (has('Voltar para a Academia') || root.querySelector('button[aria-label="Voltar aos cursos"]'))) out.push('back');
  return out;
}

type Ctx = { root: HTMLElement; sc: Scenario; n: number; props: PlayerProps | null };
const clickResult = (root: HTMLElement, ...texts: string[]) => (clickText(root, ...texts) ? 'ok' : 'noop');
const withPlayer = (fire: (props: PlayerProps, n: number) => string) => ({ props, n }: Ctx) => {
  if (!props) return 'noop';
  let result = '';
  act(() => {
    result = fire(props, n);
  });
  return result;
};

const HANDLERS: Record<string, (ctx: Ctx) => string> = {
  lesson: ({ root, sc, n }) => {
    if (!sc.lessons.length) return 'noop';
    const idx = n % sc.lessons.length;
    return clickText(root, `${idx + 1}. ${sc.lessons[idx].title}`) ? `lesson${idx}` : 'noop';
  },
  test: ({ root }) => clickResult(root, 'Teste Final & Certificado', 'Certificado Disponível'),
  mark: ({ root }) => clickResult(root, 'Marcar esta aula como concluída'),
  toggle: ({ root }) => clickResult(root, 'Usar Player Avançado', 'Modo de Compatibilidade'),
  progress: withPlayer((props, n) => {
    const played = [0.5, 0.9, 0.91, 1][n % 4];
    props.onProgress(n % 5 === 0 ? { played } : { played, playedSeconds: n });
    return `p${played}`;
  }),
  ended: withPlayer((props) => {
    props.onEnded();
    return 'ok';
  }),
  perror: withPlayer((props) => {
    props.onError(new Error('x'));
    return 'ok';
  }),
  answer: ({ root, n }) => {
    const qs = optionButtons(root);
    if (!qs.length) return 'noop';
    const q = qs[n % qs.length];
    fireEvent.click(q[Math.floor(n / 7) % q.length]);
    return `a${n % qs.length}`;
  },
  answerAll: ({ root, n }) => {
    const qs = optionButtons(root);
    qs.forEach((q, i) => fireEvent.click(q[(n + i * 3) % q.length]));
    return qs.length ? 'all' : 'noop';
  },
  submit: ({ root }) => clickResult(root, 'Finalizar Teste', 'Enviando...'),
  retry: ({ root }) => clickResult(root, 'Tentar Novamente'),
  start: ({ root }) => clickResult(root, 'Iniciar Teste'),
  cert: ({ root }) => clickResult(root, 'Baixar Certificado', 'Gerando...'),
  back: ({ root, n }) => {
    const back = root.querySelector('button[aria-label="Voltar aos cursos"]');
    if (back && n % 3 === 0) {
      fireEvent.click(back);
      return 'header';
    }
    return clickResult(root, 'Voltar para a Academia', 'Ver outros cursos');
  },
};

function runAction(root: HTMLElement, sc: Scenario, action: string): string {
  const [name, raw] = action.split(':');
  const props = root.querySelector('[data-testid="react-player"]') ? mocks.player.props : null;
  return HANDLERS[name]({ root, sc, n: Number(raw), props });
}

const callLog = () =>
  mocks.api.mock.calls.map(([url, init]) => `${url}${init?.body ? ` ${init.method} ${init.body}` : ''}`);
const toastLog = () => mocks.addToast.mock.calls.map((c) => c.join('|'));

async function runScenario(sc: Scenario) {
  mocks.user.current = sc.user ? { id: 'u1' } : null;
  mocks.player.props = null;
  mocks.api.mockReset();
  mocks.addToast.mockReset();
  wireApi(sc);
  const path = `/courses/c1${sc.query ? `?lesson=${sc.query}` : ''}`;
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/courses" element={<div>Catálogo</div>} />
        <Route path="/courses/:courseId" element={<CoursePlayer />} />
      </Routes>
    </MemoryRouter>,
  );
  await flush();
  const steps: Array<Record<string, unknown>> = [];
  let seenCalls = 0;
  const snap = (action: string, result: string) => {
    const calls = callLog();
    steps.push({
      action,
      result,
      html: digest(container.innerHTML),
      loc: mocks.location.current,
      calls: calls.slice(seenCalls),
      toasts: toastLog(),
      anchors: document.querySelectorAll('a[download]').length,
    });
    seenCalls = calls.length;
  };
  snap('init', '');
  const play = async (action: string) => {
    const result = runAction(container, sc, action);
    await flush();
    snap(action, result);
  };
  for (const action of sc.actions) await play(action);
  if (sc.guide) {
    const rng = mulberry32(sc.guide.seed);
    for (let i = 0; i < sc.guide.steps; i++) {
      const options = available(container);
      if (!options.length) break;
      await play(`${pick(rng, options)}:${Math.floor(rng() * 1000)}`);
    }
  }
  const finalHtml = container.innerHTML;
  cleanup();
  document.querySelectorAll('a[download]').forEach((a) => a.remove());
  return { steps, finalHtml };
}

const ALL3 = ['l1', 'l2', 'l3'];
const DIRECTED: Array<Partial<Scenario>> = [
  { lessons: LESSON_SETS[2], completed: ALL3, quiz: 'ok', questions: QUESTION_SETS[1], submit: 'ok', submitPassed: false, score: 50,
    actions: ['test:0', 'answerAll:1', 'submit:0', 'retry:0', 'answerAll:2', 'submit:0', 'lesson:0'] },
  { lessons: LESSON_SETS[2], completed: ALL3, quiz: 'ok', questions: QUESTION_SETS[2], submit: 'ok', submitPassed: true, score: 66.6667, cert: 'ok',
    actions: ['test:0', 'answer:3', 'submit:0', 'answerAll:5', 'submit:0', 'cert:0'] },
  { lessons: LESSON_SETS[2], completed: ALL3, attempts: [{ passed: true, score: 88.4 }], cert: 'failMsg', actions: ['test:0', 'cert:0'] },
  { lessons: LESSON_SETS[2], completed: ALL3, attempts: [{ passed: true, score: 88.4 }], cert: 'pending', actions: ['test:0', 'cert:0'] },
  { lessons: LESSON_SETS[2], completed: ALL3, attempts: [{ passed: true, score: 88.4 }], cert: 'reject', actions: ['test:0', 'cert:0'] },
  { lessons: LESSON_SETS[2], completed: ALL3, quiz: 'failMsg', actions: ['test:0', 'start:0', 'test:0'] },
  { lessons: LESSON_SETS[2], completed: ALL3, quiz: 'pending', actions: ['test:0'] },
  { lessons: LESSON_SETS[2], completed: ALL3, quiz: 'ok', submit: 'pending', actions: ['test:0', 'answerAll:0', 'submit:0'] },
  { lessons: LESSON_SETS[2], completed: ALL3, quiz: 'ok', submit: 'reject', actions: ['test:0', 'answerAll:0', 'submit:0'] },
  { lessons: LESSON_SETS[2], completed: ALL3, quiz: 'ok', submit: 'failBare', actions: ['test:0', 'answer:0', 'submit:0', 'answerAll:0', 'submit:0'] },
  { lessons: LESSON_SETS[2], completed: ['l1'], query: 'l2', progressPost: 'ok',
    actions: ['toggle:0', 'progress:0', 'progress:1', 'progress:5', 'ended:0', 'perror:0', 'mark:0', 'lesson:2'] },
  { lessons: LESSON_SETS[2], completed: ['l1'], query: 'l2', progressPost: 'ok', actions: ['toggle:0', 'progress:10', 'lesson:2'] },
  { lessons: LESSON_SETS[2], completed: ALL3, query: 'l2', quiz: 'ok', actions: ['toggle:0', 'ended:0', 'toggle:0', 'ended:0'] },
  { lessons: LESSON_SETS[1], completed: ['a1'], query: 'a1', quiz: 'ok', actions: ['toggle:0', 'ended:0', 'answerAll:0', 'toggle:0', 'ended:0'] },
  { lessons: LESSON_SETS[1], completed: [], query: 'a1', progressPost: 'failBare', actions: ['toggle:0', 'progress:1', 'ended:0', 'mark:0'] },
  { lessons: LESSON_SETS[1], completed: [], user: false, progressPost: 'ok', actions: ['toggle:0', 'progress:3', 'mark:0'] },
  { lessons: LESSON_SETS[0], course: 'ok', actions: ['mark:0', 'test:0', 'back:0'] },
  { course: 'pending', actions: ['back:0'] },
  { course: 'failMsg', actions: ['back:1'] },
  { course: 'reject', actions: [] },
  { lessons: LESSON_SETS[3], completed: ['m1'], progress: 'reject', actions: [] },
  { lessons: LESSON_SETS[3], completed: ['m1', 'm2'], progress: 'failBare', query: 'm3', actions: ['lesson:0', 'lesson:3', 'back:0'] },
  { lessons: LESSON_SETS[3], completed: ['m1', 'm3'], query: 'm1', actions: ['lesson:1', 'lesson:2', 'lesson:3', 'test:0'] },
];

const BASE: Scenario = {
  lessons: LESSON_SETS[2], completed: [], attempts: [], query: '', user: true, course: 'ok', progress: 'ok', progressPost: 'ok',
  quiz: 'ok', questions: QUESTION_SETS[1], submit: 'ok', submitPassed: true, score: 100, cert: 'ok', actions: [],
};

let consoleSpy: ReturnType<typeof vi.spyOn>;
let anchorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  anchorSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  Object.assign(window.URL, { createObjectURL: vi.fn(() => 'blob:cert'), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  consoleSpy.mockRestore();
  anchorSpy.mockRestore();
});

describe('caracterização do CoursePlayer', () => {
  it('cenários dirigidos: passos completos', async () => {
    const out: unknown[] = [];
    for (const partial of DIRECTED) {
      const { steps, finalHtml } = await runScenario({ ...BASE, ...partial });
      out.push({ steps, final: digest(finalHtml) });
    }
    expect(out).toMatchSnapshot();
  }, 60_000);

  it('alguns HTML completos', async () => {
    const htmls: string[] = [];
    for (const i of [0, 1, 10, 16]) {
      htmls.push((await runScenario({ ...BASE, ...DIRECTED[i] })).finalHtml);
    }
    expect(htmls).toMatchSnapshot();
  }, 60_000);

  it('cenários semeados: resumo por cenário', async () => {
    const rows: string[] = [];
    for (let seed = 1; seed <= 45; seed++) {
      const sc = makeScenario(seed);
      const { steps } = await runScenario(sc);
      rows.push(`${seed}: ${digest(JSON.stringify(steps))} ${steps.map((s) => `${String(s.action).split(':')[0]}=${s.result || '-'}`).join(',')}`);
    }
    expect(rows).toMatchSnapshot();
  }, 120_000);

  it('cenários semeados com tudo concluído (foco no teste final)', async () => {
    const rows: string[] = [];
    for (let seed = 101; seed <= 125; seed++) {
      const base = makeScenario(seed);
      const lessons = LESSON_SETS[1 + (seed % 3)];
      const sc = { ...base, lessons, completed: lessons.map((l) => l._id), course: 'ok' as Kind, progress: 'ok' as Kind, actions: ['test:0'] };
      const { steps } = await runScenario(sc);
      rows.push(`${seed}: ${digest(JSON.stringify(steps))} ${steps.map((s) => `${String(s.action).split(':')[0]}=${s.result || '-'}`).join(',')}`);
    }
    expect(rows).toMatchSnapshot();
  }, 120_000);
});
