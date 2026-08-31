import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AssetLogo from './AssetLogo';

// O chip do FII é o único lugar da linha onde a exposição do fundo aparece sem
// custar uma coluna. O mapa (fiiSegmentIcon) já é testado à parte; o que se
// garante aqui é a FIAÇÃO: o tom da família precisa chegar ao DOM, e o segmento
// desconhecido precisa continuar caindo nas iniciais em vez de inventar uma
// classificação. Sem isto, trocar o contrato do mapa apagaria a cor em silêncio.
describe('AssetLogo — chip de FII', () => {
  const chipOf = (title: string) => screen.getByTitle(title);

  it('tinge o chip com a cor da família do segmento', () => {
    render(<AssetLogo ticker="KNCR11" type="FII" sector="Papel" />);
    const chip = chipOf('Papel (CRI)');
    expect(chip.className).toContain('text-violet-400');
    expect(chip.className).toContain('bg-violet-400/10');
    expect(chip.querySelector('svg')).toBeTruthy();
  });

  it('dá tons diferentes a riscos diferentes (papel × shopping)', () => {
    const { unmount } = render(<AssetLogo ticker="HGCR11" type="FII" sector="Papel" />);
    const papel = chipOf('Papel (CRI)').className;
    unmount();
    render(<AssetLogo ticker="HGBS11" type="FII" sector="Shoppings" />);
    expect(chipOf('Shoppings').className).not.toBe(papel);
  });

  it('agrupa pela família: logística e infraestrutura no mesmo ciano', () => {
    const { unmount } = render(<AssetLogo ticker="BTLG11" type="FII" sector="Logistica" />);
    expect(chipOf('Logística').className).toContain('cyan');
    unmount();
    render(<AssetLogo ticker="IFRA11" type="FII" sector="Infraestrutura" />);
    expect(chipOf('Infraestrutura').className).toContain('cyan');
  });

  it('segmento fora do canon cai nas iniciais, sem cor', () => {
    render(<AssetLogo ticker="MCEM11" type="FII" sector="Cemiterios" />);
    expect(screen.getByText('MC')).toBeInTheDocument();
  });

  it('FII sem setor cai nas iniciais', () => {
    render(<AssetLogo ticker="KNSC11" type="FII" />);
    expect(screen.getByText('KN')).toBeInTheDocument();
  });
});
