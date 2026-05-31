"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2, Bot } from "lucide-react";
import { isAiEnabled } from "@/lib/ai/kill-switch";

interface Message { role: "user" | "assistant"; content: string }

interface ChatWidgetProps {
  buyerId?: string;
  agentType?: "general" | "prequal" | "search" | "auction" | "deal";
  initialGreeting?: string;
  placeholder?: string;
  // Optional override for admin/dealer/affiliate portals that hit their own
  // authenticated chat endpoints. When set (and buyerId is not), the widget
  // posts JSON to this endpoint instead of streaming /api/concierge.
  chatEndpoint?: string;
}

const PUBLIC_GREETING =
  "Hey there. I'm Zura — I help people get dealers to compete for their next car. What kind of vehicle are you looking for?";

const PUBLIC_PLACEHOLDER = "Tell me what you're looking for...";

export default function ChatWidget({
  buyerId,
  agentType = "general",
  initialGreeting,
  placeholder,
  chatEndpoint,
}: ChatWidgetProps) {
  // Public concierge path (streaming) only when no buyerId AND no explicit
  // endpoint override. Authenticated portals (admin/dealer/affiliate) supply
  // chatEndpoint to keep their existing JSON-response behavior.
  const useStreaming = !buyerId && !chatEndpoint;
  const isPublic = useStreaming;

  const greeting = initialGreeting ?? (isPublic
    ? PUBLIC_GREETING
    : "Hi! I'm Alex, your AutoLenis concierge. How can I help you today?"
  );

  const placeholderText = placeholder ?? (isPublic
    ? PUBLIC_PLACEHOLDER
    : "Ask me anything about buying your car…"
  );

  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: greeting },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Lead gate (public mode only)
  const [leadGatePassed, setLeadGatePassed] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadError, setLeadError] = useState("");
  const isFirstMessageRef = useRef(true);

  // Initialize session ID for public mode
  useEffect(() => {
    if (isPublic) {
      setSessionId(crypto.randomUUID());
    }
    setAiAvailable(isAiEnabled());
  }, [isPublic]);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  async function sendMessage() {
    if (!input.trim() || loading || streaming || !aiAvailable) return;
    if (isPublic && !sessionId) return;

    const userMsg = input.trim();
    setInput("");
    setLoading(true);

    const newMessages: Message[] = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);

    if (useStreaming) {
      // ─── PUBLIC CONCIERGE — STREAMING ───────────────────
      const isFirstMessage = isFirstMessageRef.current;
      isFirstMessageRef.current = false;

      try {
        const response = await fetch("/api/concierge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            userMessage: userMsg,
            ...(isFirstMessage && {
              firstName: leadName.trim(),
              email: leadEmail.trim().toLowerCase(),
            }),
          }),
        });

        if (!response.ok || !response.body) {
          setMessages([
            ...newMessages,
            { role: "assistant", content: "I'm having trouble responding right now. Please try again." },
          ]);
          setLoading(false);
          return;
        }

        setLoading(false);
        setStreaming(true);

        // Add empty assistant message we'll fill in
        const baseMessages = newMessages;
        setMessages([...baseMessages, { role: "assistant", content: "" }]);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            accumulated += chunk;

            // Update the last message with streamed content
            setMessages([
              ...baseMessages,
              { role: "assistant", content: accumulated },
            ]);
          }
        } finally {
          reader.releaseLock();
        }

        setStreaming(false);

      } catch (err) {
        console.error("[ChatWidget public stream]", err);
        setMessages([
          ...newMessages,
          { role: "assistant", content: "Connection error. Please check your connection and try again." },
        ]);
        setLoading(false);
        setStreaming(false);
      }

    } else {
      // ─── AUTHENTICATED BUYER / PORTAL — EXISTING BEHAVIOR ────────
      try {
        const history = newMessages.slice(-8, -1).map(m => ({
          role: m.role,
          content: m.content,
        }));

        const endpoint = chatEndpoint ?? "/api/buyer/ai/chat";
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

        const data = await res.json() as {
          success?: boolean;
          data?: { content: string };
          error?: { code: string };
        };

        if (res.ok && data.success && data.data) {
          setMessages([...newMessages, { role: "assistant", content: data.data.content }]);
        } else if (data.error?.code === "AI_DISABLED") {
          setAiAvailable(false);
          setMessages([
            ...newMessages,
            { role: "assistant", content: "The AI concierge is temporarily unavailable. Please contact support@autolenis.com for assistance." },
          ]);
        } else {
          setMessages([
            ...newMessages,
            { role: "assistant", content: "I'm having trouble right now. Please try again in a moment." },
          ]);
        }
      } catch {
        setMessages([
          ...newMessages,
          { role: "assistant", content: "Connection error. Please check your connection and try again." },
        ]);
      } finally {
        setLoading(false);
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleLeadSubmit() {
    const name = leadName.trim();
    const email = leadEmail.trim().toLowerCase();

    if (!name) {
      setLeadError("Please enter your name");
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setLeadError("Please enter a valid email address");
      return;
    }

    setLeadError("");
    setLeadGatePassed(true);

    setMessages([
      {
        role: "assistant",
        content: `Hey ${name.split(" ")[0]}. I'm Zura — I help people get dealers to compete for their next car. What kind of vehicle are you looking for?`,
      },
    ]);
  }

  if (!aiAvailable && !open) return null;

  const busy = loading || streaming;

  return (
    <div className="fixed bottom-6 right-6 z-50" data-testid="chat-widget">
      {/* Chat panel */}
      {open && (
        <div
          className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-80 sm:w-96 flex flex-col overflow-hidden mb-4"
          style={{ height: "520px" }}
          data-testid="chat-panel"
        >
          {/* Header */}
          <div className="bg-[#0B5FD1] px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Bot size={16} className="text-white" />
              </div>
              <div>
                <p className="text-white text-sm font-semibold">
                  {isPublic ? "Zura" : "AutoLenis"}
                </p>
                <p className="text-white/60 text-xs">
                  {isPublic ? "AutoLenis Concierge" : "Your Concierge"}
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-white/60 hover:text-white"
              data-testid="close-chat-btn"
              aria-label="Close chat"
            >
              <X size={18} />
            </button>
          </div>

          {/* Lead gate (public mode only, shown before first message) */}
          {isPublic && !leadGatePassed ? (
            <div
              className="flex flex-col items-center justify-center flex-1 p-6 text-center space-y-4"
              data-testid="lead-gate"
            >
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                <Bot size={22} className="text-[#0B5FD1]" />
              </div>

              <div>
                <p className="font-semibold text-slate-900 text-base mb-1">
                  Let&apos;s get you the best deal
                </p>
                <p className="text-xs text-slate-500 max-w-xs">
                  Tell me your name and email so I can send you dealer offers
                  directly.
                </p>
              </div>

              <div className="w-full max-w-xs space-y-2">
                <input
                  type="text"
                  value={leadName}
                  onChange={(e) => setLeadName(e.target.value)}
                  placeholder="Your name"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0B5FD1]"
                  data-testid="lead-name-input"
                />

                <input
                  type="email"
                  value={leadEmail}
                  onChange={(e) => setLeadEmail(e.target.value)}
                  placeholder="Email address"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0B5FD1]"
                  data-testid="lead-email-input"
                />

                {leadError && (
                  <p className="text-xs text-red-600 text-left">{leadError}</p>
                )}

                <button
                  onClick={handleLeadSubmit}
                  className="w-full bg-[#0B5FD1] hover:bg-[#0A4DB8] text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                  data-testid="lead-submit-btn"
                >
                  Start the conversation
                </button>
              </div>

              <p className="text-[10px] text-slate-400 max-w-xs">
                By continuing you agree to receive messages from AutoLenis. We
                never share your info.
              </p>
            </div>
          ) : (
          <>
          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
            data-testid="chat-messages"
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                data-testid={`chat-msg-${i}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-[#0B5FD1] text-white rounded-tr-sm"
                      : "bg-slate-100 text-slate-800 rounded-tl-sm"
                  }`}
                >
                  {msg.content}
                  {streaming && i === messages.length - 1 && msg.role === "assistant" && (
                    <span className="inline-block w-2 h-4 ml-1 bg-slate-400 animate-pulse align-middle" />
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator (waiting for first token) */}
            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[85%] bg-slate-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                  <div className="flex gap-1">
                    <span
                      className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <span
                      className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-100 p-3 flex gap-2 items-center bg-white shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={busy}
              placeholder={placeholderText}
              className="flex-1 border border-slate-200 rounded-full px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0B5FD1] disabled:opacity-50"
              data-testid="chat-input"
            />
            <button
              onClick={sendMessage}
              disabled={busy || !input.trim()}
              className="bg-[#0B5FD1] hover:bg-[#0A4DB8] text-white rounded-full w-9 h-9 flex items-center justify-center disabled:opacity-40 transition-colors"
              data-testid="chat-send-btn"
              aria-label="Send message"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
          </>
          )}
        </div>
      )}

      {/* Floating launcher button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="bg-[#0B5FD1] hover:bg-[#0A4DB8] text-white rounded-full w-14 h-14 flex items-center justify-center shadow-xl transition-colors"
          data-testid="open-chat-btn"
          aria-label="Open chat"
        >
          <MessageCircle size={24} />
        </button>
      )}
    </div>
  );
}
