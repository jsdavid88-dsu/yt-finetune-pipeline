import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Loader2,
  Download,
  Sparkles,
  Tag,
  FileText,
  ChevronRight,
  ChevronDown,
  Save,
  Hash,
  X,
  Eye,
  EyeOff,
  BarChart3,
  BookOpen,
} from 'lucide-react';
import type { Project, Video, ChunkData, ChunkTag, ChunkAnalysis, EpisodeOutline } from '../../types';
import {
  refineAutoProcess,
  refineAutoStatus,
  refineGetChunks,
  refineGetJsonl,
  refineUpdateChunkTag,
  refineGetOutlines,
} from '../../api';

interface Props {
  project: Project | null;
  addLog: (level: 'info' | 'warn' | 'error' | 'success', msg: string) => void;
  videos: Video[];
}

type Phase = 'idle' | 'processing' | 'done';
type DetailTab = 'analysis' | 'text' | 'corrected';

const ANALYSIS_FIELDS: { key: keyof ChunkAnalysis; label: string; color: string }[] = [
  { key: 'genre', label: '장르', color: 'text-purple-400' },
  { key: 'core_event', label: '핵심사건', color: 'text-blue-400' },
  { key: 'emotional_arc', label: '감정흐름', color: 'text-green-400' },
  { key: 'hook', label: '떡밥', color: 'text-yellow-400' },
  { key: 'narrative_technique', label: '서사기법', color: 'text-orange-400' },
  { key: 'summary', label: '요약', color: 'text-cyan-400' },
];

