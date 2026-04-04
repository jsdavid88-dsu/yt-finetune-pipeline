import { Braces, Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface Props {
  jsonl: string;
}

export default function JsonlPreview({ jsonl }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(jsonl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = jsonl ? jsonl.split('\n').filter(Boolean) : [];

  return (
    <div className="card flex flex-col h-full">
      <div className="px-4 py-2.5 border-b border-gray-800 text-sm font-medium text-gray-400 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Braces size={14} />
          JSONL 미리보기
        </div>
        {jsonl && (
          <button onClick={handleCopy} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? '복사됨' : '복사'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {lines.length > 0 ? (
          <div className="space-y-2">
            {lines.map((line, i) => {
              let parsed: Record<string, unknown> | null = null;
              try {
                parsed = JSON.parse(line);
              } catch {
                // leave null
              }
              return (
                <div key={i} className="p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
                  <div className="text-xs text-gray-500 mb-1">#{i + 1}</div>
                  {parsed ? (
                    <pre className="text-xs text-green-400 whitespace-pre-wrap font-mono">
                      {JSON.stringify(parsed, null, 2)}
                    </pre>
                  ) : (
                    <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono">{line}</pre>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Braces size={32} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm">JSONL 변환 결과가 여기에 표시됩니다.</p>
            </div>
          </div>
        )}
      </div>

      {lines.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
          {lines.length}개 항목
        </div>
      )}
    </div>
  );
}
