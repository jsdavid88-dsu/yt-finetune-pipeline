import { useState, useEffect } from 'react';
import { FolderPlus, Folder, Loader2 } from 'lucide-react';
import type { Project, ProjectPreset } from '../types';
import { getProjects, createProject, getPresets } from '../api';

interface Props {
  selectedProject: Project | null;
  onSelectProject: (p: Project) => void;
  addLog: (level: 'info' | 'warn' | 'error' | 'success', msg: string) => void;
}

export default function Sidebar({ selectedProject, onSelectProject, addLog }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [presets, setPresets] = useState<ProjectPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('일반');

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const data = await getProjects();
      setProjects(data.map((p: any) => ({ ...p, preset: p.preset || '일반' })));
    } catch {
      setProjects([
        { id: 'demo-1', name: '데모 프로젝트', preset: '일반', createdAt: new Date().toISOString(), videoCount: 3 },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const fetchPresets = async () => {
    try {
      const data = await getPresets();
      setPresets(data);
    } catch {
      setPresets([
        { name: '막장드라마', genre: '막장드라마', chunk_size: 1500, tagging_prompt: '', base_model: 'gemma4', generation_prompt: '' },
        { name: '판타지소설', genre: '판타지소설', chunk_size: 2000, tagging_prompt: '', base_model: 'gemma4', generation_prompt: '' },
        { name: '일반', genre: '일반', chunk_size: 1500, tagging_prompt: '', base_model: 'gemma4', generation_prompt: '' },
      ]);
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchPresets();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const result = await createProject(newName.trim(), selectedPreset);
      const newProject: Project = {
        id: result.id,
        name: newName.trim(),
        preset: selectedPreset,
        createdAt: new Date().toISOString(),
        videoCount: 0,
      };
      setProjects((prev) => [...prev, newProject]);
      onSelectProject(newProject);
      addLog('success', `프로젝트 "${newName.trim()}" 생성 완료 (프리셋: ${selectedPreset})`);
      setNewName('');
      setSelectedPreset('일반');
      setShowCreate(false);
    } catch {
      const newProject: Project = {
        id: `local-${Date.now()}`,
        name: newName.trim(),
        preset: selectedPreset,
        createdAt: new Date().toISOString(),
        videoCount: 0,
      };
      setProjects((prev) => [...prev, newProject]);
      onSelectProject(newProject);
      addLog('info', `프로젝트 "${newName.trim()}" 생성 (로컬)`);
      setNewName('');
      setSelectedPreset('일반');
      setShowCreate(false);
    }
  };

  const presetBadgeColor = (preset: string) => {
    switch (preset) {
      case '막장드라마': return 'text-red-400 bg-red-900/30';
      case '판타지소설': return 'text-purple-400 bg-purple-900/30';
      default: return 'text-gray-400 bg-gray-800';
    }
  };

  return (
    <aside className="w-60 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300">프로젝트</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
          title="새 프로젝트"
        >
          <FolderPlus size={16} />
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-3 py-2 border-b border-gray-800">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="프로젝트 이름..."
            className="input-field text-sm mb-2"
            autoFocus
          />
          <select
            value={selectedPreset}
            onChange={(e) => setSelectedPreset(e.target.value)}
            className="input-field text-sm mb-2 w-full"
          >
            {presets.length > 0
              ? presets.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} {p.genre ? `(${p.genre})` : ''}
                  </option>
                ))
              : (
                <>
                  <option value="막장드라마">막장드라마</option>
                  <option value="판타지소설">판타지소설</option>
                  <option value="일반">일반</option>
                </>
              )
            }
          </select>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="btn-primary text-xs py-1 flex-1">
              생성
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewName(''); }}
              className="btn-secondary text-xs py-1"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* Project list */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8 px-4">
            프로젝트가 없습니다.
            <br />
            새 프로젝트를 생성하세요.
          </p>
        ) : (
          projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectProject(p)}
              className={`
                w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors
                ${
                  selectedProject?.id === p.id
                    ? 'bg-blue-600/20 text-blue-400 border-r-2 border-blue-500'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }
              `}
            >
              <Folder size={14} />
              <div className="min-w-0 flex-1">
                <div className="truncate">{p.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${presetBadgeColor(p.preset)}`}>
                    {p.preset}
                  </span>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
