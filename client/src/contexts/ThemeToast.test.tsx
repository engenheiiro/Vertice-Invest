import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ThemeProvider, ThemeScope, useTheme } from './ThemeContext';
import { ToastProvider, useToast } from './ToastContext';

const THEME_KEY = 'vertice-theme-v2';

describe('ThemeContext', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute('data-theme');
    });

    const comEscopo = (n: number) => ({ children }: { children: ReactNode }) => (
        <ThemeProvider>
            {Array.from({ length: n }, (_, i) => <ThemeScope key={i} />)}
            {children}
        </ThemeProvider>
    );

    it('padrão é escuro e a preferência é gravada', () => {
        const { result } = renderHook(() => useTheme(), { wrapper: comEscopo(1) });
        expect(result.current.theme).toBe('dark');
        expect(result.current.preference).toBe('dark');
        expect(localStorage.getItem(THEME_KEY)).toBe('dark');
        expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    });

    it('preferência clara salva vale dentro da área logada e pinta o documento', () => {
        localStorage.setItem(THEME_KEY, 'light');
        const { result } = renderHook(() => useTheme(), { wrapper: comEscopo(1) });
        expect(result.current.theme).toBe('light');
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('fora de qualquer ThemeScope o tema efetivo é sempre escuro, mas a preferência continua clara', () => {
        localStorage.setItem(THEME_KEY, 'light');
        const { result } = renderHook(() => useTheme(), { wrapper: comEscopo(0) });
        expect(result.current.theme).toBe('dark');
        expect(result.current.preference).toBe('light');
        expect(localStorage.getItem(THEME_KEY)).toBe('light');
    });

    it('toggle alterna e persiste a preferência', () => {
        const { result } = renderHook(() => useTheme(), { wrapper: comEscopo(1) });
        act(() => result.current.toggleTheme());
        expect(result.current.theme).toBe('light');
        expect(localStorage.getItem(THEME_KEY)).toBe('light');
        act(() => result.current.toggleTheme());
        expect(result.current.theme).toBe('dark');
        expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    });

    it('desmontar o último escopo devolve o documento ao escuro (logout)', () => {
        localStorage.setItem(THEME_KEY, 'light');
        const Tela = ({ logado }: { logado: boolean }) => (
            <ThemeProvider>{logado && <ThemeScope />}{logado && <ThemeScope />}</ThemeProvider>
        );
        const { rerender } = render(<Tela logado />);
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
        rerender(<Tela logado={false} />);
        expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    });

    it('storage indisponível não quebra: cai no escuro', () => {
        const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('privado'); });
        const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cheio'); });
        const { result } = renderHook(() => useTheme(), { wrapper: comEscopo(1) });
        expect(result.current.theme).toBe('dark');
        act(() => result.current.toggleTheme());
        expect(result.current.theme).toBe('light');
        get.mockRestore();
        set.mockRestore();
    });

    it('useTheme sem provider usa o padrão escuro e toggle inerte', () => {
        const { result } = renderHook(() => useTheme());
        expect(result.current.theme).toBe('dark');
        expect(() => result.current.toggleTheme()).not.toThrow();
    });
});

describe('ToastContext', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const Disparador = () => {
        const { addToast } = useToast();
        return (
            <>
                <button onClick={() => addToast('Salvo', 'success')}>ok</button>
                <button onClick={() => addToast('Falhou', 'error')}>erro</button>
                <button onClick={() => addToast('Aviso')}>info</button>
            </>
        );
    };

    const montar = () => render(<ToastProvider><Disparador /></ToastProvider>);

    it('mostra o toast com a cor do tipo; sem tipo é info', () => {
        montar();
        fireEvent.click(screen.getByText('ok'));
        fireEvent.click(screen.getByText('erro'));
        fireEvent.click(screen.getByText('info'));
        expect(screen.getByText('Salvo').parentElement?.className).toContain('text-emerald-400');
        expect(screen.getByText('Falhou').parentElement?.className).toContain('text-red-400');
        expect(screen.getByText('Aviso').parentElement?.className).toContain('text-blue-400');
    });

    it('some sozinho depois de 4s', () => {
        montar();
        fireEvent.click(screen.getByText('ok'));
        act(() => { vi.advanceTimersByTime(3999); });
        expect(screen.queryByText('Salvo')).not.toBeNull();
        act(() => { vi.advanceTimersByTime(1); });
        expect(screen.queryByText('Salvo')).toBeNull();
    });

    it('o X fecha só aquele toast', () => {
        montar();
        fireEvent.click(screen.getByText('ok'));
        fireEvent.click(screen.getByText('erro'));
        const fechar = screen.getByText('Salvo').parentElement?.querySelector('button') as HTMLButtonElement;
        fireEvent.click(fechar);
        expect(screen.queryByText('Salvo')).toBeNull();
        expect(screen.queryByText('Falhou')).not.toBeNull();
    });

    it('useToast fora do provider lança erro', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => renderHook(() => useToast())).toThrow('useToast must be used within a ToastProvider');
    });
});
