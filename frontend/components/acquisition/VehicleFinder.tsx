"use client";

import { logger } from "@/lib/logger";
// components/acquisition/VehicleFinder.tsx
// Streaming AI concierge chat. Posts each user turn to /api/concierge and
// renders the response token-by-token as it streams in. Structured buyer
// data extraction, lead scoring, and SMS dispatch all run server-side in
// parallel with the stream — the UI is purely presentational.

import { useState, useEffect, useRef } from "react";
import { Send, CheckCircle2 } from "lucide-react";

interface Message {
  role: "ai" | "user";
  content: string;
}

const INITIAL_MESSAGE =
  "Hey there. I'm AutoLenis — I help people get dealers to compete for their next car. What kind of vehicle are you looking for?";

export default function VehicleFinder() {
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [isComplete, setIsComplete] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSessionId(crypto.randomUUID());
    setMessages([{ role: "ai", content: INITIAL_MESSAGE }]);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const handleSend = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming || !sessionId) return;

    const userMsg: Message = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsStreaming(true);
    setStreamingText("");

    try {
      const response = await fetch("/api/concierge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, userMessage: trimmed }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Stream failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;
        setStreamingText(accumulated);
      }

      setMessages((prev) => [...prev, { role: "ai", content: accumulated }]);
      setStreamingText("");

      if (
        accumulated.toLowerCase().includes("start finding dealers") ||
        accumulated.toLowerCase().includes("competing offers")
      ) {
        setIsComplete(true);
      }
    } catch (err) {
      logger.error("[VehicleFinder] Error:", err);
      setMessages((prev) => [
        ...prev,
        { role: "ai", content: "Sorry, something went wrong. Please try again." },
      ]);
      setStreamingText("");
    } finally {
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (isComplete) {
    return (
      <div
        className="flex flex-col items-center justify-center p-8 text-center space-y-4 border border-gray-200 rounded-2xl bg-white shadow-sm min-h-[400px]"
        data-testid="vehicle-finder-complete"
      >
        <CheckCircle2 className="w-16 h-16 text-green-600" strokeWidth={1.5} />
        <h3 className="font-semibold text-gray-900 text-xl">You&apos;re all set</h3>
        <p className="text-sm text-gray-500 max-w-md">
          We&apos;re finding dealers near you and putting them in competition for
          your business. Watch for a text from AutoLenis shortly.
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-full max-h-[600px] min-h-[400px] border border-gray-200 rounded-2xl bg-white overflow-hidden shadow-sm"
      data-testid="vehicle-finder"
    >
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                msg.role === "user"
                  ? "max-w-[85%] bg-blue-600 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-white"
                  : "max-w-[85%] bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 whitespace-pre-wrap"
              }
            >
              {msg.content}
            </div>
          </div>
        ))}

        {streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 whitespace-pre-wrap">
              {streamingText}
              <span className="inline-block w-2 h-4 ml-1 bg-gray-400 animate-pulse" />
            </div>
          </div>
        )}

        {isStreaming && !streamingText && (
          <div className="flex justify-start" aria-label="AutoLenis is typing">
            <div className="max-w-[85%] bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1">
                <span
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-gray-100 p-3 flex gap-2 items-center bg-white">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          placeholder="Type your answer..."
          className="flex-1 border border-gray-200 rounded-full px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          data-testid="vehicle-finder-input"
        />
        <button
          onClick={() => void handleSend()}
          disabled={isStreaming || !inputValue.trim()}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-full px-5 py-2 text-sm font-medium disabled:opacity-40 flex items-center gap-1"
          data-testid="vehicle-finder-send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
