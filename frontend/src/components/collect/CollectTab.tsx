import { useState, useEffect, useRef } from 'react';
import type { Project, Video } from '../../types';
import { collectStart, collectStatus, getPlaylistInfo } from '../../api';
import UrlInput from './UrlInput';
import VideoList from './VideoList';
import TextPreview from './TextPreview';

interface Props {
  project: Project | null;
  addLog: (level: 'info' | 'warn' | 'error' | 'success', msg: string) => void;
  videos: Video[];
  setVideos: React.Dispatch<React.SetStateAction<Video[]>>;
}

export default function CollectTab({ project, addLog, videos, setVideos }: Props) {
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progressText, setProgressText] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handlePreviewPlaylist = async (url: string) => {
    if (!project) {
      addLog('warn', '먼저 프로젝트를 선택하세요.');
      return;
    }
    addLog('info', `재생목록 정보 조회 중...`);
    try {
      const info = await getPlaylistInfo(url, project.id);
      addLog('info', `재생목록에 ${info.count}개 영상이 있습니다.`);
    } catch (err) {
      addLog('error', `재생목록 조회 실패: ${err instanceof Error ? err.message : '오류'}`);
    }
  };

  const handleCollect = async (url: string, playlist: boolean) => {
    if (!project) {
      addLog('warn', '먼저 프로젝트를 선택하세요.');
      return;
    }

    setLoading(true);
    setProgressText('수집 준비 중...');
    addLog('info', `수집 시작: ${url}`);

    try {
      const resp = await collectStart(url, playlist, project.id);
      const jid = resp.jobId || (resp as any).job_id;
      setJobId(jid);
      addLog('info', `수집 작업 생성됨 (ID: ${jid})`);

      // Start polling
      pollRef.current = setInterval(async () => {
        try {
          const status = await collectStatus(jid);
          const mapped = (status.videos || []).map((v: any) => ({
            id: v.video_id || v.id,
            title: v.title,
            url: '',
            status: v.status,
            text: v.text || '',
            error: v.error,
          }));
          setVideos((prev) => {
            const existingIds = new Set(mapped.map((v: any) => v.id));
            const kept = prev.filter((v) => !existingIds.has(v.id));
            return [...kept, ...mapped];
          });

          // Update progress text
          const total = mapped.length;
          const done = mapped.filter((v: any) => v.status === 'done').length;
          const processing = mapped.filter((v: any) => v.status === 'processing').length;
          if (total > 0) {
            setProgressText(`${done}/${total} 수집 완료${processing > 0 ? ' (처리 중...)' : ''}`);
          }

          // Update selected video if it's in the list
          if (selectedVideo) {
            const updated = mapped.find((v: any) => v.id === selectedVideo.id);
            if (updated) setSelectedVideo(updated);
          }

          if (status.status === 'completed' || status.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setLoading(false);
            setJobId(null);
            if (status.status === 'completed') {
              setProgressText('');
              addLog('success', `수집 완료: ${total}개 동영상`);
            } else {
              setProgressText('');
              addLog('error', '수집 작업 실패');
            }
          }
        } catch {
          // Polling error - continue
        }
      }, 2000);
    } catch (err) {
      setLoading(false);
      setProgressText('');
      addLog('error', `수집 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }
  };

  const doneCount = videos.filter((v) => v.status === 'done').length;
  const totalCount = videos.length;

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div>
        <h1 className="text-lg font-semibold text-gray-100 mb-1">데이터 수집</h1>
        <p className="text-sm text-gray-500">YouTube 동영상에서 텍스트를 추출합니다.</p>
      </div>

      <UrlInput onSubmit={handleCollect} loading={loading} onPreview={handlePreviewPlaylist} />

      {/* Progress indicator */}
      {loading && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm text-yellow-400">
            <div className="w-3 h-3 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
            {progressText}
          </div>
          {totalCount > 0 && (
            <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-yellow-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
        <div className="overflow-y-auto">
          <VideoList
            videos={videos}
            selectedId={selectedVideo?.id ?? null}
            onSelect={setSelectedVideo}
          />
        </div>
        <div className="overflow-hidden">
          <TextPreview video={selectedVideo} />
        </div>
      </div>
    </div>
  );
}
