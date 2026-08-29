import React, { useCallback, useMemo, useState } from 'react';
import {
    ArrowLeft, CheckCircle2, ClipboardPaste, Download, FileSpreadsheet,
    Landmark, Loader2, ShieldCheck, Undo2, Upload,
} from 'lucide-react';
import { Modal, Button, Alert } from '../../ui';
import { useWallet, type AssetType } from '../../../contexts/WalletContext';
import { useToast } from '../../../contexts/ToastContext';
import { walletService } from '../../../services/wallet';
import { getErrorMessage } from '../../../utils/errorMessages';
import { ImportReviewTable, type TickerDecision } from './ImportReviewTable';
import { readSheetFile } from './parsers/readSheet';
import { parseB3Sheet } from './parsers/parseB3';
import { parseInvestidor10Paste } from './parsers/parseInvestidor10';
import { parseGenericSheet, buildTemplateCsv } from './parsers/parseGenericSheet';
import { ParseError, type ImportPreview, type ImportRow, type ImportSource } from './types';

/**
 * Importação de carteira — extrato da B3 ou planilha.
 *
 * Três passos: escolher a fonte, conferir o que será importado, confirmar.
 *
 * O arquivo é lido INTEIRAMENTE no navegador. O que sai daqui para o servidor
 * são só ticker, lado, quantidade, preço e data — CPF, corretora, número de
 * conta e nome do titular, que o extrato da B3 carrega, nunca saem da máquina do
 * usuário. Isso não é detalhe de implementação: está escrito na tela, porque é
 * uma das razões para a pessoa confiar em subir o extrato aqui.
 */

type Step = 'source' | 'review' | 'done';

/**
 * Porta do Investidor10 desligada por ora (decisão de produto, ago/2026).
 *
 * O parser e os testes dele continuam de pé em `parsers/parseInvestidor10.ts` —
 * só a entrada na UI está escondida. Reativar é trocar este valor para `true`;
 * apagar o parser junto obrigaria a reescrevê-lo do zero, e ele custou caro
 * justamente por o Investidor10 não ter contrato de layout nenhum.
 */
const INVESTIDOR10_ENABLED = false;

