import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Loader2,
  Download,
  Sparkles,
  Tag,
  FileText,
  ChevronRight,
  Save,
  Hash,
  X,
} from 'lucide-react';
import type { Project, Video, ChunkData, ChunkTag } from '../../types';
import {
  refineAutoProcess,
  refineAutoStatus,
  refineGetChunks,
  refineGetJsonl,
  refineUpdateChunkTag,
} from '../../api';

interface Props {
  project: Project | null;
  addLog: (level: 'info' | 'warn' | 'error' | 'success', msg: string) => void;
  videos: Video[];
}

type Phase = 'idle' | 'processing' | 'done';

const TAG_COLORS: Record<keyof ChunkTag, { bg: string; text: string; label: string }> = {
  genre: { bg: 'bg-purple-900/40', text: 'text-purple-400', label: '장르' },
  topic: { bg: 'bg-blue-900/40', text: 'text-blue-400', label: '주제' },
  mood: { bg: 'bg-green-900/40', text: 'text-green-400', label: '분위기' },
  scene_type: { bg: 'bg-orange-900/40', text: 'text-orange-400', label: '장면유형' },
};

export default function RefineTab({ project, addLog, videos }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [chunks, setChunks] = useState<ChunkData[]>([]);
  const [jsonl, setJsonl] = useState('');
  const [selectedChunk, setSelectedChunk] = useState<ChunkData | null>(null);
  const [editingTags, setEditingTags] = useState<ChunkTag | null>(null);

  // Progress
  const [jobId, setJobId] = useState<string | null>(null);
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [preview, setPreview] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Load existing data when project changes
  useEffect(() => {
    if (project) {
      loadData();
    } else {
      setChunks([]);
      setJsonl('');
      setSelectedChunk(null);
      setPhase('idle');
    }
  }, [project?.id]);

  const loadData = useCallback(async () => {
    if (!project) return;
    try {
      const [chunksResp, jsonlResp] = await Promise.all([
        refineGetChunks(project.id),
        refineGetJsonl(project.id),
      ]);
      const loadedChunks = chunksResp.chunks || [];
      setChunks(loadedChunks);
      setJsonl(jsonlResp.jsonl || '');
      if (loadedChunks.length > 0) setPhase('done');
    } catch {
      // No data yet
    }
  }, [project]);

  const handleAutoProcess = async () => {
    if (!project) {
      addLog('warn', '먼저 프로젝트를 선택하세요.');
      return;
    }

    setPhase('processing');
    setProcessed(0);
    setTotal(0);
    setPreview('');
    setSelectedChunk(null);
    setChunks([]);
    addLog('info', '자동 정제를 시작합니다...');

    try {
      const resp = await refineAutoProcess(project.id, 1500, 'gemma4');
      const jid = resp.job_id;
      setJobId(jid);

      pollRef.current = setInterval(async () => {
        try {
          const status = await refineAutoStatus(jid);
          setProcessed(status.processed);
          setTotal(status.total);
          if (status.current_chunk_preview) setPreview(status.current_chunk_preview);

          if (status.status === 'completed') {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setJobId(null);
            setPhase('done');
            addLog('success', `자동 정제 완료! ${status.total}개 청크 처리됨`);
            await loadData();
          } else if (status.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setJobId(null);
            setPhase('idle');
            addLog('error', `정제 실패: ${status.error || '알 수 없는 오류'}`);
          }
        } catch {
          // continue polling
        }
      }, 3000);
    } catch (err) {
      setPhase('idle');
      addLog('error', `정제 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }
  };

  const handleSaveTags = async () => {
    if (!project || !selectedChunk || !editingTags) return;
    try {
      await refineUpdateChunkTag(project.id, selectedChunk.index, editingTags);
      setChunks((prev) =>
        prev.map((c) =>
          c.index === selectedChunk.index ? { ...c, tags: editingTags } : c
        )
      );
      setSelectedChunk({ ...selectedChunk, tags: editingTags });
      addLog('success', `청크 #${selectedChunk.index} 태그 저장 완료`);
      const jsonlResp = await refineGetJsonl(project.id);
      setJsonl(jsonlResp.jsonl || '');
    } catch {
      addLog('error', '태그 저장 실패');
    }
  };

  const handleDownload = () => {
    if (!jsonl) {
      addLog('warn', '다운로드할 JSONL이 없습니다.');
      return;
    }
    const blob = new Blob([jsonl], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.name || 'dataset'}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('success', 'JSONL 파일 다운로드 완료');
  };

  const selectChunk = (chunk: ChunkData) => {
    setSelectedChunk(chunk);
    setEditingTags(
      chunk.tags
        ? { ...chunk.tags }
        : { genre: '', topic: '', mood: '', scene_type: '' }
    );
  };

  const progressPercent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const doneCount = videos.filter((v) => v.status === 'done').length;

  return (
    <div className="h-full flex flex-col gap-4">
      {/* ── Idle: Big start button ── */}
      {phase === 'idle' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-6">
            <div className="mx-auto w-20 h-20 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
              <Sparkles size={36} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-100 mb-2">데이터 정제</h2>
              <p className="text-sm text-gray-500 max-w-sm">
                수집된 텍스트를 자동으로 청크 분할하고 태깅하여
                <br />
                학습용 JSONL 데이터를 생성합니다.
              </p>
              {doneCount > 0 && (
                <p className="text-xs text-green-400 mt-2">
                  {doneCount}개 영상 수집 완료
                </p>
              )}
            </div>
            <button
              onClick={handleAutoProcess}
              disabled={!project}
              className="inline-flex items-center gap-2.5 px-8 py-3.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold rounded-xl transition-colors text-base shadow-lg shadow-blue-600/20"
            >
              <Sparkles size={20} />
              자동 정제 시작
            </button>
            {!project && (
              <p className="text-xs text-gray-600">프로젝트를 먼저 선택하세요</p>
            )}
          </div>
        </div>
      )}

      {/* ── Processing: Progress bar ── */}
      {phase === 'processing' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-lg space-y-6 px-4">
            <div className="text-center space-y-2">
              <Loader2 size={40} className="mx-auto text-blue-400 animate-spin" />
              <h2 className="text-lg font-semibold text-gray-100">정제 진행 중</h2>
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-300">
                  {total > 0
                    ? `${processed}/${total} 청크 태깅 중...`
                    : '청크 분할 준비 중...'}
                </span>
                <span className="text-blue-400 font-mono font-semibold">
                  {progressPercent}%
                </span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-blue-600 h-full rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Current chunk preview */}
            {preview && (
              <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3">
                <p className="text-[11px] text-gray-500 mb-1">현재 처리 중인 청크</p>
                <p className="text-xs text-gray-400 line-clamp-3 leading-relaxed">
                  {preview}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Done: Chunk list + detail ── */}
      {phase === 'done' && (
        <>
          {/* Header bar */}
          <div className="flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-gray-100">정제 결과</h2>
              <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Hash size={10} />
                {chunks.length}개 청크
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAutoProcess}
                disabled={!project}
                className="btn-secondary text-xs px-3 py-1.5"
              >
                <Sparkles size={12} />
                다시 정제
              </button>
            </div>
          </div>

          {/* Split pane */}
          {chunks.length > 0 ? (
            <div className="flex-1 min-h-0 flex gap-3">
              {/* Left 40%: Chunk list */}
              <div className="w-[40%] flex-shrink-0 overflow-y-auto border border-gray-800 rounded-lg bg-gray-900/30">
                {chunks.map((chunk) => {
                  const isSelected = selectedChunk?.index === chunk.index;
                  return (
                    <button
                      key={chunk.index}
                      onClick={() => selectChunk(chunk)}
                      className={`w-full text-left px-3 py-3 border-b border-gray-800/60 transition-colors ${
                        isSelected
                          ? 'bg-blue-600/15 border-l-2 border-l-blue-500'
                          : 'hover:bg-gray-800/40 border-l-2 border-l-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] text-gray-500 font-mono min-w-[28px]">
                          #{chunk.index}
                        </span>
                        <div className="flex gap-1 flex-wrap flex-1 min-w-0">
                          {chunk.tags &&
                            (Object.keys(TAG_COLORS) as (keyof ChunkTag)[]).map(
                              (key) =>
                                chunk.tags![key] && (
                                  <span
                                    key={key}
                                    className={`text-[10px] px-1.5 py-0.5 rounded ${TAG_COLORS[key].bg} ${TAG_COLORS[key].text} truncate max-w-[80px]`}
                                  >
                                    {chunk.tags![key]}
                                  </span>
                                )
                            )}
                        </div>
                        <ChevronRight
                          size={12}
                          className={`flex-shrink-0 ${isSelected ? 'text-blue-400' : 'text-gray-700'}`}
                        />
                      </div>
                      <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed pl-[28px]">
                        {chunk.text.slice(0, 140)}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Right 60%: Detail */}
              <div className="flex-1 min-w-0 overflow-y-auto border border-gray-800 rounded-lg bg-gray-900/30">
                {selectedChunk ? (
                  <div className="p-5 space-y-5">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
                        <FileText size={14} className="text-gray-500" />
                        청크 #{selectedChunk.index}
                      </h3>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500">
                          {selectedChunk.text.length.toLocaleString()}자
                        </span>
                        <button
                          onClick={() => {
                            setSelectedChunk(null);
                            setEditingTags(null);
                          }}
                          className="p-1 text-gray-600 hover:text-gray-400 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Text content */}
                    <div className="bg-gray-950/60 border border-gray-800/60 rounded-lg p-4 text-[13px] text-gray-300 leading-relaxed max-h-[45vh] overflow-y-auto whitespace-pre-wrap">
                      {selectedChunk.text}
                    </div>

                    {/* Tag editor */}
                    {editingTags && (
                      <div className="space-y-3">
                        <h4 className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
                          <Tag size={12} />
                          태그 편집
                        </h4>
                        <div className="grid grid-cols-2 gap-3">
                          {(Object.keys(TAG_COLORS) as (keyof ChunkTag)[]).map(
                            (key) => (
                              <div key={key}>
                                <label
                                  className={`text-[11px] block mb-1 font-medium ${TAG_COLORS[key].text}`}
                                >
                                  {TAG_COLORS[key].label}
                                </label>
                                <input
                                  type="text"
                                  value={editingTags[key]}
                                  onChange={(e) =>
                                    setEditingTags({
                                      ...editingTags,
                                      [key]: e.target.value,
                                    })
                                  }
                                  className="input-field text-xs"
                                  placeholder={TAG_COLORS[key].label}
                                />
                              </div>
                            )
                          )}
                        </div>
                        <button
                          onClick={handleSaveTags}
                          className="btn-primary text-xs w-full py-2"
                        >
                          <Save size={12} />
                          태그 저장
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-600">
                    <div className="text-center">
                      <Tag size={32} className="mx-auto mb-2 opacity-30" />
                      <p className="text-xs">왼쪽에서 청크를 선택하세요</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <FileText size={48} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm">정제된 청크가 없습니다.</p>
              </div>
            </div>
          )}

          {/* Bottom bar */}
          <div className="flex items-center justify-between flex-shrink-0 pt-2 border-t border-gray-800/60">
            <span className="text-xs text-gray-500">
              총 {chunks.length}개 청크
              {jsonl && ` / JSONL ${jsonl.split('\n').filter((l) => l.trim()).length}줄`}
            </span>
            <button
              onClick={handleDownload}
              disabled={!jsonl}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Download size={14} />
              JSONL 다운로드
            </button>
          </div>
        </>
      )}
    </div>
  );
}
