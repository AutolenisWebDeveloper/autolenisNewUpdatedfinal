"use client";

// components/acquisition/VehicleFinder.tsx
// Conversational vehicle finder — 7 scripted questions delivered as a chat
// bubble UI. The backend at /api/finder owns the question script and the
// extraction/scoring logic; this component is purely presentational state.

import { useCallback, useEffect, useRef, useState } from "react";

const FIRST_QUESTION =
  "Are you looking to buy new, used, or are you open to both?";

interface ChatBubble {
  role: "ai" | "user";
  text: string;
}

interface ExtractedShape {
  vehicleType?: string | null;
  make?: string | null;
  model?: string | null;
  zip?: string | null;
}

interface FinderResponse {
  nextQuestion: string;
  extractedData: ExtractedShape;
  complete: boolean;
}

function generateSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments where crypto.randomUUID is unavailable.
  return `vf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function describeVehicle(d: ExtractedShape): string {
  const v = [d.make, d.model].filter(Boolean).join(" ").trim();
  return v || d.vehicleType || "vehicle";
}

export default function VehicleFinder() {
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<ChatBubble[]>([
    { role: "ai", text: FIRST_QUESTION },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [turnNumber, setTurnNumber] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedShape>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSessionId(generateSessionId());
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const send = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading || isComplete || !sessionId) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setInputValue("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/finder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, userMessage: text, turnNumber }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as FinderResponse;
      setMessages((prev) => [...prev, { role: "ai", text: data.nextQuestion }]);
      setExtractedData(data.extractedData ?? {});
      setTurnNumber((n) => n + 1);
      if (data.complete) setIsComplete(true);
    } catch (err) {
      console.error("[VehicleFinder] request failed", err);
      setMessages((prev) => [
        ...prev,
        { role: "ai", text: "Something went wrong. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, isComplete, sessionId, turnNumber]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  if (isComplete) {
    const vehicle = describeVehicle(extractedData);
    const zip = extractedData.zip ?? "your area";
    return (
      <div
        className="flex flex-col items-center justify-center text-center bg-white border border-gray-200 rounded-2xl shadow-sm p-8 min-h-[400px]"
        data-testid="vehicle-finder-complete"
      >
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-7 h-7 text-green-600"
            aria-hidden
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">You are all set!</h3>
        <p className="text-sm text-gray-600 max-w-md leading-relaxed">
          Dealers near {zip} will compete for your {vehicle} within 48 hours.
          Watch for a text from AutoLenis.
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full max-h-[500px] bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden"
      data-testid="vehicle-finder"
    >
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col"
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "ai"
                ? "self-start bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-2 max-w-[85%] text-sm text-gray-800"
                : "self-end bg-blue-600 rounded-2xl rounded-tr-sm px-4 py-2 max-w-[85%] text-sm text-white"
            }
          >
            {m.text}
          </div>
        ))}
        {isLoading && (
          <div
            className="self-start bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-2 max-w-[85%]"
            aria-label="AutoLenis is typing"
            data-testid="vehicle-finder-typing"
          >
            <span className="inline-flex gap-1">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:120ms]" />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:240ms]" />
            </span>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 bg-white border-t p-3 flex gap-2 items-center">
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your answer…"
          disabled={isLoading}
          className="flex-1 border rounded-full px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="vehicle-finder-input"
        />
        <button
          onClick={() => void send()}
          disabled={isLoading || !inputValue.trim()}
          className="bg-blue-600 text-white rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50"
          data-testid="vehicle-finder-send"
        >
          Send
        </button>
      </div>
    </div>
  );
}
