import { useState, useRef, useEffect } from "react";
import { Send, Check } from "lucide-react";

interface ChatSuggestion {
  text: string;
  target: "outline" | "scene";
  scene_num: number | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestion?: ChatSuggestion;
}

interface Props {
  phase: "input" | "outline" | "generating" | "review";
  messages: ChatMessage[];
  onSendMessage: (msg: string) => void;
  onApplySuggestion: (suggestion: ChatSuggestion) => void;
  streaming: boolean;
  streamContent: string;
}

export default function StoryChatPanel({
  phase, messages, onSendMessage, onApplySuggestion,
  streaming, streamContent,
}: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const disabled = phase === "input";

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-700 w-[350px] min-w-[350px]">
      <div className="p-3 border-b border-gray-700">
        <div className="text-sm font-medium text-gray-300">{"\uCC44\uD305"}</div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {disabled && (
          <div className="text-xs text-gray-600 text-center mt-8">
            {"\uC544\uC6C3\uB77C\uC778\uC744 \uBA3C\uC800 \uC0DD\uC131\uD558\uC138\uC694"}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`text-sm ${msg.role === "user" ? "text-blue-300" : "text-gray-300"}`}>
            <div className="text-xs text-gray-500 mb-0.5">
              {msg.role === "user" ? "\uB098" : "AI"}
            </div>
            <div className="whitespace-pre-wrap">{msg.content}</div>
            {msg.suggestion && (
              <button
                onClick={() => onApplySuggestion(msg.suggestion!)}
                className="mt-1 px-2 py-1 bg-green-600/20 text-green-400 rounded text-xs flex items-center gap-1 hover:bg-green-600/30"
              >
                <Check size={12} /> {"\uC801\uC6A9"}
              </button>
            )}
          </div>
        ))}

        {/* Streaming indicator */}
        {streaming && (
          <div className="text-sm text-gray-300">
            <div className="text-xs text-gray-500 mb-0.5">AI</div>
            <div className="whitespace-pre-wrap">{streamContent}<span className="animate-pulse">{"\u258A"}</span></div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={disabled ? "" : "\uC218\uC815 \uC694\uCCAD..."}
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
            disabled={disabled || streaming}
          />
          <button
            type="submit"
            disabled={disabled || streaming || !input.trim()}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </div>
      </form>
    </div>
  );
}
