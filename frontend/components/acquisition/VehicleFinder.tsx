"use client";

// components/acquisition/VehicleFinder.tsx
// Conversational vehicle finder — 7 scripted questions delivered as a chat
// bubble UI. The backend at /api/finder owns the question script, the AI
// extraction (llama-3.1-8b-instant), scoring (gpt-oss-120b), and the
// outbound founder + Claude-Haiku-drafted buyer SMS. This component is
// purely presentational state.

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
  return `vf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function describeVehicle(d: ExtractedShape): string {
  const v = [d.make, d.model].filter(Boolean).join(" ").trim();
  return v || d.vehicleType || "your vehicle";
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
        className="flex flex-col w-full max-h-[520px] min-h-[320px] border border-gray-200 rounded-2xl bg-white overflow-hidden shadow-sm"
        data-testid="vehicle-finder-complete"
      >
        <div className="flex flex-col items-center justify-center p-8 text-center space-y-4 flex-1">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-6 h-6 text-green-600"
              aria-hidden
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h3 className="font-semibold text-gray-900 text-lg">You are all set!</h3>
          <p className="text-sm text-gray-500 max-w-md">
            Dealers near {zip} will compete for your {vehicle} within 48
            hours. Watch for a text from AutoLenis.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-full max-h-[520px] min-h-[320px] border border-gray-200 rounded-2xl bg-white overflow-hidden shadow-sm"
      data-testid="vehicle-finder"
    >
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) =>
          m.role === "ai" ? (
            <div key={i} className="flex justify-start">
              <div className="max-w-[85%] bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] bg-blue-600 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-white">
                {m.text}
              </div>
            </div>
          ),
        )}
        {isLoading && (
          <div className="flex justify-start" aria-label="AutoLenis is typing">
            <div className="max-w-[85%] bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
              <span className="inline-flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse [animation-delay:0ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 p-3 flex gap-2 items-center bg-white">
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your answer..."
          disabled={isLoading}
          className="flex-1 border border-gray-200 rounded-full px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="vehicle-finder-input"
        />
        <button
          onClick={() => void send()}
          disabled={isLoading || !inputValue.trim()}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-full px-5 py-2 text-sm font-medium disabled:opacity-40"
          data-testid="vehicle-finder-send"
        >
          Send
        </button>
      </div>
    </div>
  );
}
