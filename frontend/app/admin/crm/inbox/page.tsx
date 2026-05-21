'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Inbox,
  MessageSquare,
  StickyNote,
  Send,
  Search,
  CheckCircle2,
  AlertOctagon,
  ExternalLink,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/lib/hooks/use-debounce';
import type { ConversationMessage, ConversationStatus } from '@/lib/types/crm';

type ConversationListItem = {
  id: string;
  contact_id: string;
  phone: string | null;
  channel: string;
  unread_count: number;
  status: ConversationStatus;
  assigned_to: string | null;
  last_message_at: string;
  contact: { first_name: string | null; last_name: string | null; email: string | null } | null;
  last_message: { body: string; direction: string; created_at: string } | null;
};

type AdminOption = {
  id: string;
  email: string;
  role: string;
  is_self: boolean;
};

const STATUS_DOT: Record<ConversationStatus, string> = {
  open: 'bg-blue-500',
  assigned: 'bg-purple-500',
  escalated: 'bg-red-500',
  resolved: 'bg-emerald-500',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

function formatPhoneShort(phone: string | null): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

export default function InboxPage() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 200);
  const [reply, setReply] = useState('');
  const [replyMode, setReplyMode] = useState<'sms' | 'note'>('sms');
  const [sending, setSending] = useState(false);
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const escalateRef = useRef<HTMLDivElement>(null);

  // Fetch conversations on mount + when filter changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const statusParam = filter === 'open' ? 'open,assigned,escalated' : '';
    const url = statusParam
      ? `/api/admin/crm/conversations?status=${statusParam}`
      : '/api/admin/crm/conversations';
    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setConversations((json.data as ConversationListItem[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setConversations([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  // Fetch messages when selected conversation changes + mark read.
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    fetch(`/api/admin/crm/conversations/${selectedId}/messages`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setMessages((json.data as ConversationMessage[]) ?? []);
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    fetch(`/api/admin/crm/conversations/${selectedId}/read`, { method: 'POST' }).catch(() => {});
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, unread_count: 0 } : c)),
    );
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Polling for new messages on selected conversation.
  useEffect(() => {
    if (!selectedId) return;
    const interval = setInterval(() => {
      fetch(`/api/admin/crm/conversations/${selectedId}/messages`)
        .then((r) => r.json())
        .then((json) => {
          setMessages((json.data as ConversationMessage[]) ?? []);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedId]);

  // Auto-scroll on new messages.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Lazy-load the admin roster the first time the escalate menu opens — keeps
  // the inbox shell snappy while still giving the picker fresh data.
  useEffect(() => {
    if (!escalateOpen || admins.length > 0) return;
    let cancelled = false;
    fetch('/api/admin/crm/admins')
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setAdmins((json.data as AdminOption[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setAdmins([]);
      });
    return () => {
      cancelled = true;
    };
  }, [escalateOpen, admins.length]);

  // Close the escalate dropdown on outside-click.
  useEffect(() => {
    if (!escalateOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!escalateRef.current?.contains(e.target as Node)) setEscalateOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [escalateOpen]);

  const filteredConversations = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const name =
        [c.contact?.first_name, c.contact?.last_name].filter(Boolean).join(' ').toLowerCase();
      return (
        name.includes(q) ||
        (c.contact?.email ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').includes(q)
      );
    });
  }, [conversations, debouncedQuery]);

  const totalUnread = conversations.reduce((acc, c) => acc + (c.unread_count ?? 0), 0);
  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  async function handleSend() {
    if (!selectedId || !reply.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/crm/conversations/${selectedId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: reply.trim(),
          is_internal_note: replyMode === 'note',
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { message: ConversationMessage };
        setMessages((prev) => [...prev, json.message]);
        setReply('');
      } else {
        const err = await res.json().catch(() => ({ error: 'SEND_FAILED' }));
        alert(`Failed to send: ${err.error ?? res.statusText}`);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleResolve() {
    if (!selectedId) return;
    await fetch(`/api/admin/crm/conversations/${selectedId}/resolve`, { method: 'POST' });
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, status: 'resolved' } : c)),
    );
  }

  async function handleEscalate(adminId: string) {
    if (!selectedId || escalating) return;
    setEscalating(true);
    try {
      const res = await fetch(`/api/admin/crm/conversations/${selectedId}/escalate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_id: adminId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'ESCALATE_FAILED' }));
        alert(`Failed to escalate: ${err.error ?? res.statusText}`);
        return;
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId ? { ...c, status: 'escalated', assigned_to: adminId } : c,
        ),
      );
      setEscalateOpen(false);
    } finally {
      setEscalating(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-56px)] bg-gray-950">
      {/* Left pane — conversation list */}
      <aside className="w-80 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-sm font-bold text-white flex items-center gap-2">
              Inbox
              {totalUnread > 0 && (
                <span className="text-[10px] font-semibold bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded-full">
                  {totalUnread}
                </span>
              )}
            </h1>
            <div className="flex bg-gray-900 border border-gray-800 rounded-md p-0.5 text-[10px] font-medium">
              <button
                onClick={() => setFilter('open')}
                className={cn(
                  'px-2 py-0.5 rounded',
                  filter === 'open' ? 'bg-gray-700 text-white' : 'text-gray-500',
                )}
              >
                Open
              </button>
              <button
                onClick={() => setFilter('all')}
                className={cn(
                  'px-2 py-0.5 rounded',
                  filter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-500',
                )}
              >
                All
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full bg-gray-900 border border-gray-800 focus:border-blue-500 outline-none rounded-md pl-8 pr-2 py-1.5 text-xs text-white placeholder-gray-600 transition-colors"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-8 text-center">
              <MessageSquare className="w-10 h-10 text-gray-700 mx-auto mb-2" />
              <p className="text-xs text-gray-500">No conversations</p>
            </div>
          ) : (
            filteredConversations.map((c) => {
              const name =
                [c.contact?.first_name, c.contact?.last_name].filter(Boolean).join(' ') ||
                c.contact?.email ||
                formatPhoneShort(c.phone);
              const initial = (c.contact?.first_name?.[0] ?? c.phone?.[1] ?? '?').toUpperCase();
              const isActive = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    'w-full flex items-start gap-3 px-3 py-3 text-left border-l-2 transition-colors',
                    isActive
                      ? 'bg-gray-800 border-l-blue-500'
                      : 'border-l-transparent hover:bg-gray-900',
                  )}
                >
                  <div className="relative shrink-0">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-xs font-semibold text-white">
                      {initial}
                    </div>
                    <div
                      className={cn(
                        'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-gray-950',
                        STATUS_DOT[c.status],
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white truncate">{name}</span>
                      <span className="text-[10px] text-gray-600 shrink-0">
                        {relativeTime(c.last_message_at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-[11px] text-gray-500 truncate">
                        {c.last_message?.body ?? 'No messages yet'}
                      </span>
                      {c.unread_count > 0 && (
                        <span className="text-[10px] font-semibold bg-blue-500 text-white px-1.5 py-0.5 rounded-full shrink-0">
                          {c.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Right pane — conversation thread */}
      <section className="flex-1 flex flex-col">
        {!selectedConversation ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <Inbox className="w-12 h-12 text-gray-700 mb-3" />
            <p className="text-sm text-gray-400 font-medium">Select a conversation</p>
            <p className="text-xs text-gray-600 mt-1 max-w-xs">
              Choose a conversation from the left to view messages and reply.
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <header className="h-14 px-5 border-b border-gray-800 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">
                  {[selectedConversation.contact?.first_name, selectedConversation.contact?.last_name]
                    .filter(Boolean)
                    .join(' ') ||
                    selectedConversation.contact?.email ||
                    formatPhoneShort(selectedConversation.phone)}
                </div>
                <div className="text-[11px] text-gray-500 truncate">
                  {formatPhoneShort(selectedConversation.phone)}
                </div>
              </div>
              <button
                onClick={handleResolve}
                disabled={selectedConversation.status === 'resolved'}
                className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 hover:border-emerald-500/50 rounded-md px-2.5 py-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Resolve
              </button>
              <div className="relative" ref={escalateRef}>
                <button
                  onClick={() => setEscalateOpen((v) => !v)}
                  disabled={escalating}
                  className="flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 border border-orange-500/30 hover:border-orange-500/50 rounded-md px-2.5 py-1 transition-colors disabled:opacity-50"
                >
                  {escalating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <AlertOctagon className="w-3.5 h-3.5" />
                  )}
                  Escalate
                  <ChevronDown className="w-3 h-3" />
                </button>
                {escalateOpen && (
                  <div className="absolute right-0 top-full mt-1 w-64 bg-gray-900 border border-gray-800 rounded-lg shadow-xl z-20 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-800">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                        Assign escalation to
                      </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto py-1">
                      {admins.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-gray-600">
                          <Loader2 className="w-4 h-4 text-gray-700 animate-spin mx-auto" />
                        </div>
                      ) : (
                        admins.map((a) => (
                          <button
                            key={a.id}
                            onClick={() => handleEscalate(a.id)}
                            disabled={escalating}
                            className="w-full text-left px-3 py-2 hover:bg-gray-800/60 transition-colors disabled:opacity-50 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-white truncate">
                                {a.email}
                                {a.is_self && (
                                  <span className="ml-1.5 text-[9px] font-semibold text-blue-400">
                                    (you)
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-gray-500">{a.role}</div>
                            </div>
                            {selectedConversation?.assigned_to === a.id && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
              <Link
                href={`/admin/crm/contacts/${selectedConversation.contact_id}`}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-white"
              >
                Contact <ExternalLink className="w-3 h-3" />
              </Link>
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {messagesLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center text-xs text-gray-600 py-10">
                  No messages in this conversation yet.
                </div>
              ) : (
                messages.map((m) => {
                  if (m.direction === 'internal') {
                    return (
                      <div key={m.id} className="flex justify-center">
                        <div className="max-w-md bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-2 text-xs">
                          <div className="flex items-center gap-1.5 text-yellow-400 font-medium mb-0.5">
                            <StickyNote className="w-3 h-3" /> Internal note
                          </div>
                          <div className="text-yellow-200/90 whitespace-pre-wrap">{m.body}</div>
                          <div className="text-[10px] text-yellow-500/50 mt-1 text-right">
                            {relativeTime(m.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  const isOutbound = m.direction === 'outbound';
                  return (
                    <div
                      key={m.id}
                      className={cn('flex', isOutbound ? 'justify-end' : 'justify-start')}
                    >
                      <div className="max-w-md">
                        <div
                          className={cn(
                            'px-4 py-2 text-sm whitespace-pre-wrap',
                            isOutbound
                              ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm'
                              : 'bg-gray-800 text-gray-100 rounded-2xl rounded-tl-sm',
                          )}
                        >
                          {m.body}
                        </div>
                        <div
                          className={cn(
                            'text-[10px] text-gray-600 mt-1 px-2',
                            isOutbound ? 'text-right' : 'text-left',
                          )}
                        >
                          {relativeTime(m.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply area */}
            <div className="border-t border-gray-800 px-5 py-3">
              <div className="flex bg-gray-900 border border-gray-800 rounded-md p-0.5 mb-2 w-fit text-[10px] font-medium">
                <button
                  onClick={() => setReplyMode('sms')}
                  className={cn(
                    'px-2.5 py-1 rounded flex items-center gap-1',
                    replyMode === 'sms' ? 'bg-blue-600 text-white' : 'text-gray-500',
                  )}
                >
                  <MessageSquare className="w-3 h-3" /> Reply via SMS
                </button>
                <button
                  onClick={() => setReplyMode('note')}
                  className={cn(
                    'px-2.5 py-1 rounded flex items-center gap-1',
                    replyMode === 'note' ? 'bg-yellow-600 text-white' : 'text-gray-500',
                  )}
                >
                  <StickyNote className="w-3 h-3" /> Internal Note
                </button>
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  rows={2}
                  placeholder={
                    replyMode === 'note'
                      ? 'Write an internal note (not sent to contact)…'
                      : 'Reply via SMS…'
                  }
                  className="flex-1 bg-gray-900 border border-gray-800 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 resize-none transition-colors"
                />
                <button
                  onClick={handleSend}
                  disabled={!reply.trim() || sending}
                  className={cn(
                    'p-2.5 rounded-lg text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
                    replyMode === 'note'
                      ? 'bg-yellow-600 hover:bg-yellow-500'
                      : 'bg-blue-600 hover:bg-blue-500',
                  )}
                  aria-label="Send"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
              <div className="text-[10px] text-gray-600 mt-1">
                Press Enter to send · Shift+Enter for newline
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
