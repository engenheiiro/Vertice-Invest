import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Bell, BellRing, CheckCheck, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsService, AppNotification } from '../../services/notifications';
import { useAuth } from '../../contexts/AuthContext';

// ─── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}m atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  const days = Math.floor(hrs / 24);
  return `${days}d atrás`;
}

// Descobre se a notificação foi lida pelo usuário atual.
// Para broadcasts, userId vem do localStorage (heurística segura aqui pois é só UI).
function isNotificationRead(n: AppNotification, userId: string | null): boolean {
  if (n.user) return n.isRead;
  return !!userId && n.readBy.includes(userId);
}

// ─── Component ───────────────────────────────────────────────────────────────

export const NotificationBell: React.FC = () => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // userId usado para decidir se um broadcast já foi lido por este usuário
  const userId = user?.id ?? null;

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsService.getNotifications,
    refetchInterval: 60_000,   // polling a cada 60 s
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  // ── Mutations ──────────────────────────────────────────────────────────────

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsService.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllMutation = useMutation({
    mutationFn: notificationsService.markAllRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // ── Fechar ao clicar fora ─────────────────────────────────────────────────

  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (
      panelRef.current && !panelRef.current.contains(e.target as Node) &&
      buttonRef.current && !buttonRef.current.contains(e.target as Node)
    ) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open, handleOutsideClick]);

  // ── Panel position: âncora no botão ───────────────────────────────────────

  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, [open]);

  // ── Render ────────────────────────────────────────────────────────────────

  const hasUnread = unreadCount > 0;

  return (
    <>
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
        title="Notificações"
        aria-label={`Notificações${hasUnread ? ` (${unreadCount} não lidas)` : ''}`}
      >
        {hasUnread ? <BellRing size={16} className="text-blue-400" /> : <Bell size={16} />}

        {hasUnread && (
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-500 ring-1 ring-[#03060D]" />
        )}
      </button>

      {/* Dropdown panel via portal */}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            className="z-[100] w-80 rounded-xl border border-slate-700/60 bg-[#0F131E] shadow-2xl shadow-black/60 backdrop-blur-md overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
              <div className="flex items-center gap-2">
                <Bell size={14} className="text-blue-400" />
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Notificações
                </span>
                {hasUnread && (
                  <span className="text-[10px] font-bold bg-blue-600/20 text-blue-400 border border-blue-600/30 px-1.5 py-0.5 rounded-full">
                    {unreadCount}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                {hasUnread && (
                  <button
                    onClick={() => markAllMutation.mutate()}
                    disabled={markAllMutation.isPending}
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-emerald-400 transition-colors px-1.5 py-1 rounded hover:bg-slate-800"
                    title="Marcar todas como lidas"
                  >
                    <CheckCheck size={12} />
                    <span>Todas</span>
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-500 gap-2">
                  <Bell size={22} className="opacity-30" />
                  <p className="text-xs">Nenhuma notificação</p>
                </div>
              ) : (
                notifications.map((n) => {
                  const read = isNotificationRead(n, userId);
                  return (
                    <div
                      key={n._id}
                      className={`
                        flex items-start gap-3 px-4 py-3 border-b border-slate-800/40 last:border-0 transition-colors cursor-pointer
                        ${read ? 'opacity-50 hover:opacity-70' : 'hover:bg-slate-800/30'}
                      `}
                      onClick={() => {
                        if (!read) markReadMutation.mutate(n._id);
                      }}
                    >
                      {/* Dot de não-lida */}
                      <div className="mt-1.5 shrink-0">
                        <span
                          className={`block w-1.5 h-1.5 rounded-full ${read ? 'bg-transparent' : 'bg-blue-500'}`}
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-200 leading-tight truncate">
                          {n.title}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-snug line-clamp-2">
                          {n.message}
                        </p>
                        <p className="text-[10px] text-slate-600 mt-1 font-mono">
                          {relativeTime(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
