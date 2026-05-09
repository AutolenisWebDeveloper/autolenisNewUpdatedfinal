// System 16 ENH — AI Concierge ChatWidget
// Floating chat button → expandable panel
// Groq ONLY | Kill switch checked before every message | Context-aware per buyer journey stage
// Available in buyer portal + public homepage

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

export default function ChatWidget({
  buyerId,
  agentType = "general",
  initialGreeting = "Hi! I'm Zura, your AutoLenis concierge. How can I help you today?",
  placeholder = "Ask me anything about buying your car…",
  chatEndpoint = "/api/buyer/ai/chat",
}: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: initialGreeting },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setLoading(true);

    const newMessages: Message[] = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);

    try {
      const history = newMessages.slice(-8, -1).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch(chatEndpoint, {
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
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              data-testid="chat-send-btn"
              className="w-8 h-8 rounded-full bg-[#0B5FD1] text-white flex items-center justify-center disabled:opacity-40 hover:bg-[#0A4DB8] transition-colors shrink-0"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        data-testid="chat-toggle-btn"
        className="w-14 h-14 rounded-full bg-[#0B5FD1] text-white shadow-lg flex items-center justify-center hover:bg-[#0A4DB8] transition-all hover:scale-105 active:scale-95"
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>
    </div>
  );
}
