import { useState } from 'react';
import { BookTemplate, Plus, Edit3, Trash2, Check, X } from 'lucide-react';
import type { PromptTemplate } from '../../types';

interface Props {
  templates: PromptTemplate[];
  onSelect: (content: string) => void;
  onSave: (template: { id?: string; name: string; content: string }) => void;
  onDelete: (id: string) => void;
}

export default function TemplateManager({ templates, onSelect, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const startEdit = (t: PromptTemplate) => {
    setEditing(t.id);
    setEditName(t.name);
    setEditContent(t.content);
  };

  const cancelEdit = () => {
    setEditing(null);
    setShowAdd(false);
    setEditName('');
    setEditContent('');
  };

  const saveEdit = () => {
    if (!editName.trim() || !editContent.trim()) return;
    onSave({
      id: editing !== 'new' ? editing ?? undefined : undefined,
      name: editName.trim(),
      content: editContent.trim(),
    });
    cancelEdit();
  };

  const startAdd = () => {
    setShowAdd(true);
    setEditing('new');
    setEditName('');
    setEditContent('');
  };

  return (
    <div className="card flex flex-col h-full">
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
        <div className="text-sm font-medium text-gray-400 flex items-center gap-2">
          <BookTemplate size={14} />
          프롬프트 템플릿
        </div>
        <button
          onClick={startAdd}
          className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
          title="새 템플릿"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Edit/Add form */}
        {editing && (
          <div className="p-3 border-b border-gray-800 space-y-2 bg-gray-800/30">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="템플릿 이름..."
              className="input-field text-sm"
              autoFocus
            />
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="프롬프트 내용..."
              rows={3}
              className="input-field text-sm resize-none"
            />
            <div className="flex gap-1.5 justify-end">
              <button onClick={cancelEdit} className="p-1.5 rounded hover:bg-gray-700 text-gray-400">
                <X size={14} />
              </button>
              <button onClick={saveEdit} className="p-1.5 rounded hover:bg-blue-600 text-blue-400">
                <Check size={14} />
              </button>
            </div>
          </div>
        )}

        {templates.length === 0 && !editing ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            템플릿이 없습니다.
          </div>
        ) : (
          templates.map((t) =>
            editing === t.id ? null : (
              <div
                key={t.id}
                className="px-4 py-3 border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors group"
              >
                <div className="flex items-center justify-between mb-1">
                  <button
                    onClick={() => onSelect(t.content)}
                    className="text-sm font-medium text-gray-300 hover:text-blue-400 transition-colors text-left"
                  >
                    {t.name}
                  </button>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(t)}
                      className="p-1 rounded hover:bg-gray-700 text-gray-500"
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      onClick={() => onDelete(t.id)}
                      className="p-1 rounded hover:bg-red-900/50 text-gray-500 hover:text-red-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 line-clamp-2">{t.content}</p>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}
