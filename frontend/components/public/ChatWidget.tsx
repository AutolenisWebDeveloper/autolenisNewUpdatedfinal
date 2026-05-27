// System 16 ENH — AI Concierge ChatWidget
// Floating chat button → expandable panel
// Groq ONLY | Kill switch checked before every message | Context-aware per buyer journey stage
// Available in buyer portal + public homepage
// Public visitors (no buyerId) see a premium lead-capture form before chat begins.

"use client";

import { useState, useRef, useEffect } from "react";
import {
  MessageCircle,
  X,
  Send,
  Loader2,
  Bot,
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Lock,
  Shield,
} from "lucide-react";

interface Message { role: "user" | "assistant"; content: string }

interface ChatWidgetProps {
  buyerId?: string;
  agentType?: "general" | "prequal" | "search" | "auction" | "deal";
  initialGreeting?: string;
  placeholder?: string;
  chatEndpoint?: string;
}

interface FormErrors { firstName?: string; lastName?: string; phone?: string }

// US phone validation — accepts common separators / optional country code.
const US_PHONE_RE = /^[\+]?[1]?[\s\-\.]?\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]\d{4}$/;

const QUICK_REPLIES = [
  "How does it work?",
  "Tell me about the $99 fee",
  "What vehicles can I request?",
  "Talk to a person",
];

const LABEL_CLASS = "text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block";

function inputClass(hasError?: string): string {
  return `w-full px-4 py-3 text-sm rounded-xl border text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-all duration-150 ${
    hasError
      ? "border-red-300 bg-red-50 focus:ring-red-200 focus:border-red-400"
      : "bg-slate-50 border-slate-200 focus:ring-[#0B5FD1]/20 focus:border-[#0B5FD1] focus:bg-white"
  }`;
}

