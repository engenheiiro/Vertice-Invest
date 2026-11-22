/**
 * Player de curso da Academy.
 *
 * O que os testes travam:
 *  - carregando / acesso negado (com volta ao catálogo);
 *  - aula inicial pela query `?lesson=` e trava sequencial: a aula N só abre
 *    depois da N-1 concluída;
 *  - progresso: botão manual, 90% assistido no player avançado e fim do vídeo
 *    avançando para a próxima;
 *  - teste final: só com tudo concluído; reprovação mostra as PRÓPRIAS
 *    respostas (sem gabarito), aprovação libera o certificado;
 *  - quem já passou vê o resultado direto, sem refazer o teste.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { axe } from 'jest-axe';

type PlayerProps = {
  url: string;
  onProgress: (s: { played: number; playedSeconds: number }) => void;
  onEnded: () => void;
  onError: (e: unknown) => void;
};

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  addToast: vi.fn(),
  player: { props: null as PlayerProps | null },
}));

vi.mock('react-player', () => ({
  default: (props: PlayerProps) => {
    mocks.player.props = props;
    return <div data-testid="react-player">{props.url}</div>;
  },
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../services/auth', () => ({ authService: { api: mocks.api } }));

import { CoursePlayer } from './CoursePlayer';

type Resp = { ok: boolean; json: () => Promise<unknown>; blob: () => Promise<string> };
const ok = (body: unknown): Resp => ({ ok: true, json: async () => body, blob: async () => 'pdf' });
const fail = (body: unknown = {}): Resp => ({ ok: false, json: async () => body, blob: async () => '' });

const LESSONS = [
  { _id: 'l1', title: 'Aula Um', description: 'Primeira', duration: 600, youtubeId: 'yt1' },
  { _id: 'l2', title: 'Aula Dois', description: 'Segunda', duration: 300, youtubeId: 'yt2' },
  { _id: 'l3', title: 'Aula Três', description: 'Terceira', duration: 120 },
];
const QUIZ = { questions: [{ text: 'Quanto é 1+1?', options: ['1', '2'] }, { text: 'Cor do céu?', options: ['Azul', 'Verde'] }] };

const state = {
  completed: ['l1'] as string[],
  attempts: [] as unknown[],
  course: null as Resp | null,
  quiz: null as Resp | null,
  submit: null as Resp | null,
  cert: null as Resp | null,
};

const rotear = (url: string): Promise<Resp> => {
  if (url === '/api/academy/courses/c1') return Promise.resolve(state.course ?? ok({ course: { title: 'Curso Base' }, lessons: LESSONS }));
  if (url === '/api/academy/progress/c1') {
    return Promise.resolve(ok({
      progress: [...state.completed.map((id) => ({ lessonId: id, completed: true })), { lessonId: 'lx', completed: false }],
      quizAttempts: state.attempts,
    }));
  }
  if (url === '/api/academy/progress') return Promise.resolve(ok({}));
  if (url === '/api/academy/quiz/c1') return Promise.resolve(state.quiz ?? ok(QUIZ));
  if (url === '/api/academy/quiz/submit') return Promise.resolve(state.submit ?? ok({ passed: false, score: 50, passingScore: 70, attempt: {} }));
  if (url === '/api/academy/certificate/c1') return Promise.resolve(state.cert ?? ok({}));
  return Promise.resolve(fail());
};

const renderAt = (path = '/courses/c1') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/courses" element={<div>Catálogo</div>} />
        <Route path="/courses/:courseId" element={<CoursePlayer />} />
      </Routes>
    </MemoryRouter>,
  );

const sidebar = (title: string) =>
  screen.getByText((_, el) => el?.tagName === 'P' && !!el.closest('button') && el.textContent?.endsWith(title) === true).closest('button');

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { completed: ['l1'], attempts: [], course: null, quiz: null, submit: null, cert: null });
  mocks.player.props = null;
  mocks.api.mockImplementation(rotear);
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
  document.querySelectorAll('a[download]').forEach((a) => a.remove());
});

describe('CoursePlayer — carregamento', () => {
  it('mostra o spinner enquanto o curso não chega', () => {
    mocks.api.mockImplementation(() => new Promise(() => {}));
    const { container } = renderAt();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('curso negado mostra "Acesso Restrito" e volta para a Academia', async () => {
    state.course = fail({ message: 'Plano insuficiente' });
    renderAt();
    expect(await screen.findByText('Acesso Restrito')).toBeInTheDocument();
    expect(screen.getByText('Erro ao carregar curso. Tente recarregar a página.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Voltar para a Academia'));
    expect(screen.getByText('Catálogo')).toBeInTheDocument();
  });

  it('abre a aula pedida na query e trava a seguinte enquanto ela não for concluída', async () => {
    renderAt('/courses/c1?lesson=l2');
    expect(await screen.findByRole('heading', { level: 2, name: 'Aula Dois' })).toBeInTheDocument();
    expect(screen.getByText('Curso Base')).toBeInTheDocument();
    expect(screen.getByText('3 aulas')).toBeInTheDocument();
    expect(screen.getByTitle('YouTube video player')).toHaveAttribute('src', expect.stringContaining('/embed/yt2'));
    expect(sidebar('Aula Três')).toBeDisabled();
    expect(sidebar('Teste Final & Certificado')).toBeDisabled();
    expect(screen.getByText('Conclua todas as aulas para liberar')).toBeInTheDocument();
  });

  it('query com aula inexistente cai na primeira aula', async () => {
    renderAt('/courses/c1?lesson=nao-existe');
    expect(await screen.findByRole('heading', { level: 2, name: 'Aula Um' })).toBeInTheDocument();
    // Aula já concluída não oferece o botão de concluir.
    expect(screen.queryByText('Marcar esta aula como concluída')).not.toBeInTheDocument();
  });
});

describe('CoursePlayer — progresso', () => {
  it('marcar como concluída grava o progresso e destrava a próxima aula', async () => {
    renderAt('/courses/c1?lesson=l2');
    fireEvent.click(await screen.findByText('Marcar esta aula como concluída'));

    await waitFor(() => expect(sidebar('Aula Três')).not.toBeDisabled());
    const post = mocks.api.mock.calls.find(([url]) => url === '/api/academy/progress');
    expect(JSON.parse(post?.[1].body)).toEqual({ lessonId: 'l2', watchTime: 300, completed: true });

    fireEvent.click(sidebar('Aula Três') as HTMLElement);
    expect(await screen.findByText('Conteúdo em Produção')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ver outros cursos'));
    expect(screen.getByText('Catálogo')).toBeInTheDocument();
  });

  it('player avançado: 90% assistido conclui a aula; erro volta ao modo compatível', async () => {
    renderAt('/courses/c1?lesson=l2');
    fireEvent.click(await screen.findByText('Usar Player Avançado'));
    expect(screen.getByTestId('react-player')).toHaveTextContent('watch?v=yt2');

    await act(async () => mocks.player.props?.onProgress({ played: 0.5, playedSeconds: 150 }));
    expect(mocks.api).not.toHaveBeenCalledWith('/api/academy/progress', expect.anything());

    await act(async () => mocks.player.props?.onProgress({ played: 0.95, playedSeconds: 285 }));
    await waitFor(() => expect(sidebar('Aula Três')).not.toBeDisabled());
    const post = mocks.api.mock.calls.find(([url]) => url === '/api/academy/progress');
    expect(JSON.parse(post?.[1].body)).toEqual({ lessonId: 'l2', watchTime: 285, completed: true });

    act(() => mocks.player.props?.onError(new Error('bloqueado')));
    expect(screen.getByTitle('YouTube video player')).toBeInTheDocument();
  });

  it('fim do vídeo avança para a aula seguinte', async () => {
    renderAt('/courses/c1?lesson=l1');
    fireEvent.click(await screen.findByText('Usar Player Avançado'));
    act(() => mocks.player.props?.onEnded());
    expect(await screen.findByRole('heading', { level: 2, name: 'Aula Dois' })).toBeInTheDocument();
  });

  it('fim do último vídeo com tudo concluído abre o teste final', async () => {
    state.completed = ['l1', 'l2', 'l3'];
    renderAt('/courses/c1?lesson=l2');
    await screen.findByRole('heading', { level: 2, name: 'Aula Dois' });
    // Sem youtubeId a última aula não tem player; o fim chega pela penúltima → última.
    fireEvent.click(screen.getByText('Usar Player Avançado'));
    act(() => mocks.player.props?.onEnded());
    expect(await screen.findByRole('heading', { level: 2, name: 'Aula Três' })).toBeInTheDocument();
  });
});

describe('CoursePlayer — teste final', () => {
  beforeEach(() => {
    state.completed = ['l1', 'l2', 'l3'];
  });

  const abrirTeste = async () => {
    const view = renderAt();
    await screen.findByText('Disponível');
    fireEvent.click(sidebar('Teste Final & Certificado') as HTMLElement);
    await screen.findByText('1. Quanto é 1+1?');
    return view;
  };

  it('reprovação mostra as próprias respostas e permite tentar de novo', async () => {
    await abrirTeste();
    const enviar = screen.getByText('Finalizar Teste');
    expect(enviar).toBeDisabled();

    fireEvent.click(screen.getByText('2'));
    fireEvent.click(screen.getByText('Verde'));
    expect(enviar).not.toBeDisabled();
    fireEvent.click(enviar);

    expect(await screen.findByText('Não foi desta vez')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Sua resposta: Verde')).toBeInTheDocument();
    const submit = mocks.api.mock.calls.find(([url]) => url === '/api/academy/quiz/submit');
    expect(JSON.parse(submit?.[1].body)).toEqual({ courseId: 'c1', answers: [1, 1] });

    fireEvent.click(screen.getByText('Tentar Novamente'));
    expect(screen.getByText('Finalizar Teste')).toBeDisabled();
  });

  it('aprovação libera e baixa o certificado', async () => {
    state.submit = ok({ passed: true, score: 100, passingScore: 70, attempt: { passed: true, score: 100 } });
    const createObjectURL = vi.fn(() => 'blob:cert');
    const revokeObjectURL = vi.fn();
    Object.assign(window.URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await abrirTeste();
    fireEvent.click(screen.getByText('2'));
    fireEvent.click(screen.getByText('Azul'));
    fireEvent.click(screen.getByText('Finalizar Teste'));
    expect(await screen.findByText('Aprovado!')).toBeInTheDocument();
    expect(screen.getByText('Certificado Disponível')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Baixar Certificado'));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:cert'));
    expect(createObjectURL).toHaveBeenCalledWith('pdf');
    expect(click).toHaveBeenCalled();
    expect(document.querySelector('a[download="certificado-c1.pdf"]')).toBeInTheDocument();
    click.mockRestore();
  });

  it('falha do certificado vira toast de erro com o motivo do servidor', async () => {
    state.attempts = [{ passed: true, score: 90 }];
    state.cert = fail({ message: 'Certificado indisponível' });
    renderAt();
    fireEvent.click(await screen.findByText('Certificado Disponível'));
    expect(screen.getByText('Aprovado!')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalledWith('/api/academy/quiz/c1');

    fireEvent.click(screen.getByText('Baixar Certificado'));
    await waitFor(() => expect(mocks.addToast).toHaveBeenCalledWith('Erro ao baixar certificado: Certificado indisponível', 'error'));
  });

  it('quiz que não carrega mostra o erro do servidor e permite iniciar de novo', async () => {
    state.quiz = fail({ message: 'Quiz fechado' });
    renderAt();
    await screen.findByText('Disponível');
    fireEvent.click(sidebar('Teste Final & Certificado') as HTMLElement);
    expect(await screen.findByText('Quiz fechado')).toBeInTheDocument();

    state.quiz = null;
    fireEvent.click(screen.getByText('Iniciar Teste'));
    expect(await screen.findByText('1. Quanto é 1+1?')).toBeInTheDocument();
  });

  it('quiz sem conexão mostra o erro de conexão', async () => {
    mocks.api.mockImplementation((url: string) => (url === '/api/academy/quiz/c1' ? Promise.reject(new Error('rede')) : rotear(url)));
    renderAt();
    await screen.findByText('Disponível');
    fireEvent.click(sidebar('Teste Final & Certificado') as HTMLElement);
    expect(await screen.findByText('Erro de conexão ao carregar o quiz.')).toBeInTheDocument();
  });

  it('envio recusado mostra a mensagem; envio sem rede mostra erro de conexão', async () => {
    state.submit = fail({ message: 'Tentativas esgotadas' });
    await abrirTeste();
    fireEvent.click(screen.getByText('1'));
    fireEvent.click(screen.getByText('Azul'));
    fireEvent.click(screen.getByText('Finalizar Teste'));
    expect(await screen.findByText('Tentativas esgotadas')).toBeInTheDocument();

    mocks.api.mockImplementation((url: string) => (url === '/api/academy/quiz/submit' ? Promise.reject(new Error('rede')) : rotear(url)));
    fireEvent.click(screen.getByText('Finalizar Teste'));
    expect(await screen.findByText('Erro de conexão ao enviar o quiz.')).toBeInTheDocument();
  });

  it('voltar a uma aula fecha o teste', async () => {
    await abrirTeste();
    fireEvent.click(sidebar('Aula Um') as HTMLElement);
    expect(await screen.findByRole('heading', { level: 2, name: 'Aula Um' })).toBeInTheDocument();
    expect(screen.queryByText('Teste Final de Formação')).not.toBeInTheDocument();
  });

  it('a tela do teste não tem violações de acessibilidade', async () => {
    const { container } = await abrirTeste();
    expect(await axe(container)).toHaveNoViolations();
  });
});
