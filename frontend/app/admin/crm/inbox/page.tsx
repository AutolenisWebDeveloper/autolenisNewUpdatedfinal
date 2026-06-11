'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Inbox,
  MessageSquare,
  StickyNote,
  Send,
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
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  SearchField,
  StatusPill,
  Tabs,
  type Column,
  type Tone,
} from '@/components/admin/crm/ui';

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
  open: 'bg-[var(--crm-info)]',
  assigned: 'bg-[var(--crm-primary)]',
  escalated: 'bg-[var(--crm-danger)]',
  resolved: 'bg-[var(--crm-success)]',
};

const STATUS_TONE: Record<ConversationStatus, Tone> = {
  open: 'info',
  assigned: 'primary',
  escalated: 'danger',
  resolved: 'success',
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
    <div
      className="flex h-[calc(100vh-56px)] flex-col bg-[var(--crm-bg-primary)]"
      data-testid="crm-inbox"
    >
      {/* Top tabs */}
      <div className="border-b border-[var(--crm-border)] crm-hairline px-5 pt-3">
        <Tabs
          data-testid="crm-inbox-tabs"
          value={tab}
          onValueChange={(id) => setTab(id as 'inbox' | 'sent')}
          tabs={[
            { id: 'inbox', label: 'Inbox', count: totalUnread > 0 ? totalUnread : undefined },
            { id: 'sent', label: 'Sent' },
          ]}
        />
      </div>

      {tab === 'sent' ? (
        <SentView
          items={sentItems}
          loading={sentLoading}
          channel={sentChannel}
          onChannelChange={setSentChannel}
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Left pane — conversation list */}
          <aside className="flex w-80 flex-col border-r border-[var(--crm-border)] crm-hairline">
            <div className="border-b border-[var(--crm-border)] crm-hairline px-4 py-3">
              <div className="mb-3 flex items-center justify-between">
                <h1 className="flex items-center gap-2 text-[13px] font-medium text-[var(--crm-text-primary)]">
                  Inbox
                  {totalUnread > 0 && (
                    <Badge tone="primary" size="sm" data-testid="crm-inbox-unread">
                      {totalUnread}
                    </Badge>
                  )}
                </h1>
                <div className="flex rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] crm-hairline p-0.5 text-[11px] font-medium">
                  <button
                    onClick={() => setFilter('open')}
                    data-testid="crm-inbox-filter-open"
                    className={cn(
                      'rounded-[var(--crm-radius-sm)] px-2 py-0.5',
                      filter === 'open'
                        ? 'bg-[var(--crm-primary-subtle)] text-[var(--crm-primary)]'
                        : 'text-[var(--crm-text-tertiary)]',
                    )}
                  >
                    Open
                  </button>
                  <button
                    onClick={() => setFilter('all')}
                    data-testid="crm-inbox-filter-all"
                    className={cn(
                      'rounded-[var(--crm-radius-sm)] px-2 py-0.5',
                      filter === 'all'
                        ? 'bg-[var(--crm-primary-subtle)] text-[var(--crm-primary)]'
                        : 'text-[var(--crm-text-tertiary)]',
                    )}
                  >
                    All
                  </button>
                </div>
              </div>
              <div className="rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] crm-hairline">
                <SearchField
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  data-testid="crm-inbox-search"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--crm-primary)]" />
                </div>
              ) : filteredConversations.length === 0 ? (
                <EmptyState
                  icon={MessageSquare}
                  title="No conversations"
                  data-testid="crm-inbox-empty"
                />
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
                      data-testid="crm-inbox-conversation"
                      className={cn(
                        'flex w-full items-start gap-3 border-l-2 px-3 py-3 text-left transition-colors',
                        isActive
                          ? 'border-l-[var(--crm-primary)] bg-[var(--crm-primary-subtle)]'
                          : 'border-l-transparent hover:bg-[var(--crm-bg-secondary)]',
                      )}
                    >
                      <div className="relative shrink-0">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--crm-primary)] text-[12px] font-medium text-[var(--crm-on-primary)]">
                          {initial}
                        </div>
                        <div
                          className={cn(
                            'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--crm-bg-primary)]',
                            STATUS_DOT[c.status],
                          )}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-medium text-[var(--crm-text-primary)]">{name}</span>
                          <span className="shrink-0 text-[11px] text-[var(--crm-text-tertiary)]">
                            {relativeTime(c.last_message_at)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="truncate text-[12px] text-[var(--crm-text-tertiary)]">
                            {c.last_message?.body ?? 'No messages yet'}
                          </span>
                          {c.unread_count > 0 && (
                            <Badge tone="primary" size="sm" className="shrink-0">
                              {c.unread_count}
                            </Badge>
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
          <section className="flex flex-1 flex-col">
            {!selectedConversation ? (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon={Inbox}
                  title="Select a conversation"
                  description="Choose a conversation from the left to view messages and reply."
                  data-testid="crm-inbox-no-selection"
                />
              </div>
            ) : (
              <>
                {/* Header */}
                <header className="flex h-14 items-center gap-3 border-b border-[var(--crm-border)] crm-hairline px-5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-[var(--crm-text-primary)]">
                      {[selectedConversation.contact?.first_name, selectedConversation.contact?.last_name]
                        .filter(Boolean)
                        .join(' ') ||
                        selectedConversation.contact?.email ||
                        formatPhoneShort(selectedConversation.phone)}
                    </div>
                    <div className="truncate text-[12px] text-[var(--crm-text-tertiary)]">
                      {formatPhoneShort(selectedConversation.phone)}
                    </div>
                  </div>
                  <StatusPill
                    tone={STATUS_TONE[selectedConversation.status]}
                    size="sm"
                    className="capitalize"
                    data-testid="crm-inbox-status"
                  >
                    {selectedConversation.status}
                  </StatusPill>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleResolve}
                    disabled={selectedConversation.status === 'resolved'}
                    data-testid="crm-inbox-resolve"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                  </Button>
                  <div className="relative" ref={escalateRef}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEscalateOpen((v) => !v)}
                      disabled={escalating}
                      data-testid="crm-inbox-escalate"
                    >
                      {escalating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <AlertOctagon className="h-3.5 w-3.5" />
                      )}
                      Escalate
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                    {escalateOpen && (
                      <div className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)]">
                        <div className="border-b border-[var(--crm-border)] crm-hairline px-3 py-2">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--crm-text-tertiary)]">
                            Assign escalation to
                          </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto py-1">
                          {admins.length === 0 ? (
                            <div className="px-3 py-4 text-center">
                              <Loader2 className="mx-auto h-4 w-4 animate-spin text-[var(--crm-text-tertiary)]" />
                            </div>
                          ) : (
                            admins.map((a) => (
                              <button
                                key={a.id}
                                onClick={() => handleEscalate(a.id)}
                                disabled={escalating}
                                data-testid="crm-inbox-escalate-option"
                                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--crm-bg-secondary)] disabled:opacity-50"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-[13px] font-medium text-[var(--crm-text-primary)]">
                                    {a.email}
                                    {a.is_self && (
                                      <span className="ml-1.5 text-[11px] font-medium text-[var(--crm-primary)]">
                                        (you)
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-[var(--crm-text-tertiary)]">{a.role}</div>
                                </div>
                                {selectedConversation?.assigned_to === a.id && (
                                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--crm-success)]" />
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
                    data-testid="crm-inbox-contact-link"
                    className="flex items-center gap-1 text-[12px] text-[var(--crm-text-tertiary)] hover:text-[var(--crm-text-primary)]"
                  >
                    Contact <ExternalLink className="h-3 w-3" />
                  </Link>
                </header>

                {/* Messages */}
                <div className="flex-1 space-y-3 overflow-y-auto bg-[var(--crm-bg-secondary)] px-5 py-4">
                  {messagesLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="h-5 w-5 animate-spin text-[var(--crm-primary)]" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="py-10 text-center text-[12px] text-[var(--crm-text-tertiary)]">
                      No messages in this conversation yet.
                    </div>
                  ) : (
                    messages.map((m) => {
                      if (m.direction === 'internal') {
                        return (
                          <div key={m.id} className="flex justify-center">
                            <div className="max-w-md rounded-[var(--crm-radius-md)] border border-[var(--crm-warning-subtle)] bg-[var(--crm-warning-subtle)] px-4 py-2 text-[12px]">
                              <div className="mb-0.5 flex items-center gap-1.5 font-medium text-[var(--crm-warning)]">
                                <StickyNote className="h-3 w-3" /> Internal note
                              </div>
                              <div className="whitespace-pre-wrap text-[var(--crm-text-primary)]">{m.body}</div>
                              <div className="mt-1 text-right text-[11px] text-[var(--crm-text-tertiary)]">
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
                                'whitespace-pre-wrap px-4 py-2 text-[13px]',
                                isOutbound
                                  ? 'rounded-2xl rounded-tr-sm bg-[var(--crm-primary)] text-[var(--crm-on-primary)]'
                                  : 'rounded-2xl rounded-tl-sm border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] text-[var(--crm-text-primary)]',
                              )}
                            >
                              {m.body}
                            </div>
                            <div
                              className={cn(
                                'mt-1 px-2 text-[11px] text-[var(--crm-text-tertiary)]',
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
                <div className="border-t border-[var(--crm-border)] crm-hairline px-5 py-3">
                  <div className="mb-2 flex w-fit rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] crm-hairline p-0.5 text-[11px] font-medium">
                    <button
                      onClick={() => setReplyMode('sms')}
                      data-testid="crm-inbox-reply-sms"
                      className={cn(
                        'flex items-center gap-1 rounded-[var(--crm-radius-sm)] px-2.5 py-1',
                        replyMode === 'sms'
                          ? 'bg-[var(--crm-primary)] text-[var(--crm-on-primary)]'
                          : 'text-[var(--crm-text-secondary)]',
                      )}
                    >
                      <MessageSquare className="h-3 w-3" /> Reply via SMS
                    </button>
                    <button
                      onClick={() => setReplyMode('note')}
                      data-testid="crm-inbox-reply-note"
                      className={cn(
                        'flex items-center gap-1 rounded-[var(--crm-radius-sm)] px-2.5 py-1',
                        replyMode === 'note'
                          ? 'bg-[var(--crm-warning)] text-white'
                          : 'text-[var(--crm-text-secondary)]',
                      )}
                    >
                      <StickyNote className="h-3 w-3" /> Internal note
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
                      data-testid="crm-inbox-reply-input"
                      placeholder={
                        replyMode === 'note'
                          ? 'Write an internal note (not sent to contact)…'
                          : 'Reply via SMS…'
                      }
                      className="flex-1 resize-none rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] px-3 py-2 text-[13px] text-[var(--crm-text-primary)] outline-none placeholder:text-[var(--crm-text-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]"
                    />
                    <button
                      onClick={handleSend}
                      disabled={!reply.trim() || sending}
                      data-testid="crm-inbox-send"
                      className={cn(
                        'rounded-[var(--crm-radius-md)] p-2.5 text-white transition-colors disabled:cursor-not-allowed disabled:opacity-30',
                        replyMode === 'note'
                          ? 'bg-[var(--crm-warning)] hover:opacity-90'
                          : 'bg-[var(--crm-primary)] hover:bg-[var(--crm-primary-hover)]',
                      )}
                      aria-label="Send"
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--crm-text-tertiary)]">
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
  const columns: Column<SentItem>[] = [
    {
      id: 'contact',
      header: 'Contact',
      cell: (ev) => {
        const contact = ev.contact;
        const name = contact
          ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') ||
            contact.email ||
            contact.phone ||
            'Unknown'
          : '(deleted contact)';
        return (
          <div className="min-w-0">
            {contact ? (
              <Link
                href={`/admin/crm/contacts/${contact.id}`}
                className="font-medium text-[var(--crm-text-primary)] hover:text-[var(--crm-primary)]"
              >
                {name}
              </Link>
            ) : (
              <span className="text-[var(--crm-text-tertiary)]">{name}</span>
            )}
            {contact?.email && (
              <div className="truncate text-[12px] text-[var(--crm-text-tertiary)]">{contact.email}</div>
            )}
          </div>
        );
      },
    },
    {
      id: 'channel',
      header: 'Channel',
      cell: (ev) => {
        const isEmail = ev.event_type === 'email_sent';
        return (
          <Badge tone={isEmail ? 'info' : 'primary'} size="sm">
            {isEmail ? <Mail className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
            {isEmail ? 'Email' : 'SMS'}
          </Badge>
        );
      },
    },
    {
      id: 'subject',
      header: 'Subject / preview',
      cell: (ev) => {
        const isEmail = ev.event_type === 'email_sent';
        const data = ev.event_data ?? {};
        const subject =
          (data.subject as string) ||
          (data.body as string) ||
          (data.preview as string) ||
          (isEmail ? 'Email sent' : 'SMS sent');
        return <span className="block max-w-md truncate text-[var(--crm-text-secondary)]">{subject}</span>;
      },
    },
    {
      id: 'sent',
      header: 'Sent',
      align: 'right',
      sortable: true,
      sortValue: (ev) => new Date(ev.created_at).getTime(),
      cell: (ev) => (
        <span className="text-[12px] tabular-nums text-[var(--crm-text-tertiary)]">
          {formatTimestamp(ev.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-5" data-testid="crm-inbox-sent">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-medium text-[var(--crm-text-primary)]">Sent messages</h2>
        <div className="flex rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] crm-hairline p-0.5 text-[12px] font-medium">
          {(['all', 'email', 'sms'] as const).map((c) => (
            <button
              key={c}
              onClick={() => onChannelChange(c)}
              data-testid={`crm-inbox-sent-channel-${c}`}
              className={cn(
                'rounded-[var(--crm-radius-sm)] px-2.5 py-1 capitalize',
                channel === c
                  ? 'bg-[var(--crm-primary-subtle)] text-[var(--crm-primary)]'
                  : 'text-[var(--crm-text-tertiary)]',
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        data-testid="crm-inbox-sent-table"
        columns={columns}
        rows={items}
        getRowId={(ev) => ev.id}
        loading={loading}
        showDensityToggle={false}
        empty={
          <EmptyState
            icon={Send}
            title="No sent messages yet"
            description="Sent emails and SMS messages will appear here."
            data-testid="crm-inbox-sent-empty"
          />
        }
      />
    </div>
  );
}
