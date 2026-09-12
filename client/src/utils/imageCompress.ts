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

// Escadas de redução, tentadas em ordem até a imagem caber no orçamento.
//
// A largura entra na escada junto com a qualidade porque print de tela é quase
// todo texto: baixar só a qualidade do JPEG borra as letras sem economizar
// muito, enquanto reduzir a dimensão economiza de verdade. Tentar 1600px antes
// de 1280px preserva a legibilidade de quem manda um recorte pequeno.
const EDGE_STEPS = [1600, 1280, 1024];
const QUALITY_STEPS = [0.82, 0.7, 0.58];

// Teto por imagem, com folga sob MAX_ATTACHMENT_BYTES (900.000) do servidor.
// Três imagens aqui somam 2,4MB e cabem no parser de 3mb de `/api/support`.
const TARGET_BYTES = 800_000;

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

    for (const edge of EDGE_STEPS) {
        const scale = Math.min(1, edge / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Não foi possível processar a imagem neste navegador.');

        // Fundo branco: JPEG não tem canal alfa, e sem isso um PNG com
        // transparência vira um retângulo preto — o print inútil.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        for (const quality of QUALITY_STEPS) {
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            if (dataUrl.length <= TARGET_BYTES) return dataUrl;
        }
    }

    throw new ImageTooLargeError();
}
