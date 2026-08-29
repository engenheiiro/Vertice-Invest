import { unzipSync, strFromU8 } from 'fflate';
import { ParseError } from '../types';

/**
 * Leitura de planilha no NAVEGADOR — `.xlsx` e `.csv` viram uma grade de strings.
 *
 * ## Por que não SheetJS
 *
 * A versão do `xlsx` publicada no npm (0.18.5) carrega CVE-2023-30533 e
 * CVE-2024-22363; as correções só existem nas versões do CDN próprio da SheetJS,
 * e depender de uma URL em `package.json` amarra o build do Render à
 * disponibilidade daquele host. O `exceljs`, por sua vez, pede polyfills de
 * `stream`/`buffer` no Vite.
 *
 * Um `.xlsx` é um zip de XML, e os arquivos que nos interessam (extrato da B3,
 * planilha modelo) são gerados por máquina: uma aba, cabeçalho na primeira
 * linha, sem células mescladas. Isso cabe em `fflate` + `DOMParser`.
 *
 * Tudo aqui fica atrás de `readSheetFile`, então trocar por SheetJS depois é
 * mexer em um arquivo só.
 */

/** Teto de tamanho. O extrato da B3 tem limite de 10MB; damos folga. */
const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** `"AB12"` → índice de coluna 27 (base zero). */
const columnIndexFromRef = (ref: string): number => {
    const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? '';
    let index = 0;
    for (const letter of letters) {
        index = index * 26 + (letter.charCodeAt(0) - 64);
    }
    return index - 1;
};

/**
 * Extrai a tabela de strings compartilhadas.
 *
 * O Excel guarda todo texto repetido aqui e as células só referenciam o índice.
 * Um `<si>` pode vir partido em vários `<t>` (texto com formatação mista), então
 * concatenamos todos os `<t>` de dentro do item em vez de pegar só o primeiro.
 */
const readSharedStrings = (xml: string): string[] => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return Array.from(doc.getElementsByTagName('si')).map((si) =>
        Array.from(si.getElementsByTagName('t'))
            .map((t) => t.textContent ?? '')
            .join('')
    );
};

/** Converte uma aba em grade de strings, preservando colunas vazias. */
const readWorksheet = (xml: string, sharedStrings: string[]): string[][] => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const grid: string[][] = [];

    for (const rowEl of Array.from(doc.getElementsByTagName('row'))) {
        const cells: string[] = [];

        for (const cell of Array.from(rowEl.getElementsByTagName('c'))) {
            const ref = cell.getAttribute('r') ?? '';
            const kind = cell.getAttribute('t');
            let value = '';

            if (kind === 'inlineStr') {
                value = Array.from(cell.getElementsByTagName('t'))
                    .map((t) => t.textContent ?? '')
                    .join('');
            } else {
                const raw = cell.getElementsByTagName('v')[0]?.textContent ?? '';
                // `t="s"` não é o texto: é o ÍNDICE na tabela compartilhada.
                value = kind === 's' ? (sharedStrings[Number(raw)] ?? '') : raw;
            }

            // Células vazias são omitidas do XML — a referência (`r="C2"`) é o que
            // diz em qual coluna a célula está. Sem respeitar isso, uma linha com
            // buraco desloca todas as colunas seguintes.
            const index = ref ? columnIndexFromRef(ref) : cells.length;
            while (cells.length < index) cells.push('');
            cells[index] = value.trim();
        }

        grid.push(cells);
    }

    return grid;
};

const readXlsx = (buffer: ArrayBuffer): string[][] => {
    let files: Record<string, Uint8Array>;
    try {
        files = unzipSync(new Uint8Array(buffer));
    } catch {
        throw new ParseError(
            'Não consegui abrir este arquivo como planilha. Baixe o Excel direto da B3, sem abrir e salvar de novo.'
        );
    }

    const sheetPaths = Object.keys(files)
        .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
        .sort((a, b) => {
            const n = (p: string) => Number(/sheet(\d+)\.xml$/.exec(p)?.[1] ?? 0);
            return n(a) - n(b);
        });

    if (sheetPaths.length === 0) {
        throw new ParseError('Esta planilha não tem nenhuma aba de dados legível.');
    }

    const sharedStringsFile = files['xl/sharedStrings.xml'];
    const sharedStrings = sharedStringsFile ? readSharedStrings(strFromU8(sharedStringsFile)) : [];

    return readWorksheet(strFromU8(files[sheetPaths[0]]), sharedStrings);
};

/**
 * CSV/TSV com aspas conforme RFC 4180.
 *
 * O delimitador é farejado, não assumido: planilha brasileira salva do Excel sai
 * com `;` porque a vírgula é o separador decimal, e assumir `,` transformaria
 * `1.234,56` em duas colunas.
 */
export const parseDelimited = (text: string): string[][] => {
    const sample = text.slice(0, 4096);
    const counts: Array<[string, number]> = [
        [';', (sample.match(/;/g) || []).length],
        ['\t', (sample.match(/\t/g) || []).length],
        [',', (sample.match(/,/g) || []).length],
    ];
    const delimiter = counts.sort((a, b) => b[1] - a[1])[0][1] > 0
        ? counts.sort((a, b) => b[1] - a[1])[0][0]
        : ',';

    const grid: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];

        if (quoted) {
            if (char === '"') {
                // `""` dentro de campo entre aspas é uma aspa literal.
                if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') { quoted = true; }
        else if (char === delimiter) { row.push(field.trim()); field = ''; }
        else if (char === '\n') { row.push(field.trim()); grid.push(row); row = []; field = ''; }
        else if (char !== '\r') { field += char; }
    }

    if (field || row.length > 0) { row.push(field.trim()); grid.push(row); }

    return grid;
};

/** Lê um arquivo escolhido pelo usuário e devolve a grade bruta. */
export const readSheetFile = async (file: File): Promise<string[][]> => {
    if (file.size > MAX_FILE_BYTES) {
        throw new ParseError('Arquivo maior que 15 MB. Filtre um período menor no extrato e baixe de novo.');
    }

    const name = file.name.toLowerCase();

    if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
        return parseDelimited(await file.text());
    }

    if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
        return readXlsx(await file.arrayBuffer());
    }

    // `.xls` de verdade é OLE2 binário, um formato completamente diferente — e a
    // B3 oferece o download em `.xlsx`, então dizer isso é mais útil que falhar.
    if (name.endsWith('.xls')) {
        throw new ParseError('O formato .xls antigo não é suportado. Na B3, escolha o download em Excel (.xlsx).');
    }

    throw new ParseError('Formato não reconhecido. Envie um arquivo .xlsx ou .csv.');
};
