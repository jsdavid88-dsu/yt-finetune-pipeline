import { useState } from 'react';
import { Layers, Play, Download, Loader2, FileText } from 'lucide-react';
import { generateBatch } from '../../api';

interface Props {
  selectedModel: string;
  addLog: (level: 'info' | 'warn' | 'error' | 'success', msg: string) => void;
}

export default function BatchGenerate({ selectedModel, addLog }: Props) {
  const [prompts, setPrompts] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleBatch = async () => {
    if (!selectedModel) {
      addLog('warn', '모델을 선택하세요.');
      return;
    }
    const lines = prompts
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      addLog('warn', '프롬프트를 입력하세요.');
      return;
    }

    setLoading(true);
    addLog('info', `일괄 생성 시작: ${lines.length}개 프롬프트`);

    try {
      const data = await generateBatch(selectedModel, lines);
      setResults(data.results);
      addLog('success', `일괄 생성 완료: ${data.results.length}개 결과`);
    } catch {
      // Demo fallback
      const demoResults = lines.map(
        (p) => `[${selectedModel}] "${p}"에 대한 응답입니다.\n\n이것은 데모 응답입니다. 실제 백엔드에 연결하면 모델이 생성한 텍스트가 표시됩니다.`
      );
      setResults(demoResults);
      addLog('info', '일괄 생성 완료 (데모)');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    const content = results
      .map((r, i) => `--- 결과 ${i + 1} ---\n${r}`)
      .join('\n\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch-results-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('success', '결과 내보내기 완료');
  };

  return (
    <div className="card flex flex-col">
      <div className="px-4 py-2.5 border-b border-gray-800 text-sm font-medium text-gray-400 flex items-center gap-2">
        <Layers size={14} />
        일괄 생성
      </div>

      <div className="p-4 space-y-3">
        <textarea
          value={prompts}
          onChange={(e) => setPrompts(e.target.value)}
          placeholder="프롬프트를 한 줄에 하나씩 입력하세요..."
          rows={4}
          className="input-field text-sm resize-none font-mono"
        />

        <div className="flex gap-2">
          <button onClick={handleBatch} disabled={loading || !prompts.trim()} className="btn-primary text-sm">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            일괄 생성
          </button>
          {results.length > 0 && (
            <button onClick={handleExport} className="btn-secondary text-sm">
              <Download size={14} />
              내보내기
            </button>
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className="p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
                <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <FileText size={10} />
                  결과 #{i + 1}
                </div>
                <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans">{r}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