function formatTime(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

  // Premium lead capture (public visitors only)
  const [screen, setScreen] = useState<"lead" | "chat">("lead");
  const [leadFirstName, setLeadFirstName] = useState("");
  const [leadLastName, setLeadLastName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadMessage, setLeadMessage] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  // Floating button state
  const [hasOpened, setHasOpened] = useState(false);
  const [showChips, setShowChips] = useState(true);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("al_chat_lead_captured") === "true") setScreen("chat");
      if (sessionStorage.getItem("al_chat_opened") === "true") setHasOpened(true);
    } catch { /* sessionStorage unavailable — fall back to defaults */ }
  }, []);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !hasOpened) {
      setHasOpened(true);
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

  function handleChipClick(text: string) {
    setShowChips(false);
    sendMessage(text);
  }

  function handleLeadSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errs: FormErrors = {};
    if (leadFirstName.trim().length < 2) errs.firstName = "Please enter your first name";
    if (leadLastName.trim().length < 2) errs.lastName = "Please enter your last name";
    if (!US_PHONE_RE.test(leadPhone.trim())) errs.phone = "Please enter a valid US phone number";

    if (errs.firstName || errs.lastName || errs.phone) {
      setFormErrors(errs);
      return;
    }
    setFormErrors({});
    setFormSubmitting(true);

    // Fire-and-forget partial-lead capture. Never awaited and errors are
    // swallowed — a CRM hiccup must never block the visitor from chatting.
    fetch("/api/public/crm/partial-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: leadFirstName.trim(),
        lastName: leadLastName.trim(),
        phone: leadPhone.trim(),
        source: "chat-widget",
      }),
    }).catch(() => {});

    try { sessionStorage.setItem("al_chat_lead_captured", "true"); } catch { /* ignore */ }

    const fn = leadFirstName.trim();
    const greeting: Message = {
      role: "assistant",
      content: `Hi ${fn}! I am Zura, your AutoLenis concierge. How can I help you find your next vehicle today?`,
    };
    setMessages([greeting]);
    setScreen("chat");
    setFormSubmitting(false);

    // If the visitor typed a message in the form, send it after the greeting renders.
    const typed = leadMessage.trim();
    if (typed) setTimeout(() => sendMessage(typed, [greeting]), 400);
  }

  // ─── Lead capture form screen ──────────────────────────────────────────────
  const formScreen = (
    <form onSubmit={handleLeadSubmit} className="h-full overflow-y-auto flex flex-col" data-testid="chat-lead-form">
      {/* Intro */}
      <div className="bg-gradient-to-b from-[#F0F6FF] to-white px-5 py-4 border-b border-slate-100">
        <div className="bg-white rounded-2xl rounded-tl-sm border border-slate-100 shadow-sm px-4 py-3 text-sm text-slate-700 leading-relaxed max-w-[85%]">
          Hi there! I&apos;m Zura 👋 Let me grab a few quick details so I can better assist you.
        </div>
        <p className="text-xs text-slate-400 mt-2 ml-1">Usually replies instantly</p>
      </div>

      {/* Fields */}
      <div className="px-5 pb-4 pt-3">
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 mb-3">
          <div>
            <label className={LABEL_CLASS}>First Name</label>
            <input
              type="text"
              value={leadFirstName}
              onChange={e => { setLeadFirstName(e.target.value); if (formErrors.firstName) setFormErrors(p => ({ ...p, firstName: undefined })); }}
              placeholder="John"
              data-testid="lead-first-name"
              className={inputClass(formErrors.firstName)}
            />
            {formErrors.firstName && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1" data-testid="lead-first-name-error">
                <AlertCircle size={11} />{formErrors.firstName}
              </p>
            )}
          </div>
          <div>
            <label className={LABEL_CLASS}>Last Name</label>
            <input
              type="text"
              value={leadLastName}
              onChange={e => { setLeadLastName(e.target.value); if (formErrors.lastName) setFormErrors(p => ({ ...p, lastName: undefined })); }}
              placeholder="Smith"
              data-testid="lead-last-name"
              className={inputClass(formErrors.lastName)}
            />
            {formErrors.lastName && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1" data-testid="lead-last-name-error">
                <AlertCircle size={11} />{formErrors.lastName}
              </p>
            )}
          </div>
        </div>

        <div className="mb-3">
          <label className={LABEL_CLASS}>Phone</label>
          <input
            type="tel"
            value={leadPhone}
            onChange={e => { setLeadPhone(e.target.value); if (formErrors.phone) setFormErrors(p => ({ ...p, phone: undefined })); }}
            placeholder="(555) 000-0000"
            data-testid="lead-phone"
            className={inputClass(formErrors.phone)}
          />
          {formErrors.phone && (
            <p className="text-xs text-red-500 mt-1 flex items-center gap-1" data-testid="lead-phone-error">
              <AlertCircle size={11} />{formErrors.phone}
            </p>
          )}
        </div>

        <div className="mb-3">
          <label className={LABEL_CLASS}>Message</label>
          <textarea
            rows={3}
            value={leadMessage}
            onChange={e => setLeadMessage(e.target.value)}
            placeholder="What vehicle are you looking for?"
            data-testid="lead-message"
            className="w-full px-4 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20 focus:border-[#0B5FD1] focus:bg-white transition-all duration-150 resize-none"
          />
        </div>

        {/* Trust row */}
        <div className="flex items-center justify-center gap-4 pb-3 mb-3 border-b border-slate-100">
          <span className="flex items-center gap-1 text-[10px] text-slate-500"><Lock size={10} />SSL Secured</span>
          <span className="flex items-center gap-1 text-[10px] text-slate-500"><CheckCircle size={10} />No Obligation</span>
          <span className="flex items-center gap-1 text-[10px] text-slate-500"><Shield size={10} />Privacy Protected</span>
        </div>

        <button
          type="submit"
          disabled={formSubmitting}
          data-testid="lead-submit-btn"
          className="w-full py-3.5 px-6 mb-3 bg-[#0B5FD1] hover:bg-[#0950B8] active:bg-[#0845A0] text-white font-semibold text-sm rounded-xl transition-all duration-150 shadow-sm hover:shadow-md disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {formSubmitting
            ? (<><Loader2 size={16} className="animate-spin" />Connecting...</>)
            : (<><ArrowRight size={16} />Start Chatting</>)}
        </button>
      </div>

      {/* Consent */}
      <p className="px-5 pb-5 text-[10px] text-slate-400 leading-relaxed text-center" data-testid="lead-consent">
        By submitting, you authorize AutoLenis LLC to contact you via text/call for informational messages using automated means. Msg and data rates may apply. Consent not required for purchase. Reply STOP to unsubscribe.
      </p>
    </form>
  );

  // ─── Chat screen ───────────────────────────────────────────────────────────
  const chatScreen = (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto bg-[#F8FAFC] px-4 py-4 min-h-0 space-y-3" data-testid="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`} data-testid={`chat-msg-${i}`}>
            <div className={`px-4 py-2.5 text-sm leading-relaxed max-w-[80%] shadow-sm rounded-2xl ${
              msg.role === "user"
                ? "bg-[#0B5FD1] text-white rounded-br-sm"
                : "bg-white text-slate-800 border border-slate-100 rounded-bl-sm"
            }`}>
              {msg.content}
            </div>
            <span className={`text-[10px] text-slate-400 mt-1 ${msg.role === "user" ? "mr-1" : "ml-1"}`}>
              {formatTime()}
            </span>
          </div>
        ))}

        {/* Quick reply chips — only below the first Zura message */}
        {isPublic && showChips && !loading && messages.length === 1 && messages[0].role === "assistant" && (
          <div className="flex gap-2 overflow-x-auto pb-1 mt-3" style={{ scrollbarWidth: "none" }} data-testid="chat-chips">
            {QUICK_REPLIES.map((chip, i) => (
              <button
                key={chip}
                type="button"
                onClick={() => handleChipClick(chip)}
                data-testid={`chat-chip-${i}`}
                className="bg-white border border-[#0B5FD1]/30 text-[#0B5FD1] text-xs font-medium rounded-full px-3 py-1.5 hover:bg-[#0B5FD1] hover:text-white cursor-pointer transition-colors whitespace-nowrap flex-shrink-0"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-start" data-testid="chat-loading">
            <div className="bg-white border border-slate-100 rounded-2xl rounded-bl-sm px-4 py-3 w-16">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block mx-0.5 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block mx-0.5 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block mx-0.5 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 bg-white border-t border-slate-100 px-4 py-3 flex items-center gap-3" data-testid="chat-input-area">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          data-testid="chat-input"
          className="flex-1 text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20 focus:border-[#0B5FD1] focus:bg-white placeholder:text-slate-400 transition-all duration-150"
          disabled={loading}
        />
        <button
          onClick={() => sendMessage()}
          disabled={!input.trim() || loading}
          data-testid="chat-send-btn"
          className="w-9 h-9 rounded-xl bg-[#0B5FD1] text-white flex items-center justify-center hover:bg-[#0950B8] transition-colors disabled:opacity-40 shrink-0"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="fixed z-50 bottom-6 right-6 max-sm:bottom-4 max-sm:right-3 max-sm:left-3 flex flex-col items-end"
      data-testid="chat-widget"
    >
      {/* Chat panel — always mounted so open/close can animate */}
      <div
        className={`mb-4 bg-white rounded-3xl overflow-hidden flex flex-col w-[380px] max-sm:w-[calc(100vw-24px)] ${
          isPublic && screen === "lead" ? "h-auto max-h-[600px]" : "h-[520px] max-sm:h-[480px]"
        } transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open
            ? "translate-y-0 opacity-100 scale-100 pointer-events-auto"
            : "translate-y-4 opacity-0 scale-95 pointer-events-none"
        }`}
        style={{ boxShadow: "0 25px 50px -12px rgba(11,95,209,0.25), 0 0 0 1px rgba(11,95,209,0.08)" }}
        data-testid="chat-panel"
      >
        {/* Header — both screens */}
        <div className="bg-[#0B5FD1] px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Bot size={18} className="text-white" />
            </div>
            <div>
              <p className="text-white text-sm font-semibold">Zura</p>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-green-400 rounded-full" />
                <span className="text-white/70 text-xs">Online</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 transition-colors flex items-center justify-center"
            data-testid="close-chat-btn"
          >
            <X size={16} className="text-white" />
          </button>
        </div>

        {/* Body — sliding track for public visitors, plain chat for buyers */}
        {isPublic ? (
          <div className="relative flex-1 overflow-hidden">
            <div
              className="flex h-full transition-transform duration-[250ms] ease-in-out"
              style={{ width: "200%", transform: screen === "chat" ? "translateX(-50%)" : "translateX(0)" }}
            >
              <div className="w-1/2 h-full">{formScreen}</div>
              <div className="w-1/2 h-full">{chatScreen}</div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">{chatScreen}</div>
        )}
      </div>

      {/* Floating button */}
      <div className="relative inline-flex">
        {!open && !hasOpened && (
          <span className="absolute inset-0 rounded-full bg-[#0B5FD1]/30 animate-ping" />
        )}
        <button
          onClick={toggleOpen}
          data-testid="chat-toggle-btn"
          className="relative w-14 h-14 rounded-full bg-[#0B5FD1] text-white shadow-lg shadow-[#0B5FD1]/40 flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-150 hover:shadow-xl hover:shadow-[#0B5FD1]/50"
        >
          {open ? <X size={22} /> : <MessageCircle size={22} />}
        </button>
        {!hasOpened && !open && (
          <span
            data-testid="chat-unread-badge"
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white pointer-events-none"
          >
            1
          </span>
        )}
      </div>
    </div>
  );
}
