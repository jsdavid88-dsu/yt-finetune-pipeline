import { FileEdit } from 'lucide-react';

interface Props {
  text: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}

export default function TextEditor({ text, onChange, disabled }: Props) {
  return (
    <div className="card flex flex-col h-full">
      <div className="px-4 py-2.5 border-b border-gray-800 text-sm font-medium text-gray-400 flex items-center gap-2">
        <FileEdit size={14} />
        원본 텍스트
      </div>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="flex-1 w-full resize-none p-4 bg-transparent text-sm text-gray-300 leading-relaxed
                   focus:outline-none font-mono disabled:opacity-50"
        placeholder="수집된 텍스트가 여기에 표시됩니다. 직접 편집할 수도 있습니다."
      />
      <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500 flex justify-between">
        <span>{text.length.toLocaleString()}자</span>
        <span>{text.split('\n').length}줄</span>
      </div>
    </div>
  );
}
