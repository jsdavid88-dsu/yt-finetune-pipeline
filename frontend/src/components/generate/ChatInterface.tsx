import { useState, useRef, useEffect } from 'react';
import { Send, User, Bot, Loader2, StopCircle } from 'lucide-react';
import type { ChatMessage, GenerateModel } from '../../types';
import { generateChatStream } from '../../api';

interface Props {
  models: GenerateModel[];
  selectedModel: string;
  onSelectModel: (m: string) => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  addLog: (level: 'info' | 'warn' | 'error' | 'success', msg: string) => void;
}

export default function ChatInterface({
  models,
  selectedModel,
  onSelectModel,
  messages,
  setMessages,
  addLog,
}: Props) {
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || streaming) return;
    if (!selectedModel) {
      addLog('warn', '모델을 선택하세요.');
      return;
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    const assistantMsg: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);

    const apiMessages = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    controllerRef.current = generateChatStream(
      selectedModel,
      apiMessages,
      (chunk) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              content: last.content + chunk,
            };
          }
          return updated;
        });
      },
      () => {
        setStreaming(false);
        addLog('success', '응답 생성 완료');
      },
      (err) => {
        setStreaming(false);
        addLog('error', `생성 오류: ${err.message}`);
        // Simulate response for demo
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant' && !last.content) {
            updated[updated.length - 1] = {
              ...last,
              content:
                '안녕하세요! 저는 AI 어시스턴트입니다. 현재 백엔드에 연결되지 않아 데모 응답을 표시합니다.\n\n질문에 대해 도움을 드리겠습니다. 백엔드 서버를 시작하면 실제 모델의 응답을 받으실 수 있습니다.',
            };
          }
          return updated;
        });
      }
    );
  };

  const handleStop = () => {
    controllerRef.current?.abort();
    setStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="card flex flex-col h-full">
      {/* Header with model select */}
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-3">
        <Bot size={16} className="text-blue-400" />
        <span className="text-sm font-medium text-gray-300">채팅</span>
        <select
          value={selectedModel}
          onChange={(e) => onSelectModel(e.target.value)}
          className="ml-auto text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
        >
          <option value="">모델 선택...</option>
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} ({m.size}){m.name.startsWith("storyforge-") ? " ✦ 학습됨" : ""}
            </option>
          ))}
        </select>
        {selectedModel.startsWith("storyforge-") && (
          <span className="ml-1 px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded font-medium">학습됨</span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Bot size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">모델을 선택하고 메시지를 입력하세요.</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0 mt-0.5">
                <Bot size={14} className="text-blue-400" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 border border-gray-700'
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              {msg.role === 'assistant' && !msg.content && streaming && (
                <div className="flex items-center gap-1.5 text-gray-500">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center shrink-0 mt-0.5">
                <User size={14} className="text-gray-400" />
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-800">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="메시지를 입력하세요... (Shift+Enter로 줄바꿈)"
            rows={1}
            className="input-field flex-1 resize-none min-h-[40px] max-h-32"
            style={{ height: 'auto' }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 128) + 'px';
            }}
          />
          {streaming ? (
            <button onClick={handleStop} className="btn-danger py-2.5 px-3">
              <StopCircle size={16} />
            </button>
          ) : (
            <button onClick={handleSend} disabled={!input.trim()} className="btn-primary py-2.5 px-3">
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
