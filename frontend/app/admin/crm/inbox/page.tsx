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
  Mail,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/lib/hooks/use-debounce';
import type {
  Contact,
  ConversationMessage,
  ConversationStatus,
  TimelineEvent,
} from '@/lib/types/crm';

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

type SentItem = TimelineEvent & {
  contact: Pick<Contact, 'id' | 'first_name' | 'last_name' | 'email' | 'phone'> | null;
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

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function InboxPage() {
  const [tab, setTab] = useState<'inbox' | 'sent'>('inbox');
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

  // Sent tab
  const [sentItems, setSentItems] = useState<SentItem[]>([]);
  const [sentLoading, setSentLoading] = useState(false);
  const [sentChannel, setSentChannel] = useState<'all' | 'email' | 'sms'>('all');

  // Fetch conversations on mount + when filter changes (inbox tab only).
  useEffect(() => {
    if (tab !== 'inbox') return;
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
  }, [filter, tab]);

  // Fetch sent items when sent tab is active or channel changes.
  useEffect(() => {
    if (tab !== 'sent') return;
    let cancelled = false;
    setSentLoading(true);
    const params = new URLSearchParams();
    if (sentChannel !== 'all') params.set('channel', sentChannel);
    params.set('per_page', '50');
    fetch(`/api/admin/crm/messages/sent?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setSentItems((json.data as SentItem[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setSentItems([]);
      })
      .finally(() => {
        if (!cancelled) setSentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, sentChannel]);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    <div className="flex flex-col h-[calc(100vh-56px)] bg-white">
      {/* Top tabs */}
      <div className="border-b border-gray-200 px-5 pt-3 bg-white">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTab('inbox')}
            className={cn(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5',
              tab === 'inbox'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-900',
            )}
          >
            <Inbox className="w-4 h-4" /> Inbox
            {totalUnread > 0 && (
              <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                {totalUnread}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('sent')}
            className={cn(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5',
              tab === 'sent'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-900',
            )}
          >
            <Send className="w-4 h-4" /> Sent
          </button>
        </div>
      </div>

      {tab === 'sent' ? (
        <SentView
          items={sentItems}
          loading={sentLoading}
          channel={sentChannel}
          onChannelChange={setSentChannel}
        />
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Left pane — conversation list */}
          <aside className="w-80 border-r border-gray-200 flex flex-col bg-white">
            <div className="px-4 py-3 border-b border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h1 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  Inbox
                  {totalUnread > 0 && (
                    <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                      {totalUnread}
                    </span>
                  )}
                </h1>
                <div className="flex bg-gray-100 border border-gray-200 rounded-md p-0.5 text-[10px] font-medium">
                  <button
                    onClick={() => setFilter('open')}
                    className={cn(
                      'px-2 py-0.5 rounded',
                      filter === 'open' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500',
                    )}
                  >
                    Open
                  </button>
                  <button
                    onClick={() => setFilter('all')}
                    className={cn(
                      'px-2 py-0.5 rounded',
                      filter === 'all' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500',
                    )}
                  >
                    All
                  </button>
                </div>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="w-full bg-white border border-gray-300 focus:border-blue-500 outline-none rounded-md pl-8 pr-2 py-1.5 text-xs text-gray-900 placeholder-gray-400 transition-colors"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-8 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="p-8 text-center">
                  <MessageSquare className="w-10 h-10 text-gray-300 mx-auto mb-2" />
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
                          ? 'bg-blue-50 border-l-blue-600'
                          : 'border-l-transparent hover:bg-gray-50',
                      )}
                    >
                      <div className="relative shrink-0">
                        <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-xs font-semibold text-white">
                          {initial}
                        </div>
                        <div
                          className={cn(
                            'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white',
                            STATUS_DOT[c.status],
                          )}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-gray-900 truncate">{name}</span>
                          <span className="text-[10px] text-gray-500 shrink-0">
                            {relativeTime(c.last_message_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-[11px] text-gray-500 truncate">
                            {c.last_message?.body ?? 'No messages yet'}
                          </span>
                          {c.unread_count > 0 && (
                            <span className="text-[10px] font-semibold bg-blue-600 text-white px-1.5 py-0.5 rounded-full shrink-0">
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
          <section className="flex-1 flex flex-col bg-white">
            {!selectedConversation ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <Inbox className="w-12 h-12 text-gray-300 mb-3" />
                <p className="text-sm text-gray-700 font-medium">Select a conversation</p>
                <p className="text-xs text-gray-500 mt-1 max-w-xs">
                  Choose a conversation from the left to view messages and reply.
                </p>
              </div>
            ) : (
              <>
                {/* Header */}
                <header className="h-14 px-5 border-b border-gray-200 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">
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
                    className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800 bg-white border border-emerald-200 hover:border-emerald-300 rounded-md px-2.5 py-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Resolve
                  </button>
                  <div className="relative" ref={escalateRef}>
                    <button
                      onClick={() => setEscalateOpen((v) => !v)}
                      disabled={escalating}
                      className="flex items-center gap-1.5 text-xs font-medium text-orange-700 hover:text-orange-800 bg-white border border-orange-200 hover:border-orange-300 rounded-md px-2.5 py-1 transition-colors disabled:opacity-50"
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
                      <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                        <div className="px-3 py-2 border-b border-gray-200">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                            Assign escalation to
                          </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto py-1">
                          {admins.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-gray-500">
                              <Loader2 className="w-4 h-4 text-gray-400 animate-spin mx-auto" />
                            </div>
                          ) : (
                            admins.map((a) => (
                              <button
                                key={a.id}
                                onClick={() => handleEscalate(a.id)}
                                disabled={escalating}
                                className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-medium text-gray-900 truncate">
                                    {a.email}
                                    {a.is_self && (
                                      <span className="ml-1.5 text-[9px] font-semibold text-blue-600">
                                        (you)
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-gray-500">{a.role}</div>
                                </div>
                                {selectedConversation?.assigned_to === a.id && (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
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
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"
                  >
                    Contact <ExternalLink className="w-3 h-3" />
                  </Link>
                </header>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-gray-50">
                  {messagesLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center text-xs text-gray-500 py-10">
                      No messages in this conversation yet.
                    </div>
                  ) : (
                    messages.map((m) => {
                      if (m.direction === 'internal') {
                        return (
                          <div key={m.id} className="flex justify-center">
                            <div className="max-w-md bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2 text-xs">
                              <div className="flex items-center gap-1.5 text-yellow-700 font-medium mb-0.5">
                                <StickyNote className="w-3 h-3" /> Internal note
                              </div>
                              <div className="text-yellow-900 whitespace-pre-wrap">{m.body}</div>
                              <div className="text-[10px] text-yellow-600/70 mt-1 text-right">
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
                                  : 'bg-white border border-gray-200 text-gray-900 rounded-2xl rounded-tl-sm',
                              )}
                            >
                              {m.body}
                            </div>
                            <div
                              className={cn(
                                'text-[10px] text-gray-500 mt-1 px-2',
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
                <div className="border-t border-gray-200 px-5 py-3 bg-white">
                  <div className="flex bg-gray-100 border border-gray-200 rounded-md p-0.5 mb-2 w-fit text-[10px] font-medium">
                    <button
                      onClick={() => setReplyMode('sms')}
                      className={cn(
                        'px-2.5 py-1 rounded flex items-center gap-1',
                        replyMode === 'sms' ? 'bg-blue-600 text-white' : 'text-gray-600',
                      )}
                    >
                      <MessageSquare className="w-3 h-3" /> Reply via SMS
                    </button>
                    <button
                      onClick={() => setReplyMode('note')}
                      className={cn(
                        'px-2.5 py-1 rounded flex items-center gap-1',
                        replyMode === 'note' ? 'bg-yellow-500 text-white' : 'text-gray-600',
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
                      className="flex-1 bg-white border border-gray-300 focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none transition-colors"
                    />
                    <button
                      onClick={handleSend}
                      disabled={!reply.trim() || sending}
                      className={cn(
                        'p-2.5 rounded-lg text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
                        replyMode === 'note'
                          ? 'bg-yellow-500 hover:bg-yellow-600'
                          : 'bg-blue-600 hover:bg-blue-700',
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
                  <div className="text-[10px] text-gray-500 mt-1">
                    Press Enter to send · Shift+Enter for newline
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function SentView({
  items,
  loading,
  channel,
  onChannelChange,
}: {
  items: SentItem[];
  loading: boolean;
  channel: 'all' | 'email' | 'sms';
  onChannelChange: (c: 'all' | 'email' | 'sms') => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Sent Messages</h2>
        <div className="flex bg-gray-100 border border-gray-200 rounded-md p-0.5 text-xs font-medium">
          {(['all', 'email', 'sms'] as const).map((c) => (
            <button
              key={c}
              onClick={() => onChannelChange(c)}
              className={cn(
                'px-2.5 py-1 rounded capitalize',
                channel === c ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500',
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-20 text-center">
          <Send className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-700 font-medium">No sent messages yet</p>
          <p className="text-xs text-gray-500 mt-1">
            Sent emails and SMS messages will appear here.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Channel</th>
                <th className="px-4 py-3 text-left">Subject / Preview</th>
                <th className="px-4 py-3 text-left">Sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {items.map((ev) => {
                const isEmail = ev.event_type === 'email_sent';
                const contact = ev.contact;
                const name = contact
                  ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') ||
                    contact.email ||
                    contact.phone ||
                    'Unknown'
                  : '(deleted contact)';
                const data = ev.event_data ?? {};
                const subject =
                  (data.subject as string) ||
                  (data.body as string) ||
                  (data.preview as string) ||
                  (isEmail ? 'Email sent' : 'SMS sent');
                return (
                  <tr key={ev.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      {contact ? (
                        <Link
                          href={`/admin/crm/contacts/${contact.id}`}
                          className="text-gray-900 hover:text-blue-700 font-medium"
                        >
                          {name}
                        </Link>
                      ) : (
                        <span className="text-gray-500">{name}</span>
                      )}
                      {contact?.email && (
                        <div className="text-xs text-gray-500">{contact.email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full',
                          isEmail
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-purple-50 text-purple-700',
                        )}
                      >
                        {isEmail ? (
                          <Mail className="w-3 h-3" />
                        ) : (
                          <MessageSquare className="w-3 h-3" />
                        )}
                        {isEmail ? 'Email' : 'SMS'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 truncate max-w-md">{subject}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs tabular-nums">
                      {formatTimestamp(ev.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
