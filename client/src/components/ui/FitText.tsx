
import React, { useLayoutEffect, useRef, useState } from 'react';

interface FitTextProps {
    children: React.ReactNode;
    /** Corpo máximo da fonte (px) — usado quando o conteúdo cabe folgado. */
    max?: number;
    /** Corpo mínimo da fonte (px) — piso ao encolher valores muito longos. */
    min?: number;
    /** Classes aplicadas à caixa medida (peso/letter-spacing/cor são herdados pelo texto). */
    className?: string;
    title?: string;
    'aria-live'?: 'off' | 'polite' | 'assertive';
    'aria-atomic'?: boolean;
}

/**
 * Escala o corpo da fonte para o conteúdo caber na largura disponível, sem cortar.
 *
 * Substitui o `truncate` em valores monetários: em vez de esconder dígitos
 * (ex.: "R$ 1.234.5…"), reduz a fonte até o número inteiro caber (respeitando o
 * piso `min`). Mede via ResizeObserver, então reage à largura do card, ao count-up
 * e ao toggle de privacidade. `font-weight`/`tracking`/`color` continuam vindo das
 * classes da caixa (herdados pelo <span> interno).
 */
export const FitText: React.FC<FitTextProps> = ({ children, max = 28, min = 15, className, ...rest }) => {
    const boxRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLSpanElement>(null);
    const [size, setSize] = useState(max);

    useLayoutEffect(() => {
        const box = boxRef.current;
        const text = textRef.current;
        if (!box || !text) return;

        const fit = () => {
            const avail = box.clientWidth;
            if (avail <= 0) return; // jsdom / layout ainda não medido
            let next = max;
            text.style.fontSize = `${next}px`;
            // Encolhe em passos de 0.5px até caber (ou atingir o piso).
            while (text.scrollWidth > avail && next > min) {
                next = Math.max(min, next - 0.5);
                text.style.fontSize = `${next}px`;
            }
            setSize(next);
        };

        fit();

        // jsdom não implementa ResizeObserver; guardamos p/ não quebrar testes.
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(fit);
        ro.observe(box);
        return () => ro.disconnect();
    }, [children, max, min]);

    return (
        <div ref={boxRef} className={`min-w-0 ${className ?? ''}`} {...rest}>
            <span
                ref={textRef}
                className="inline-block whitespace-nowrap"
                style={{ fontSize: `${size}px`, lineHeight: 1.15 }}
            >
                {children}
            </span>
        </div>
    );
};
