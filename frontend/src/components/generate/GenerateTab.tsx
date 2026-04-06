import { useState, useEffect } from 'react';
import { Download, MessageSquare, Layers, BookOpen } from 'lucide-react';
import type { Project, ChatMessage, GenerateModel, PromptTemplate } from '../../types';
import { generateGetModels, generateExport, getTemplates, saveTemplate, deleteTemplate } from '../../api';
import ChatInterface from './ChatInterface';
import TemplateManager from './TemplateManager';
import BatchGenerate from './BatchGenerate';
import StoryEditor from './StoryEditor';

interface Props {
  project: Project | null;
  addLog: (level: 'info' | 'warn' | 'error' | 'success', msg: string) => void;
}

const defaultModels: GenerateModel[] = [
  { name: 'llama3.2:latest', size: '3B', modified_at: '' },
  { name: 'gemma2:2b', size: '2B', modified_at: '' },
  { name: 'qwen2.5:3b', size: '3B', modified_at: '' },
];

const defaultTemplates: PromptTemplate[] = [
  {
    id: '1',
    name: '블로그 글 작성',
    content: '다음 주제에 대해 블로그 글을 작성해 주세요: {주제}',
  },
  {
    id: '2',
    name: '요약 정리',
    content: '다음 내용을 핵심 포인트 위주로 요약해 주세요:\n\n{내용}',
  },
  {
    id: '3',
    name: 'Q&A 생성',
    content: '다음 내용을 바탕으로 질문과 답변 쌍 5개를 만들어 주세요:\n\n{내용}',
  },
];

type GenerateMode = 'chat' | 'story';

export default function GenerateTab({ project, addLog }: Props) {
  const [mode, setMode] = useState<GenerateMode>('chat');
  const [models, setModels] = useState<GenerateModel[]>(defaultModels);
  const [selectedModel, setSelectedModel] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>(defaultTemplates);
  const [chatInputRef, setChatInputRef] = useState<string>('');

  useEffect(() => {
    generateGetModels()
      .then(setModels)
      .catch(() => setModels(defaultModels));
    getTemplates()
      .then(setTemplates)
      .catch(() => {});
  }, []);

  const handleTemplateSelect = (content: string) => {
    // This would ideally set the chat input, but we'll add the template as a user message
    setChatInputRef(content);
    addLog('info', '템플릿이 적용되었습니다.');
  };

  const handleTemplateSave = async (t: { id?: string; name: string; content: string }) => {
    try {
      const saved = await saveTemplate(t);
      setTemplates((prev) => {
        const idx = prev.findIndex((p) => p.id === saved.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = saved;
          return updated;
        }
        return [...prev, saved];
      });
      addLog('success', `템플릿 "${t.name}" 저장 완료`);
    } catch {
      // Local save
      const newTemplate: PromptTemplate = {
        id: t.id || Date.now().toString(),
        name: t.name,
        content: t.content,
      };
      setTemplates((prev) => {
        const idx = prev.findIndex((p) => p.id === newTemplate.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = newTemplate;
          return updated;
        }
        return [...prev, newTemplate];
      });
      addLog('info', `템플릿 "${t.name}" 저장됨 (로컬)`);
    }
  };

  const handleTemplateDelete = async (id: string) => {
    try {
      await deleteTemplate(id);
    } catch {
      // continue
    }
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    addLog('info', '템플릿 삭제됨');
  };

  const handleExport = async (format: 'txt' | 'md') => {
    if (messages.length === 0) {
      addLog('warn', '내보낼 대화가 없습니다.');
      return;
    }

    try {
      const blob = await generateExport(
        messages.map((m) => ({ role: m.role, content: m.content })),
        format
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-export-${Date.now()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Local export
      const content = messages
        .map((m) => `**${m.role === 'user' ? '사용자' : 'AI'}**: ${m.content}`)
        .join('\n\n---\n\n');
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-export-${Date.now()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    }
    addLog('success', `대화 내보내기 완료 (${format.toUpperCase()})`);
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-100 mb-1">텍스트 생성</h1>
          <p className="text-sm text-gray-500">미세 조정된 모델로 텍스트를 생성합니다.</p>
        </div>
        <div className="flex gap-2">
          {/* Mode tabs */}
          <div className="flex bg-gray-800 rounded-lg p-0.5 mr-2">
            <button
              onClick={() => setMode('chat')}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-1.5 transition-colors ${
                mode === 'chat' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <MessageSquare size={14} /> 채팅
            </button>
            <button
              onClick={() => setMode('story')}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-1.5 transition-colors ${
                mode === 'story' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <BookOpen size={14} /> 스크립트
            </button>
          </div>
          {mode === 'chat' && (
            <>
              <button onClick={() => handleExport('txt')} className="btn-secondary text-sm">
                <Download size={14} />
                TXT 내보내기
              </button>
              <button onClick={() => handleExport('md')} className="btn-secondary text-sm">
                <Download size={14} />
                MD 내보내기
              </button>
            </>
          )}
        </div>
      </div>

      {mode === 'story' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <StoryEditor addLog={addLog} />
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-4 gap-4 min-h-0">
          {/* Chat - takes 3 cols */}
          <div className="col-span-3 flex flex-col gap-4 min-h-0">
            <div className="flex-1 min-h-0">
              <ChatInterface
                models={models}
                selectedModel={selectedModel}
                onSelectModel={setSelectedModel}
                messages={messages}
                setMessages={setMessages}
                addLog={addLog}
              />
            </div>
            <BatchGenerate selectedModel={selectedModel} addLog={addLog} />
          </div>

          {/* Side panel - templates */}
          <div className="min-h-0">
            <TemplateManager
              templates={templates}
              onSelect={handleTemplateSelect}
              onSave={handleTemplateSave}
              onDelete={handleTemplateDelete}
            />
          </div>
        </div>
      )}
    </div>
  );
}