export default function RefineTab({ project, addLog, videos }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [chunks, setChunks] = useState<ChunkData[]>([]);
  const [outlines, setOutlines] = useState<EpisodeOutline[]>([]);
  const [jsonlCount, setJsonlCount] = useState(0);
  const [selectedChunk, setSelectedChunk] = useState<ChunkData | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('analysis');
  const [hideNonContent, setHideNonContent] = useState(false);
  const [showOutlines, setShowOutlines] = useState(false);

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

  useEffect(() => {
    if (project) {
      loadData();
    } else {
      setChunks([]);
      setOutlines([]);
      setJsonlCount(0);
      setSelectedChunk(null);
      setPhase('idle');
    }
  }, [project?.id]);

  const loadData = useCallback(async () => {
    if (!project) return;
    try {
      const [chunksResp, jsonlResp, outlinesResp] = await Promise.all([
        refineGetChunks(project.id),
        refineGetJsonl(project.id),
        refineGetOutlines(project.id).catch(() => ({ outlines: [] })),
      ]);
      const loadedChunks = chunksResp.chunks || [];
      setChunks(loadedChunks);
      setJsonlCount(jsonlResp.jsonl ? jsonlResp.jsonl.split('\n').filter((l: string) => l.trim()).length : 0);
      setOutlines(outlinesResp.outlines || []);
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
      const resp = await refineAutoProcess(project.id);
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

  const handleDownload = () => {
    if (!jsonlCount) {
      addLog('warn', '다운로드할 JSONL이 없습니다.');
      return;
    }
    refineGetJsonl(project!.id).then((resp) => {
      const blob = new Blob([resp.jsonl], { type: 'application/jsonl' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project?.name || 'dataset'}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
      addLog('success', 'JSONL 파일 다운로드 완료');
    });
  };

  // Stats
  const contentChunks = chunks.filter(c => c.analysis?.is_content !== false);
  const nonContentChunks = chunks.filter(c => c.analysis?.is_content === false);
  const episodes = [...new Set(chunks.map(c => c.episode).filter(Boolean))];
  const displayChunks = hideNonContent ? contentChunks : chunks;

  // Task distribution from jsonl
  const taskStats = {
    t1: outlines.length,
    t2: contentChunks.length,
    t3: Math.max(0, contentChunks.length - episodes.length),
    t4: contentChunks.length,
  };

  const progressPercent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const doneCount = videos.filter((v) => v.status === 'done').length;

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Idle */}
      {phase === 'idle' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-6">
            <div className="mx-auto w-20 h-20 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
              <Sparkles size={36} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-100 mb-2">데이터 정제</h2>
              <p className="text-sm text-gray-500 max-w-sm">
                수집된 텍스트를 자동으로 교정/분석하여
                <br />
                4-Task 학습 데이터를 생성합니다.
              </p>
              {doneCount > 0 && (
                <p className="text-xs text-green-400 mt-2">{doneCount}개 영상 수집 완료</p>
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
          </div>
        </div>
      )}

      {/* Processing */}
      {phase === 'processing' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-lg space-y-6 px-4">
            <div className="text-center space-y-2">
              <Loader2 size={40} className="mx-auto text-blue-400 animate-spin" />
              <h2 className="text-lg font-semibold text-gray-100">정제 진행 중</h2>
              <p className="text-xs text-gray-500">Pass 1: STT 교정 → Pass 2: 상세 분석</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-300">
                  {total > 0 ? `${processed}/${total} 청크 처리 중...` : '청크 분할 준비 중...'}
                </span>
                <span className="text-blue-400 font-mono font-semibold">{progressPercent}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-blue-600 h-full rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
            {preview && (
              <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3">
                <p className="text-[11px] text-gray-500 mb-1">현재 처리 중</p>
                <p className="text-xs text-gray-400 line-clamp-3">{preview}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Done */}
      {phase === 'done' && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-gray-100">정제 결과</h2>
              <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Hash size={10} /> {chunks.length}개 청크
              </span>
              {nonContentChunks.length > 0 && (
                <button
                  onClick={() => setHideNonContent(!hideNonContent)}
                  className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
                >
                  {hideNonContent ? <Eye size={10} /> : <EyeOff size={10} />}
                  비내용 {nonContentChunks.length}개 {hideNonContent ? '보이기' : '숨기기'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowOutlines(!showOutlines)}
                className={`btn-secondary text-xs px-3 py-1.5 ${showOutlines ? 'bg-gray-700' : ''}`}
              >
                <BookOpen size={12} /> 아웃라인
              </button>
              <button onClick={handleAutoProcess} disabled={!project} className="btn-secondary text-xs px-3 py-1.5">
                <Sparkles size={12} /> 다시 정제
              </button>
            </div>
          </div>

          {/* Stats bar */}
          <div className="flex gap-3 flex-shrink-0">
            <div className="flex-1 bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
              <div className="flex items-center gap-1.5 mb-2">
                <BarChart3 size={12} className="text-blue-400" />
                <span className="text-xs font-medium text-gray-300">학습 데이터</span>
              </div>
              <div className="text-xl font-bold text-white">{jsonlCount}<span className="text-xs text-gray-500 ml-1">줄</span></div>
              <div className="mt-1.5 space-y-0.5 text-[10px] text-gray-500">
                <div>Task 1 아웃라인: <span className="text-gray-300">{taskStats.t1}</span></div>
                <div>Task 2 장면확장: <span className="text-gray-300">{taskStats.t2}</span></div>
                <div>Task 3 연속집필: <span className="text-gray-300">{taskStats.t3}</span></div>
                <div>Task 4 스타일: <span className="text-gray-300">{taskStats.t4}</span></div>
              </div>
            </div>
            <div className="flex-1 bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
              <div className="text-xs font-medium text-gray-300 mb-2">구성</div>
              <div className="space-y-1 text-xs">
                <div className="text-gray-400">에피소드: <span className="text-white">{episodes.length}개</span></div>
                <div className="text-gray-400">유효 청크: <span className="text-green-400">{contentChunks.length}개</span></div>
                <div className="text-gray-400">비내용 제외: <span className="text-red-400">{nonContentChunks.length}개</span></div>
                <div className="text-gray-400">교정 완료: <span className="text-cyan-400">{chunks.filter(c => c.corrected_text).length}개</span></div>
              </div>
            </div>
          </div>

          {/* Outlines panel */}
          {showOutlines && outlines.length > 0 && (
            <div className="flex-shrink-0 max-h-[300px] overflow-y-auto bg-gray-800/30 rounded-lg border border-gray-700/50 p-3 space-y-3">
              <h3 className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                <BookOpen size={12} /> 에피소드 아웃라인 ({outlines.length}개)
              </h3>
              {outlines.map((ol, oi) => (
                <details key={oi} className="group">
                  <summary className="cursor-pointer text-xs text-gray-300 hover:text-white flex items-center gap-1">
                    <ChevronRight size={10} className="group-open:rotate-90 transition-transform" />
                    <span className="text-purple-400">{ol.genre}</span> — {ol.episode.slice(0, 50)}
                    <span className="text-gray-600 ml-1">({ol.scenes.length}장면)</span>
                  </summary>
                  <div className="ml-4 mt-1 space-y-1">
                    {ol.scenes.map((s, si) => (
                      <div key={si} className="text-[11px] text-gray-400 leading-relaxed">
                        <span className="text-gray-600">{s.index}/{ol.scenes.length}</span>
                        <span className={`ml-1 ${
                          s.position === '도입' ? 'text-blue-400' :
                          s.position === '전개' ? 'text-green-400' :
                          s.position === '절정' ? 'text-red-400' : 'text-yellow-400'
                        }`}>({s.position})</span>
                        <span className="ml-1">{s.core_event}</span>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}

          {/* Chunk list + detail */}
          {chunks.length > 0 ? (
            <div className="flex-1 min-h-0 flex gap-3">
              {/* Left: Chunk list */}
              <div className="w-[35%] flex-shrink-0 overflow-y-auto border border-gray-800 rounded-lg bg-gray-900/30">
                {displayChunks.map((chunk) => {
                  const isSelected = selectedChunk?.index === chunk.index;
                  const isNonContent = chunk.analysis?.is_content === false;
                  return (
                    <button
                      key={chunk.index}
                      onClick={() => { setSelectedChunk(chunk); setDetailTab('analysis'); }}
                      className={`w-full text-left px-3 py-3 border-b border-gray-800/60 transition-colors ${
                        isSelected ? 'bg-blue-600/15 border-l-2 border-l-blue-500' :
                        isNonContent ? 'bg-red-900/5 border-l-2 border-l-red-900/30 opacity-50' :
                        'hover:bg-gray-800/40 border-l-2 border-l-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] text-gray-500 font-mono min-w-[28px]">#{chunk.index}</span>
                        {chunk.episode && (
                          <span className="text-[9px] text-gray-600 truncate max-w-[80px]">{chunk.episode.slice(0, 15)}</span>
                        )}
                        {isNonContent && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-red-900/30 text-red-400">비내용</span>
                        )}
                        <ChevronRight size={10} className={`ml-auto flex-shrink-0 ${isSelected ? 'text-blue-400' : 'text-gray-700'}`} />
                      </div>
                      {chunk.analysis ? (
                        <div className="pl-[28px] space-y-0.5">
                          <div className="flex gap-1 flex-wrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-400 truncate max-w-[80px]">
                              {chunk.analysis.genre}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-400 truncate max-w-[80px]">
                              {chunk.analysis.narrative_technique}
                            </span>
                          </div>
                          <p className="text-[10px] text-blue-300 truncate">{chunk.analysis.core_event}</p>
                        </div>
                      ) : chunk.tags ? (
                        <div className="pl-[28px] flex gap-1 flex-wrap">
                          {chunk.tags.genre && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-400">{chunk.tags.genre}</span>}
                          {chunk.tags.scene_type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-400">{chunk.tags.scene_type}</span>}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500 pl-[28px] truncate">{chunk.text.slice(0, 60)}</p>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Right: Detail */}
              <div className="flex-1 min-w-0 overflow-y-auto border border-gray-800 rounded-lg bg-gray-900/30">
                {selectedChunk ? (
                  <div className="p-4 space-y-4">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
                        <FileText size={14} className="text-gray-500" />
                        청크 #{selectedChunk.index}
                        {selectedChunk.episode && (
                          <span className="text-[10px] text-gray-500 font-normal truncate max-w-[200px]">
                            — {selectedChunk.episode.slice(0, 40)}
                          </span>
                        )}
                      </h3>
                      <button onClick={() => setSelectedChunk(null)} className="p-1 text-gray-600 hover:text-gray-400">
                        <X size={14} />
                      </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 bg-gray-800/50 rounded-lg p-0.5">
                      {[
                        { id: 'analysis' as const, label: '분석' },
                        { id: 'text' as const, label: '원문' },
                        { id: 'corrected' as const, label: '교정본' },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setDetailTab(tab.id)}
                          className={`flex-1 text-xs py-1.5 rounded transition-colors ${
                            detailTab === tab.id ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Analysis tab */}
                    {detailTab === 'analysis' && selectedChunk.analysis && (
                      <div className="space-y-3">
                        {selectedChunk.analysis.is_content === false && (
                          <div className="px-3 py-2 bg-red-900/20 border border-red-800/30 rounded-lg text-xs text-red-400">
                            비내용 (방송 인트로/아웃트로/광고) — 학습 데이터에서 제외됨
                          </div>
                        )}
                        {ANALYSIS_FIELDS.map(({ key, label, color }) => {
                          const val = selectedChunk.analysis![key];
                          if (!val || (Array.isArray(val) && val.length === 0)) return null;
                          return (
                            <div key={key}>
                              <label className={`text-[11px] font-medium ${color}`}>{label}</label>
                              <div className="text-sm text-gray-200 mt-0.5 leading-relaxed">
                                {Array.isArray(val) ? val.join(', ') : String(val)}
                              </div>
                            </div>
                          );
                        })}
                        {selectedChunk.analysis.characters && selectedChunk.analysis.characters.length > 0 && (
                          <div>
                            <label className="text-[11px] font-medium text-pink-400">등장인물</label>
                            <div className="flex gap-1 flex-wrap mt-0.5">
                              {selectedChunk.analysis.characters.map((c, i) => (
                                <span key={i} className="text-xs px-2 py-0.5 rounded bg-pink-900/30 text-pink-300">{c}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Text tab */}
                    {detailTab === 'text' && (
                      <div className="bg-gray-950/60 border border-gray-800/60 rounded-lg p-4 text-[13px] text-gray-300 leading-relaxed max-h-[50vh] overflow-y-auto whitespace-pre-wrap">
                        {selectedChunk.text}
                      </div>
                    )}

                    {/* Corrected tab */}
                    {detailTab === 'corrected' && (
                      <div className="space-y-2">
                        {selectedChunk.corrected_text ? (
                          <div className="bg-gray-950/60 border border-gray-800/60 rounded-lg p-4 text-[13px] text-gray-300 leading-relaxed max-h-[50vh] overflow-y-auto whitespace-pre-wrap">
                            {selectedChunk.corrected_text}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500 text-center py-8">교정 데이터 없음</div>
                        )}
                        {selectedChunk.corrected_text && selectedChunk.corrected_text !== selectedChunk.text && (
                          <p className="text-[10px] text-cyan-400">
                            * 원문과 {Math.abs(selectedChunk.text.length - selectedChunk.corrected_text.length)}자 차이
                          </p>
                        )}
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
              {episodes.length}개 에피소드 / {contentChunks.length}개 유효 청크 / JSONL {jsonlCount}줄
            </span>
            <button
              onClick={handleDownload}
              disabled={!jsonlCount}
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
