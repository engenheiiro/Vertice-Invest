/**
 * Landing pública: faixa de cotações, planos e navegação para conta.
 *
 * O que os testes travam:
 *  - a faixa de mercado mostra o esqueleto até a resposta e depois as variações
 *    com sinal (variação inválida vira 0,00%, nunca NaN);
 *  - resposta não-ok, erro de rede ou lista vazia mostram "indisponíveis" —
 *    a página continua de pé;
 *  - a busca vai sem cache e é abortada ao desmontar;
 *  - os CTAs levam a /register, /login e /pricing; a navbar reage ao scroll.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { axe } from 'jest-axe';
import { Landing } from './Landing';

vi.mock('../components/seo/PageMeta', () => ({ PageMeta: () => null }));

const fetchMock = vi.fn();

const okResponse = (body: unknown) => ({ ok: true, json: async () => body });

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/register" element={<div>Tela de cadastro</div>} />
        <Route path="/login" element={<div>Tela de login</div>} />
        <Route path="/pricing" element={<div>Tela de planos</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('faixa de mercado', () => {
  it('mostra as variações com sinal e cor depois da resposta', async () => {
    fetchMock.mockResolvedValue(okResponse({
      tickers: [
        { ticker: 'PETR4', change: 1.234 },
        { ticker: 'VALE3', change: -0.5 },
        { ticker: 'BTC', change: 'abc' },
      ],
    }));
    renderPage();
    // Duas cópias da faixa (loop contínuo); a segunda é aria-hidden.
    expect(await screen.findAllByText('PETR4')).toHaveLength(2);
    expect(screen.getAllByText('+1.23%')).toHaveLength(2);
    expect(screen.getAllByText('-0.50%')[0]).toHaveClass('text-red-400/80');
    expect(screen.getAllByText('+0.00%')).toHaveLength(2);
    expect(screen.queryByText(/temporariamente indisponíveis/)).not.toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/market\/landing$/);
    expect(init).toMatchObject({ cache: 'no-store' });
  });

  it('lista vazia mostra o aviso de indisponível', async () => {
    fetchMock.mockResolvedValue(okResponse({ tickers: [] }));
    renderPage();
    expect(await screen.findByText('Dados de mercado temporariamente indisponíveis')).toBeInTheDocument();
  });

  it('resposta não-ok mantém a página e mostra o aviso', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    renderPage();
    expect(await screen.findByText('Dados de mercado temporariamente indisponíveis')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('O Fim da Incerteza Financeira');
  });

  it('erro de rede é silencioso: aviso de indisponível, sem quebrar', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByText('Dados de mercado temporariamente indisponíveis')).toBeInTheDocument();
  });

  it('desmontar no meio da busca aborta a requisição', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});

describe('conteúdo e navegação', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(okResponse({ tickers: [{ ticker: 'ITUB4', change: 0.3 }] }));
  });

  it('mostra seções, estatísticas e os três planos pagos', async () => {
    const { container } = renderPage();
    await screen.findAllByText('ITUB4');
    expect(screen.getByRole('heading', { name: 'Um plano para cada nível de investidor' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quem usa, recomenda' })).toBeInTheDocument();
    expect(screen.getByText('Bolsas cobertas')).toBeInTheDocument();
    expect(screen.getByText('12.000+')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Conhecer plano/ }).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByAltText(/Dashboard Vértice/)).toHaveAttribute('fetchpriority', 'high');

    expect(await axe(container)).toHaveNoViolations();
  });

  it('"Criar Conta Grátis" leva ao cadastro', async () => {
    renderPage();
    await screen.findAllByText('ITUB4');
    fireEvent.click(screen.getByRole('link', { name: 'Criar Conta Grátis' }));
    expect(screen.getByText('Tela de cadastro')).toBeInTheDocument();
  });

  it('"Acessar Conta" leva ao login', async () => {
    renderPage();
    await screen.findAllByText('ITUB4');
    fireEvent.click(screen.getByRole('link', { name: 'Acessar Conta' }));
    expect(screen.getByText('Tela de login')).toBeInTheDocument();
  });

  it('"Comparar assinaturas" leva aos planos', async () => {
    renderPage();
    await screen.findAllByText('ITUB4');
    fireEvent.click(screen.getByRole('link', { name: 'Comparar assinaturas' }));
    expect(screen.getByText('Tela de planos')).toBeInTheDocument();
  });

  it('a navbar compacta depois de rolar a página', async () => {
    renderPage();
    await screen.findAllByText('ITUB4');
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(nav).toHaveClass('py-4');
    Object.defineProperty(window, 'scrollY', { value: 200, configurable: true });
    fireEvent.scroll(window);
    expect(nav).toHaveClass('py-3');
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    fireEvent.scroll(window);
    expect(nav).toHaveClass('py-4');
  });
});
