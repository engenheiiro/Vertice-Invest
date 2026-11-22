/**
 * Catálogo da Academy.
 *
 * O que os testes travam:
 *  - carregando → spinner; erro HTTP e erro de rede viram mensagens distintas;
 *  - abrir uma trilha busca as aulas dela e troca o cabeçalho pelo da trilha;
 *  - a área está em manutenção: as aulas aparecem BLOQUEADAS e nem clique nem
 *    teclado levam ao player;
 *  - "Voltar ao Catálogo" limpa a trilha e o upgrade leva à assinatura.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  api: vi.fn(),
  plan: 'PRO' as string | undefined,
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.plan ? { plan: mocks.plan } : null }) }));
vi.mock('../services/auth', () => ({ authService: { api: mocks.api } }));
vi.mock('../components/dashboard/Header', () => ({ Header: () => null }));
vi.mock('../components/Academy/CourseCard', () => ({
  CourseCard: ({ course, userPlanLevel, onSelect, onUpgrade }: {
    course: { _id: string; title: string };
    userPlanLevel: number;
    onSelect: (id: string) => void;
    onUpgrade: () => void;
  }) => (
    <div data-testid={`card-${course._id}`} data-level={userPlanLevel}>
      <button type="button" onClick={() => onSelect(course._id)}>Abrir {course.title}</button>
      <button type="button" onClick={onUpgrade}>Upgrade {course.title}</button>
    </div>
  ),
}));

import { Courses } from './Courses';

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const fail = () => ({ ok: false, json: async () => ({}) });

const COURSES = [
  { _id: 'c1', title: 'Fundamentos', description: 'Do zero ao primeiro aporte', thumbnail: '/assets/academy/c1.png' },
  { _id: 'c2', title: 'Macro', description: 'Juros e inflação' },
];
const LESSONS = [
  { _id: 'l1', title: 'O que é uma ação', description: 'Sócio de empresa', duration: 600 },
  { _id: 'l2', title: 'Dividendos', description: 'Renda passiva', duration: 125, thumbnail: '/x.png' },
];

const rotear = (url: string) => {
  if (url === '/api/academy/courses') return Promise.resolve(ok(COURSES));
  if (url === '/api/academy/courses/c1') return Promise.resolve(ok({ course: COURSES[0], lessons: LESSONS }));
  return Promise.resolve(fail());
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.plan = 'PRO';
  mocks.api.mockImplementation(rotear);
});

describe('Courses — carregamento', () => {
  it('mostra o spinner enquanto a lista não chega', () => {
    mocks.api.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<Courses />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('Vértice Academy')).not.toBeInTheDocument();
  });

  it('lista as trilhas com o nível do plano do usuário', async () => {
    render(<Courses />);
    expect(await screen.findByTestId('card-c1')).toHaveAttribute('data-level', '2');
    expect(screen.getByTestId('card-c2')).toBeInTheDocument();
    expect(screen.getByText('Vértice Academy')).toBeInTheDocument();
    expect(screen.getByText('Área em Manutenção')).toBeInTheDocument();
  });

  it('sem usuário, o nível cai para GUEST (0)', async () => {
    mocks.plan = undefined;
    render(<Courses />);
    expect(await screen.findByTestId('card-c1')).toHaveAttribute('data-level', '0');
  });

  it('resposta HTTP de erro mostra "Erro ao carregar cursos."', async () => {
    mocks.api.mockResolvedValue(fail());
    render(<Courses />);
    expect(await screen.findByText('Erro ao carregar cursos.')).toBeInTheDocument();
  });

  it('falha de rede mostra "Erro de conexão."', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.api.mockRejectedValue(new Error('offline'));
    render(<Courses />);
    expect(await screen.findByText('Erro de conexão.')).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('Courses — trilha selecionada', () => {
  it('abrir a trilha busca as aulas e mostra o cabeçalho dela', async () => {
    render(<Courses />);
    fireEvent.click(await screen.findByText('Abrir Fundamentos'));

    expect(await screen.findByText('O que é uma ação')).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith('/api/academy/courses/c1');
    expect(screen.getByRole('heading', { level: 1, name: 'Fundamentos' })).toBeInTheDocument();
    expect(screen.getByText('Do zero ao primeiro aporte')).toBeInTheDocument();
    expect(screen.getByText('2 Aulas Disponíveis')).toBeInTheDocument();
    expect(screen.getByText('10 min')).toBeInTheDocument();
    expect(screen.getByText('2 min')).toBeInTheDocument();
    expect(screen.getAllByText('Bloqueado')).toHaveLength(2);
  });

  it('aula bloqueada não abre o player nem por clique nem por teclado', async () => {
    render(<Courses />);
    fireEvent.click(await screen.findByText('Abrir Fundamentos'));
    await screen.findByText('Dividendos');

    const cards = screen.getAllByRole('button', { name: /Dividendos|O que é uma ação/ });
    fireEvent.click(cards[0]);
    fireEvent.keyDown(cards[0], { key: 'Enter' });
    fireEvent.keyDown(cards[1], { key: ' ' });
    expect(cards[0]).toHaveAttribute('aria-disabled', 'true');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('"Voltar ao Catálogo" limpa a trilha e as aulas', async () => {
    render(<Courses />);
    fireEvent.click(await screen.findByText('Abrir Fundamentos'));
    await screen.findByText('Dividendos');

    fireEvent.click(screen.getByText('Voltar ao Catálogo'));
    expect(screen.queryByText('Dividendos')).not.toBeInTheDocument();
    expect(screen.getByText('Trilha de Formação Inicial')).toBeInTheDocument();
    expect(screen.getByText('Domine o mercado com a inteligência Vértice.')).toBeInTheDocument();
  });

  it('trilha cuja busca falha fica sem aulas (0 disponíveis), sem quebrar', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.api.mockImplementation((url: string) =>
      url === '/api/academy/courses' ? Promise.resolve(ok(COURSES)) : Promise.reject(new Error('caiu')));
    render(<Courses />);
    fireEvent.click(await screen.findByText('Abrir Macro'));
    expect(await screen.findByText('0 Aulas Disponíveis')).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockRestore();
  });

  it('upgrade leva à página de assinatura', async () => {
    render(<Courses />);
    fireEvent.click(await screen.findByText('Upgrade Macro'));
    expect(mocks.navigate).toHaveBeenCalledWith('/subscription');
  });

  it('"Explorar Trilhas" rola até o catálogo', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Courses />);
    fireEvent.click(await screen.findByText('Explorar Trilhas'));
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth' });
    scroll.mockRestore();
  });

  it('a tela da trilha não tem violações de acessibilidade', async () => {
    const { container } = render(<Courses />);
    fireEvent.click(await screen.findByText('Abrir Fundamentos'));
    await screen.findByText('Dividendos');
    expect(await axe(container)).toHaveNoViolations();
  });
});
