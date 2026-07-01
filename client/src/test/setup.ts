// Setup global dos testes do client.
// Registra os matchers do jest-dom (toBeInTheDocument, etc.) e garante que o
// DOM renderizado é limpo após cada teste, evitando contaminação entre eles.
import '@testing-library/jest-dom';
import { afterEach, vi, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';

// Registra matcher de acessibilidade globalmente em todos os testes.
expect.extend(toHaveNoViolations);

// jsdom não implementa matchMedia — necessário para useIsMobile e afins.
// Default: desktop (não-mobile). Testes podem sobrescrever window.matchMedia.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// jsdom não implementa scrollIntoView — usado pelo overlay do tutorial.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

afterEach(() => {
  cleanup();
});
