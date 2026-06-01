import React, { useEffect, useState } from 'react';
import { SlidersHorizontal, Save, RotateCcw, Loader2 } from 'lucide-react';
import { authService } from '../../services/auth';

interface Tunable {
    key: string;
    label: string;
    value: number;
    default: number;
    min: number;
    max: number;
}

/**
 * (I13) Editor de parâmetros operacionais (SystemConfig) sem deploy.
 * Lê /research/config/tunables e salva via PUT. Mudanças entram em vigor em
 * até ~1min (TTL do cache do configService no backend).
 */
export const TunablesCard = () => {
    const [tunables, setTunables] = useState<Tunable[]>([]);
    const [draft, setDraft] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const load = async () => {
        try {
            const res = await authService.api('/api/research/config/tunables', { method: 'GET' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Falha ao carregar');
            setTunables(data.tunables || []);
            setDraft(Object.fromEntries((data.tunables || []).map((t: Tunable) => [t.key, t.value])));
        } catch (e: any) {
            setMsg({ type: 'error', text: e.message || 'Erro ao carregar configurações.' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const dirty = tunables.some((t) => draft[t.key] !== t.value);

    const save = async () => {
        setSaving(true);
        setMsg(null);
        try {
            const res = await authService.api('/api/research/config/tunables', {
                method: 'PUT',
                body: JSON.stringify(draft),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Falha ao salvar');
            // Atualiza a referência com os valores efetivamente persistidos.
            const refreshed: Tunable[] = tunables.map((t) => ({ ...t, value: data.tunables[t.key] ?? t.value }));
            setTunables(refreshed);
            setDraft(Object.fromEntries(refreshed.map((t) => [t.key, t.value])));
            setMsg({ type: 'success', text: 'Salvo! Em vigor em até 1 min.' });
            setTimeout(() => setMsg(null), 3000);
        } catch (e: any) {
            setMsg({ type: 'error', text: e.message || 'Erro ao salvar.' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-base border border-slate-800 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center gap-2 mb-4">
                <SlidersHorizontal size={18} className="text-blue-500" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Parâmetros do Sistema</h3>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-slate-500 text-xs py-4">
                    <Loader2 size={14} className="animate-spin" /> Carregando…
                </div>
            ) : (
                <div className="space-y-4">
                    {tunables.map((t) => (
                        <div key={t.key}>
                            <div className="flex items-center justify-between mb-1">
                                <label className="text-[10px] text-slate-400 font-bold uppercase">{t.label}</label>
                                <button
                                    type="button"
                                    title="Restaurar padrão"
                                    onClick={() => setDraft((d) => ({ ...d, [t.key]: t.default }))}
                                    className="text-slate-600 hover:text-blue-400 transition-colors"
                                >
                                    <RotateCcw size={12} />
                                </button>
                            </div>
                            <input
                                type="number"
                                min={t.min}
                                max={t.max}
                                value={draft[t.key] ?? ''}
                                onChange={(e) => setDraft((d) => ({ ...d, [t.key]: Number(e.target.value) }))}
                                className="w-full bg-card border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-blue-600 focus:outline-none"
                            />
                            <p className="text-[9px] text-slate-600 mt-0.5">
                                Faixa {t.min}–{t.max} · padrão {t.default}
                            </p>
                        </div>
                    ))}

                    {msg && (
                        <div className={`p-2 text-xs font-bold text-center rounded-lg ${msg.type === 'success' ? 'text-emerald-400 bg-emerald-900/20' : 'text-red-400 bg-red-900/20'}`}>
                            {msg.text}
                        </div>
                    )}

                    <button
                        onClick={save}
                        disabled={!dirty || saving}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Salvar alterações
                    </button>
                </div>
            )}
        </div>
    );
};
