import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testes do backend não dependem de DOM
    environment: 'node',
    // O default de 5s é apertado quando um `await import()` de módulo pesado
    // (ex.: aiResearchService, ~1,5s a frio) cai no PRIMEIRO teste de um arquivo
    // sob 100+ specs em paralelo disputando CPU — o cold import estourava o
    // timeout e gerava flake raro. 15s dá folga sem mascarar travamentos reais.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      // Foca a medição no núcleo testável (matemática financeira + engines)
      include: ['utils/**/*.js', 'services/engines/**/*.js'],
      // Gate-ratchet: thresholds logo abaixo da cobertura atual para travar o piso
      // e impedir regressão. Subir conforme T1/T2/T8 adicionam testes.
      // (functions baixo no mathUtils: muitos helpers pequenos ainda sem teste direto.)
      thresholds: {
        'utils/mathUtils.js': { lines: 70, statements: 70, branches: 85, functions: 25 },
        'services/engines/scoringEngine.js': { lines: 70, statements: 70, branches: 45, functions: 90 },
        'services/engines/portfolioEngine.js': { lines: 80, statements: 80, branches: 70, functions: 90 },
        'services/engines/signalEngine.js': { lines: 60, statements: 60, branches: 30, functions: 70 },
      },
    },
  },
});
