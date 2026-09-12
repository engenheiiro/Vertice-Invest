/**
 * Reduz um print antes de ele subir.
 *
 * Um screenshot de tela cheia em PNG sai com 3–8 MB. O servidor recusa acima de
 * ~1,4 MB, então sem esta etapa o usuário que mais precisa anexar imagem (o que
 * tem monitor grande) é justamente o que leva "arquivo muito grande" na cara.
 *
 * Converte para JPEG porque o conteúdo típico é foto de tela, não arte com
 * transparência — e JPEG a 0,82 economiza uma ordem de grandeza sobre o PNG.
 */

const MAX_EDGE = 1600;
const TARGET_BYTES = 1_300_000; // folga sob o teto do servidor (1,4 MB)
const MIN_QUALITY = 0.5;

export class ImageTooLargeError extends Error {
    constructor() {
        super('Não foi possível reduzir esta imagem o suficiente. Envie um recorte da tela.');
        this.name = 'ImageTooLargeError';
    }
}

const loadImage = (file: File): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Arquivo de imagem inválido.')); };
    img.src = url;
});

/**
 * @returns data-URL pronta para o corpo da requisição.
 */
export async function compressImage(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) {
        throw new Error('Envie uma imagem (PNG, JPEG ou WEBP).');
    }

    const img = await loadImage(file);

    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível processar a imagem neste navegador.');

    // Fundo branco: JPEG não tem canal alfa, e sem isso um PNG com transparência
    // vira um retângulo preto — que é exatamente o print inútil.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Cai a qualidade em degraus até caber. Tela cheia de texto comprime mal;
    // uma passada só de 0,82 não garante o teto.
    for (let quality = 0.82; quality >= MIN_QUALITY; quality -= 0.12) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (dataUrl.length <= TARGET_BYTES) return dataUrl;
    }

    throw new ImageTooLargeError();
}