/** Hoje em `YYYY-MM-DD`, no fuso local. */
const todayIso = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const CURRENCY_CACHE: Record<string, Intl.NumberFormat> = {};
const currencyOf = (currency: string) => {
    const key = currency === 'USD' ? 'USD' : 'BRL';
    if (!CURRENCY_CACHE[key]) {
        CURRENCY_CACHE[key] = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: key });
    }
    return CURRENCY_CACHE[key];
};

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export const ImportWalletModal: React.FC<Props> = ({ isOpen, onClose }) => {
    const { importCommit, importUndo, activeWalletId, activeWalletName } = useWallet();
    const { addToast } = useToast();

    // --- Hooks primeiro; nenhum guard antes deles (CLAUDE.md) ---
    const [step, setStep] = useState<Step>('source');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<string[]>([]);

    const [pasteText, setPasteText] = useState('');
    const [startDate, setStartDate] = useState(todayIso());

    const [source, setSource] = useState<ImportSource>('INVESTIDOR10');
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [decisions, setDecisions] = useState<Record<string, TickerDecision>>({});
    const [result, setResult] = useState<{ batchId: string; inserted: number } | null>(null);

    const reset = useCallback(() => {
        setStep('source');
        setBusy(false);
        setError(null);
        setWarnings([]);
        setPasteText('');
        setStartDate(todayIso());
        setPreview(null);
        setDecisions({});
        setResult(null);
    }, []);

    const handleClose = useCallback(() => {
        reset();
        onClose();
    }, [reset, onClose]);

    /** Manda as linhas ao servidor para resolver ticker/classe e seguir à conferência. */
    const runPreview = useCallback(async (rows: ImportRow[], detectedSource: ImportSource, parseWarnings: string[]) => {
        setBusy(true);
        setError(null);
        try {
            const data: ImportPreview = await walletService.importPreview(detectedSource, rows, activeWalletId);
            setPreview(data);
            setSource(detectedSource);
            setWarnings(parseWarnings);
            // Decisão inicial por ativo: incluir tudo que o servidor conseguiu
            // classificar. Ativo sem classe entra desmarcado no seletor e o botão
            // de confirmar fica travado até o usuário resolver.
            setDecisions(
                Object.fromEntries(data.summary.map((item) => [item.ticker, { include: true, type: item.type }]))
            );
            setStep('review');
        } catch (err) {
            setError(getErrorMessage(err, 'Não consegui analisar esses dados.'));
        } finally {
            setBusy(false);
        }
    }, [activeWalletId]);

    const handleFile = useCallback(async (file: File | undefined, kind: 'B3' | 'SHEET') => {
        if (!file) return;
        setBusy(true);
        setError(null);
        try {
            const grid = await readSheetFile(file);
            const parsed = kind === 'B3' ? parseB3Sheet(grid) : parseGenericSheet(grid);
            await runPreview(parsed.rows, parsed.source ?? 'SHEET', parsed.warnings);
        } catch (err) {
            setError(err instanceof ParseError ? err.message : getErrorMessage(err, 'Não consegui ler este arquivo.'));
            setBusy(false);
        }
    }, [runPreview]);

    const handlePaste = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            const parsed = parseInvestidor10Paste(pasteText, startDate);
            await runPreview(parsed.rows, 'INVESTIDOR10', parsed.warnings);
        } catch (err) {
            setError(err instanceof ParseError ? err.message : getErrorMessage(err, 'Não consegui ler o texto colado.'));
            setBusy(false);
        }
    }, [pasteText, startDate, runPreview]);

    /** Linhas que vão de fato ao servidor, já com a classe escolhida pelo usuário. */
    const rowsToCommit = useMemo(() => {
        if (!preview) return [];
        return preview.rows
            // Duplicata nunca é reimportada — é o que torna reimportar o mesmo
            // extrato uma operação segura.
            .filter((row) => row.status !== 'duplicado')
            .filter((row) => decisions[row.ticker]?.include && decisions[row.ticker]?.type)
            .map((row) => ({
                ticker: row.ticker,
                type: decisions[row.ticker].type as AssetType,
                side: row.side,
                quantity: row.quantity,
                price: row.price,
                date: row.date,
                currency: row.currency,
                name: row.name,
            }));
    }, [preview, decisions]);

    /** Ativos marcados para importar mas ainda sem classe definida. */
    const pendingClass = useMemo(
        () => Object.entries(decisions).filter(([, d]) => d.include && !d.type).map(([ticker]) => ticker),
        [decisions]
    );

    const handleCommit = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            const data = await importCommit(source, rowsToCommit);
            if (data) {
                setResult({ batchId: data.batchId, inserted: data.inserted });
                setStep('done');
            }
        } catch (err) {
            setError(getErrorMessage(err, 'Não consegui importar a carteira.'));
        } finally {
            setBusy(false);
        }
    }, [importCommit, source, rowsToCommit]);

    const handleUndo = useCallback(async () => {
        if (!result) return;
        setBusy(true);
        try {
            await importUndo(result.batchId);
            addToast('Importação desfeita.', 'success');
            handleClose();
        } catch (err) {
            setError(getErrorMessage(err, 'Não consegui desfazer a importação.'));
            setBusy(false);
        }
    }, [result, importUndo, addToast, handleClose]);

    const downloadTemplate = useCallback(() => {
        const blob = new Blob([buildTemplateCsv()], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'modelo-carteira-vertice.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, []);

    const titles: Record<Step, string> = {
        source: 'Importar carteira',
        review: 'Confira antes de importar',
        done: 'Carteira importada',
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title={titles[step]} maxWidth="max-w-4xl" accent="border-t-emerald-500">
            {error && <Alert variant="error" className="mb-4">{error}</Alert>}

            {step === 'source' && (
                <div className="space-y-5">
                    <p className="text-sm text-slate-400">
                        Traga sua carteira para <strong className="text-slate-200">{activeWalletName}</strong> sem
                        cadastrar ativo por ativo.
                    </p>

                    {/* --- B3: a melhor porta, e por isso vem primeiro --- */}
                    <section className="border border-emerald-900/40 bg-emerald-950/10 rounded-xl p-4">
                        <div className="flex items-start gap-3">
                            <Landmark size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="text-sm font-bold text-slate-100">Extrato da B3</h3>
                                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                                        Recomendado
                                    </span>
                                </div>
                                <p className="text-xs text-slate-400 mt-1.5">
                                    Traz o histórico completo de compras e vendas com as datas reais — é o que faz a
                                    rentabilidade, a evolução do patrimônio e o relatório de IR nascerem corretos. É a
                                    mesma fonte que alimenta os consolidadores de carteira do mercado, aberta e gratuita.
                                </p>
                                <ol className="text-xs text-slate-400 mt-3 space-y-1 list-decimal list-inside marker:text-slate-600">
                                    <li>
                                        Acesse{' '}
                                        <a
                                            href="https://investidor.b3.com.br"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
                                        >
                                            investidor.b3.com.br
                                        </a>{' '}
                                        e entre com CPF ou gov.br
                                    </li>
                                    <li>Vá em <strong className="text-slate-300">Extratos e Informativos → Movimentação</strong></li>
                                    <li>Escolha a data mais antiga disponível até hoje e clique em Filtrar</li>
                                    <li>Baixe em <strong className="text-slate-300">Excel</strong> e envie o arquivo aqui</li>
                                </ol>
                                <label className="mt-3 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer transition-colors">
                                    <Upload size={14} />
                                    Enviar extrato da B3
                                    <input
                                        type="file"
                                        accept=".xlsx,.xlsm,.csv"
                                        className="sr-only"
                                        disabled={busy}
                                        onChange={(e) => { handleFile(e.target.files?.[0], 'B3'); e.target.value = ''; }}
                                    />
                                </label>
                            </div>
                        </div>
                    </section>

                    {/* --- Investidor10: colar, porque eles não exportam --- */}
                    {INVESTIDOR10_ENABLED && (
                    <section className="border border-slate-800 rounded-xl p-4">
                        <div className="flex items-start gap-3">
                            <ClipboardPaste size={18} className="text-blue-400 mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-bold text-slate-100">Colar do Investidor10</h3>
                                <p className="text-xs text-slate-400 mt-1.5">
                                    O Investidor10 não oferece exportação da carteira, então o caminho é copiar a tabela.
                                    Abra sua carteira lá, selecione a tabela inteira (incluindo o cabeçalho das colunas),
                                    copie com Ctrl+C e cole abaixo.
                                </p>

                                <textarea
                                    value={pasteText}
                                    onChange={(e) => setPasteText(e.target.value)}
                                    rows={5}
                                    placeholder={'Ativo\tQuantidade\tPreço Médio\nPETR4\t100\tR$ 30,50\nMXRF11\t200\tR$ 10,45'}
                                    aria-label="Cole aqui a tabela da sua carteira do Investidor10"
                                    className="mt-3 w-full bg-panel border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-200 font-mono outline-none focus:ring-1 focus:ring-blue-500/40 focus:border-blue-500/60 resize-y"
                                />

                                <div className="mt-3 flex flex-wrap items-end gap-3">
                                    <div>
                                        <label htmlFor="import-start-date" className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                                            Início da carteira
                                        </label>
                                        <input
                                            id="import-start-date"
                                            type="date"
                                            value={startDate}
                                            max={todayIso()}
                                            onChange={(e) => setStartDate(e.target.value)}
                                            className="bg-panel border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-blue-500/40"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handlePaste}
                                        disabled={busy || !pasteText.trim()}
                                        className="px-4 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Analisar o que foi colado
                                    </button>
                                </div>

                                <p className="text-[11px] text-slate-500 mt-2">
                                    A tabela do Investidor10 não tem as datas de compra. Todos os ativos entram como uma
                                    compra nessa data, pelo preço médio: o patrimônio e o resultado ficam certos, mas a
                                    evolução antes dela não existe.
                                </p>
                            </div>
                        </div>
                    </section>
                    )}

                    {/* --- Planilha: cripto, exterior, e quem já tinha a própria --- */}
                    <section className="border border-slate-800 rounded-xl p-4">
                        <div className="flex items-start gap-3">
                            <FileSpreadsheet size={18} className="text-slate-400 mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-bold text-slate-100">Planilha</h3>
                                <p className="text-xs text-slate-400 mt-1.5">
                                    Para cripto, ativos no exterior e renda fixa, que não passam pela B3 — ou se você já
                                    tem sua própria planilha. Baixe o modelo, preencha e envie.
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={downloadTemplate}
                                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-panel border border-slate-700 text-slate-200 hover:bg-elevated transition-colors"
                                    >
                                        <Download size={14} /> Baixar modelo
                                    </button>
                                    <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-panel border border-slate-700 text-slate-200 hover:bg-elevated cursor-pointer transition-colors">
                                        <Upload size={14} />
                                        Enviar planilha
                                        <input
                                            type="file"
                                            accept=".xlsx,.xlsm,.csv,.tsv,.txt"
                                            className="sr-only"
                                            disabled={busy}
                                            onChange={(e) => { handleFile(e.target.files?.[0], 'SHEET'); e.target.value = ''; }}
                                        />
                                    </label>
                                </div>
                            </div>
                        </div>
                    </section>

                    <div className="flex items-start gap-2.5 text-[11px] text-slate-500">
                        <ShieldCheck size={14} className="text-slate-500 mt-0.5 shrink-0" />
                        <p>
                            O arquivo é lido no seu navegador. Só as informações da operação — ativo, quantidade, preço e
                            data — chegam aos nossos servidores. CPF, corretora e número de conta não saem do seu
                            computador.
                        </p>
                    </div>

                    {busy && (
                        <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-2">
                            <Loader2 size={14} className="animate-spin" /> Lendo os dados…
                        </div>
                    )}
                </div>
            )}

            {step === 'review' && preview && (
                <div className="space-y-5">
                    {warnings.map((warning, i) => (
                        <Alert key={i} variant="warning">{warning}</Alert>
                    ))}

                    <ImportReviewTable
                        preview={preview}
                        decisions={decisions}
                        onChange={(ticker, decision) => setDecisions((prev) => ({ ...prev, [ticker]: decision }))}
                        currencyOf={currencyOf}
                    />

                    {pendingClass.length > 0 && (
                        <Alert variant="error">
                            Defina a classe de {pendingClass.slice(0, 5).join(', ')}
                            {pendingClass.length > 5 ? ` e mais ${pendingClass.length - 5}` : ''} — ou desmarque esses
                            ativos para importar o restante.
                        </Alert>
                    )}

                    <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
                        <Button variant="outline" onClick={() => { setStep('source'); setError(null); }} disabled={busy} className="sm:!w-auto sm:px-6 gap-2">
                            <ArrowLeft size={15} /> Voltar
                        </Button>
                        <Button
                            onClick={handleCommit}
                            isLoading={busy}
                            disabled={busy || rowsToCommit.length === 0 || pendingClass.length > 0}
                            className="sm:!w-auto sm:px-8 gap-2"
                        >
                            Importar {rowsToCommit.length} lançamento{rowsToCommit.length === 1 ? '' : 's'}
                        </Button>
                    </div>
                </div>
            )}

            {step === 'done' && result && (
                <div className="space-y-5 text-center py-4">
                    <CheckCircle2 size={44} className="text-emerald-400 mx-auto" />
                    <div>
                        <h3 className="text-lg font-bold text-slate-100">Sua carteira está no Vértice</h3>
                        <p className="text-sm text-slate-400 mt-1.5">
                            {result.inserted} lançamento(s) importado(s). O patrimônio, a rentabilidade e os proventos já
                            estão sendo calculados — os proventos aparecem sozinhos, sem precisar importar nada.
                        </p>
                    </div>

                    <div className="flex flex-col-reverse sm:flex-row gap-3 justify-center pt-1">
                        <Button variant="ghost" onClick={handleUndo} disabled={busy} className="sm:!w-auto sm:px-6 gap-2">
                            <Undo2 size={15} /> Desfazer importação
                        </Button>
                        <Button onClick={handleClose} disabled={busy} className="sm:!w-auto sm:px-8">
                            Ver minha carteira
                        </Button>
                    </div>
                </div>
            )}
        </Modal>
    );
};
