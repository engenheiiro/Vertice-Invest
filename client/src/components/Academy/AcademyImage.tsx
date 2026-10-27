import React from 'react';

// As capas da Academy chegam da API com o caminho do PNG gravado no banco
// (`/assets/academy/...png`). Cada PNG tem um WebP irmão ~5x menor no mesmo
// diretório; o navegador que entende WebP baixa só ele e o PNG fica de reserva,
// sem precisar migrar o que está gravado.
const ACADEMY_PNG = /^\/assets\/academy\/.+\.png$/;

type Props = React.ImgHTMLAttributes<HTMLImageElement> & { src: string };

export const AcademyImage: React.FC<Props> = ({ src, ...imgProps }) => {
    const img = <img src={src} {...imgProps} />;
    if (!ACADEMY_PNG.test(src)) return img;
    return (
        <picture className="contents">
            <source srcSet={src.replace(/\.png$/, '.webp')} type="image/webp" />
            {img}
        </picture>
    );
};
