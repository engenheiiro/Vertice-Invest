import { describe, expect, it, vi } from 'vitest';
import type { KeyboardEvent, MouseEvent } from 'react';
import { onActivateKey, onBackdropClick } from './a11yEvents';

const el = document.createElement('div');
const child = document.createElement('button');

const key = (k: string, target: EventTarget = el) => {
    const preventDefault = vi.fn();
    const event = { key: k, target, currentTarget: el, preventDefault } as unknown as KeyboardEvent<HTMLElement>;
    return { event, preventDefault };
};

describe('onActivateKey', () => {
    it('Enter dispara a ação sem cancelar o padrão', () => {
        const action = vi.fn();
        const { event, preventDefault } = key('Enter');
        onActivateKey(action)(event);
        expect(action).toHaveBeenCalledTimes(1);
        expect(preventDefault).not.toHaveBeenCalled();
    });

    it('Espaço dispara a ação e impede a rolagem da página', () => {
        const action = vi.fn();
        const { event, preventDefault } = key(' ');
        onActivateKey(action)(event);
        expect(action).toHaveBeenCalledTimes(1);
        expect(preventDefault).toHaveBeenCalledTimes(1);
    });

    it('outras teclas não disparam nada', () => {
        const action = vi.fn();
        const { event, preventDefault } = key('Tab');
        onActivateKey(action)(event);
        expect(action).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
    });

    it('tecla que borbulhou de um botão de dentro não dispara a ação do card', () => {
        const action = vi.fn();
        const { event, preventDefault } = key('Enter', child);
        onActivateKey(action)(event);
        expect(action).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
    });
});

describe('onBackdropClick', () => {
    const click = (target: EventTarget) => ({ target, currentTarget: el }) as unknown as MouseEvent<HTMLElement>;

    it('clique no próprio fundo fecha', () => {
        const close = vi.fn();
        onBackdropClick(close)(click(el));
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('clique que nasceu dentro do painel não fecha', () => {
        const close = vi.fn();
        onBackdropClick(close)(click(child));
        expect(close).not.toHaveBeenCalled();
    });
});
