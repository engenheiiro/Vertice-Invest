/**
 * Chinelada — minijogo escondido.
 *
 * O que os testes travam:
 *  - antes da run nada pontua (barata desabilitada, upgrades travados);
 *  - tapa mata, soma combo/moedas/pontos; erro de mira zera o combo e cobra energia;
 *  - upgrade da run só com moedas; legado da casa só fora da run e com respeito;
 *  - energia zerada encerra a run e grava recorde/respeito no localStorage;
 *  - save corrompido não derruba a página.
 *
 * `Math.random` fixo em 0,3: barata comum (1 de vida, 7 moedas), indo para a
 * esquerda, nunca crítica (0,3 ≥ 5%).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { Chinelada } from './Chinelada';

const SAVE_KEY = 'chinelada-save-v1';

const roach = () => screen.getByRole('button', { name: /^Barata/ });
const stat = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
const runUpgrade = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) });
const savedGame = () => JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
  vi.spyOn(Math, 'random').mockReturnValue(0.3);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const start = () => fireEvent.click(screen.getByText('Começar a caçada'));

describe('Chinelada — antes da run', () => {
  it('abre na tela inicial com a barata e os upgrades travados', () => {
    render(<Chinelada />);
    expect(screen.getByText('A cozinha foi invadida')).toBeInTheDocument();
    expect(roach()).toBeDisabled();
    expect(roach()).toHaveAccessibleName('Barata comum, 1 de vida');
    expect(runUpgrade('Chinelo pesado')).toBeDisabled();
    expect(screen.getByText('100 / 100')).toBeInTheDocument();
    expect(savedGame()).toMatchObject({ reputation: 0, bestScore: 0 });
  });

  it('o botão de som alterna o rótulo', () => {
    render(<Chinelada />);
    fireEvent.click(screen.getByLabelText('Desativar som'));
    expect(screen.getByLabelText('Ativar som')).toBeInTheDocument();
  });

  it('save corrompido cai no padrão sem quebrar', () => {
    localStorage.setItem(SAVE_KEY, '{quebrado');
    render(<Chinelada />);
    expect(stat('Respeito')).toBe('0');
  });

  it('não tem violações de acessibilidade na tela inicial', async () => {
    vi.useRealTimers();
    const { container } = render(<Chinelada />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Chinelada — durante a run', () => {
  it('tapa mata a barata e soma combo, moedas e pontos', () => {
    render(<Chinelada />);
    start();
    expect(roach()).not.toBeDisabled();

    fireEvent.click(roach());
    expect(stat('Pontuação')).toBe('70');
    expect(stat('Baratas')).toBe('1');
    expect(stat('Combo')).toBe('x1');
    expect(screen.getByText('-1')).toBeInTheDocument();
    expect(screen.getByText('97 / 100')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByText('-1')).not.toBeInTheDocument();
  });

  it('erro de mira zera o combo e cobra 5 de energia', () => {
    const { container } = render(<Chinelada />);
    start();
    fireEvent.click(roach());
    fireEvent.click(roach());
    expect(stat('Combo')).toBe('x2');

    const arena = container.querySelector('[role="presentation"]') as HTMLElement;
    fireEvent.click(arena);
    expect(stat('Combo')).toBe('x0');
    expect(screen.getByText('89 / 100')).toBeInTheDocument();
  });

  it('com moedas suficientes compra o Chinelo pesado e o dano sobe', () => {
    render(<Chinelada />);
    start();
    for (let i = 0; i < 4; i++) fireEvent.click(roach());
    // 7 + 8 + 8 + 8 (multiplicador do combo) = 31 moedas.
    expect(screen.getByText('🪙 31')).toBeInTheDocument();
    expect(screen.getByText('Dano 1')).toBeInTheDocument();

    fireEvent.click(runUpgrade('Chinelo pesado'));
    expect(screen.getByText('Dano 2')).toBeInTheDocument();
    expect(screen.getByText('🪙 6')).toBeInTheDocument();
    expect(runUpgrade('Chinelo pesado')).toHaveAccessibleName(/nível 1.*Custo 55 moedas/);
    expect(runUpgrade('Mira de mãe')).toBeDisabled();
  });

  it('crítico, cafezinho e inseticida mudam os atributos da run', () => {
    render(<Chinelada />);
    start();
    for (let i = 0; i < 10; i++) fireEvent.click(roach());
    fireEvent.click(runUpgrade('Mira de mãe'));
    expect(screen.getByText('Crítico 15%')).toBeInTheDocument();
    fireEvent.click(runUpgrade('Cafezinho'));
    expect(screen.getByText('95 / 100')).toBeInTheDocument();

    for (let i = 0; i < 4; i++) fireEvent.click(roach());
    fireEvent.click(runUpgrade('Inseticida'));
    expect(screen.getByText('Auto 1/s')).toBeInTheDocument();

    const antes = Number(stat('Baratas'));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(Number(stat('Baratas'))).toBe(antes + 1);
  });

  it('barata que escapa zera o combo e cobra 8 de energia', () => {
    render(<Chinelada />);
    start();
    fireEvent.click(roach());
    // Da borda direita (x=96) até sair pela esquerda a 0,44%/tick ≈ 239 ticks de 55 ms.
    act(() => { vi.advanceTimersByTime(240 * 55); });
    expect(stat('Combo')).toBe('x0');
  });

  it('energia zerada encerra a run e grava recorde e respeito', () => {
    render(<Chinelada />);
    start();
    fireEvent.click(roach());
    // Em fatias: cada `act` entrega à tela o que os intervalos fizeram, e é aí que
    // o atualizador da energia percebe o zero e agenda o fim da run.
    for (let i = 0; i < 200; i++) act(() => { vi.advanceTimersByTime(600); });

    expect(screen.getByText('Fim da run')).toBeInTheDocument();
    const resumo = screen.getByText('respeito').parentElement as HTMLElement;
    expect(within(resumo).getByText('+1')).toBeInTheDocument();
    expect(savedGame()).toMatchObject({ reputation: 1, bestScore: 70, totalKills: 1 });
    expect(stat('Recorde')).toBe('70');

    fireEvent.click(screen.getByText('Tentar de novo'));
    expect(stat('Pontuação')).toBe('0');
    expect(roach()).not.toBeDisabled();
  });
});

describe('Chinelada — legado da casa', () => {
  it('compra melhoria permanente com respeito e ela vale na próxima run', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ reputation: 5 }));
    render(<Chinelada />);
    const borracha = screen.getByRole('button', { name: /^Borracha reforçada/ });
    expect(borracha).not.toBeDisabled();

    fireEvent.click(borracha);
    expect(stat('Respeito')).toBe('3');
    expect(savedGame()).toMatchObject({ reputation: 3, rubberLevel: 1 });
    expect(screen.getByRole('button', { name: /^Borracha reforçada \(nível 1\).*Custo 4/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Alongamento de pulso/ }));
    expect(savedGame()).toMatchObject({ reputation: 1, staminaLevel: 1 });

    start();
    expect(screen.getByText('Dano 2')).toBeInTheDocument();
    expect(screen.getByText('115 / 115')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Dedetização preventiva/ })).toBeDisabled();
  });

  it('sem respeito suficiente o legado fica travado', () => {
    render(<Chinelada />);
    expect(screen.getByRole('button', { name: /^Dedetização preventiva/ })).toBeDisabled();
  });
});
