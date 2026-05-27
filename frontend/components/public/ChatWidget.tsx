// System 16 ENH — AI Concierge ChatWidget
// Floating chat button → expandable panel
// Groq ONLY | Kill switch checked before every message | Context-aware per buyer journey stage
// Available in buyer portal + public homepage
// Public visitors (no buyerId) see a lead-capture form before chat begins.

"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2, Bot } from "lucide-react";

interface Message { role: "user" | "assistant"; content: string }

interface ChatWidgetProps {
  buyerId?: string;
  agentType?: "general" | "prequal" | "search" | "auction" | "deal";
  initialGreeting?: string;
  placeholder?: string;
  chatEndpoint?: string;
}

interface LeadErrors { firstName?: string; lastName?: string; phone?: string }

function validateLeadField(name: "firstName" | "lastName" | "phone", value: string): string {
  const v = value.trim();
  if (name === "firstName") return v ? "" : "First name is required";
  if (name === "lastName") return v ? "" : "Last name is required";
  // phone — required, US format
  if (!v) return "Phone is required";
  const digits = v.replace(/\D/g, "");
  if (digits.length === 10 || (digits.length === 11 && digits[0] === "1")) return "";
  return "Enter a valid US phone number";
}

export default function ChatWidget({
  buyerId,
  agentType = "general",
  initialGreeting = "Hi! I'm Zura, your AutoLenis concierge. How can I help you today?",
  placeholder = "Ask me anything about buying your car…",
  chatEndpoint,
}: ChatWidgetProps) {
  const isPublic = !buyerId;

  // Authenticated buyers hit the buyer concierge; everyone else (no buyerId)
  // hits the public concierge. An explicit chatEndpoint (admin/dealer/affiliate
  // portals) always wins.
  const endpoint = chatEndpoint ?? (buyerId ? "/api/buyer/ai/chat" : "/api/public/ai/chat");

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: initialGreeting },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Lead capture (public visitors only)
  const [leadCaptured, setLeadCaptured] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [leadMessage, setLeadMessage] = useState("");
  const [leadErrors, setLeadErrors] = useState<LeadErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // Unread badge on the floating button
  const [showUnread, setShowUnread] = useState(false);

  // Show the lead form only to public visitors who haven't captured yet.
  const showLeadForm = isPublic && !leadCaptured;

  useEffect(() => {
    try {
      if (sessionStorage.getItem("al_chat_lead_captured") === "true") setLeadCaptured(true);
      if (sessionStorage.getItem("al_chat_opened") !== "true") setShowUnread(true);
    } catch { /* sessionStorage unavailable — fall back to defaults */ }
  }, []);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) {
      setShowUnread(false);
      try { sessionStorage.setItem("al_chat_opened", "true"); } catch { /* ignore */ }
    }
  }

  // Sending accepts an explicit message + base history so the lead form can
  // auto-send the visitor's typed message right after transitioning to chat,
  // without waiting on async `messages` state to settle.
  async function sendMessage(text?: string, base?: Message[]) {
    const userMsg = (text ?? input).trim();
    if (!userMsg || loading) return;
    if (text === undefined) setInput("");
    setLoading(true);

    const baseMessages = base ?? messages;
    const newMessages: Message[] = [...baseMessages, { role: "user", content: userMsg }];
    setMessages(newMessages);

    try {
      const history = newMessages.slice(-8, -1).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          history,
          agentType,
          ...(buyerId && { buyerId }),
        }),
      });

      if (res.status === 503) {
        setMessages([...newMessages, { role: "assistant", content: "The concierge is temporarily unavailable. Please try again later." }]);
        setLoading(false);
        return;
      }

      const data = await res.json() as { success?: boolean; data?: { content: string }; error?: { code: string } };

      if (res.ok && data.success && data.data) {
        setMessages([...newMessages, { role: "assistant", content: data.data.content }]);
      } else if (data.error?.code === "AI_DISABLED") {
        setMessages([...newMessages, { role: "assistant", content: "The AI concierge is temporarily unavailable. Please contact support@autolenis.com for assistance." }]);
      } else {
        setMessages([...newMessages, { role: "assistant", content: "I'm having trouble right now. Please try again in a moment." }]);
      }
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "Connection error. Please check your connection and try again." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleLeadSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errs: LeadErrors = {
      firstName: validateLeadField("firstName", firstName),
      lastName: validateLeadField("lastName", lastName),
      phone: validateLeadField("phone", phone),
    };
    if (errs.firstName || errs.lastName || errs.phone) {
      setLeadErrors(errs);
      return;
    }

    setSubmitting(true);

    // Fire-and-forget partial-lead capture. Never awaited and errors are
    // swallowed — a CRM hiccup must never block the visitor from chatting.
    fetch("/api/public/crm/partial-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        source: "chat-widget",
      }),
    }).catch(() => {});

    try { sessionStorage.setItem("al_chat_lead_captured", "true"); } catch { /* ignore */ }

    const fn = firstName.trim();
    const greeting: Message = {
      role: "assistant",
      content: `Hi ${fn}! I am Zura, your AutoLenis concierge. How can I help you find your next vehicle today?`,
    };
    setMessages([greeting]);
    setLeadCaptured(true);
    setSubmitting(false);

    // If the visitor typed a message in the form, send it as the first message.
    const typed = leadMessage.trim();
    if (typed) sendMessage(typed, [greeting]);
  }

  function fieldClass(err?: string) {
    return `w-full text-sm rounded-lg border px-3 py-2 outline-none text-slate-800 placeholder:text-slate-400 ${
      err ? "border-red-400 focus:border-red-500" : "border-slate-200 focus:border-[#0B5FD1]"
    }`;
  }

  return (
    <div className="fixed bottom-6 right-6 z-50" data-testid="chat-widget">
      {/* Chat panel */}
      {open && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-80 sm:w-96 flex flex-col overflow-hidden mb-4"
          style={{ height: "480px" }} data-testid="chat-panel">
          {/* Header */}
          <div className="bg-[#0B5FD1] px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Bot size={16} className="text-white" />
              </div>
              <div>
                <p className="text-white text-sm font-semibold">Zura</p>
                <p className="text-white/60 text-xs">AutoLenis Concierge</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/60 hover:text-white" data-testid="close-chat-btn">
              <X size={18} />
            </button>
          </div>

          {showLeadForm ? (
            /* Lead capture form — first screen for public visitors */
            <form onSubmit={handleLeadSubmit} className="flex-1 overflow-y-auto px-4 py-4 space-y-3" data-testid="chat-lead-form">
              <p className="text-sm text-slate-700 leading-relaxed">
                Hi there! I am Zura 👋 Before we chat, let me grab a few quick details so I can better help you.
              </p>

              <div>
                <input
                  type="text"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  onBlur={() => setLeadErrors(p => ({ ...p, firstName: validateLeadField("firstName", firstName) }))}
                  placeholder="First name *"
                  data-testid="lead-first-name"
                  className={fieldClass(leadErrors.firstName)}
                />
                {leadErrors.firstName && (
                  <p className="text-xs text-red-600 mt-1" data-testid="lead-first-name-error">{leadErrors.firstName}</p>
                )}
              </div>

              <div>
                <input
                  type="text"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  onBlur={() => setLeadErrors(p => ({ ...p, lastName: validateLeadField("lastName", lastName) }))}
                  placeholder="Last name *"
                  data-testid="lead-last-name"
                  className={fieldClass(leadErrors.lastName)}
                />
                {leadErrors.lastName && (
                  <p className="text-xs text-red-600 mt-1" data-testid="lead-last-name-error">{leadErrors.lastName}</p>
                )}
              </div>

              <div>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  onBlur={() => setLeadErrors(p => ({ ...p, phone: validateLeadField("phone", phone) }))}
                  placeholder="Phone *"
                  data-testid="lead-phone"
                  className={fieldClass(leadErrors.phone)}
                />
                {leadErrors.phone && (
                  <p className="text-xs text-red-600 mt-1" data-testid="lead-phone-error">{leadErrors.phone}</p>
                )}
              </div>

              <div>
                <textarea
                  rows={3}
                  value={leadMessage}
                  onChange={e => setLeadMessage(e.target.value)}
                  placeholder="What vehicle are you looking for?"
                  data-testid="lead-message"
                  className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-[#0B5FD1] text-slate-800 placeholder:text-slate-400 resize-none"
                />
              </div>

              <p className="text-[10px] leading-snug text-slate-400" data-testid="lead-consent">
                By submitting, you authorize AutoLenis, LLC to text/call the number above for informational and transactional messages, possibly using automated means. Msg and data rates may apply. Message frequency varies. Consent is not a condition of purchase. Text HELP for help and STOP to unsubscribe.
              </p>

              <button
                type="submit"
                disabled={submitting}
                data-testid="lead-submit-btn"
                className="bg-[#0B5FD1] text-white rounded-lg py-3 w-full text-sm font-semibold hover:bg-[#0A4DB8] transition-colors disabled:opacity-60"
              >
                {submitting ? "Starting chat..." : "Start Chat →"}
              </button>
            </form>
          ) : (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" data-testid="chat-messages">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    data-testid={`chat-msg-${i}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-[#0B5FD1] text-white rounded-br-sm"
                        : "bg-slate-100 text-slate-800 rounded-bl-sm"
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start" data-testid="chat-loading">
                    <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                      <Loader2 size={14} className="text-slate-400 animate-spin" />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="shrink-0 border-t border-slate-100 px-3 py-2.5 flex items-center gap-2" data-testid="chat-input-area">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  data-testid="chat-input"
                  className="flex-1 text-sm outline-none placeholder:text-slate-400 text-slate-800 bg-transparent"
                  disabled={loading}
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || loading}
                  data-testid="chat-send-btn"
                  className="w-8 h-8 rounded-full bg-[#0B5FD1] text-white flex items-center justify-center disabled:opacity-40 hover:bg-[#0A4DB8] transition-colors shrink-0"
                >
                  <Send size={13} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Floating button */}
      <div className="relative inline-block">
        <button
          onClick={toggleOpen}
          data-testid="chat-toggle-btn"
          className="w-14 h-14 rounded-full bg-[#0B5FD1] text-white shadow-lg flex items-center justify-center hover:bg-[#0A4DB8] transition-all hover:scale-105 active:scale-95"
        >
          {open ? <X size={22} /> : <MessageCircle size={22} />}
        </button>
        {showUnread && !open && (
          <span
            data-testid="chat-unread-badge"
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center pointer-events-none"
          >
            1
          </span>
        )}
      </div>
    </div>
  );
}
