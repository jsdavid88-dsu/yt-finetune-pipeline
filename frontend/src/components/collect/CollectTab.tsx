import { useState, useEffect, useRef, useCallback } from 'react';
import type { Project, Video } from '../../types';
import { collectStart, collectStatus, collectStop, getPlaylistInfo, getProjectVideos, getVideoListFull, collectResume } from '../../api';
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

  // Stats from video-list-full
  const [totalCount, setTotalCount] = useState(0);
  const [collectedCount, setCollectedCount] = useState(0);
  const [remainingCount, setRemainingCount] = useState(0);

  // Auto-repeat state
  const [autoRepeat, setAutoRepeat] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRepeatRef = useRef(false);
  const lastUrlRef = useRef('');
  const lastMaxCountRef = useRef<number | null>(100);
  const lastTopPercentRef = useRef<number | null>(null);

  // Keep ref in sync
  useEffect(() => {
    autoRepeatRef.current = autoRepeat;
  }, [autoRepeat]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // Load stats + full video list when project changes
  const loadVideoList = useCallback(async (projectId: string) => {
    try {
      const res = await getVideoListFull(projectId);
      setTotalCount(res.total);
      setCollectedCount(res.collected);
      setRemainingCount(res.remaining);

      const mapped = (res.videos || []).map((v: any) => ({
        id: v.video_id || v.id,
        title: v.title,
        url: '',
        status: v.status,
        text: v.text || '',
        error: v.error,
      }));
      setVideos(mapped);
    } catch {
      // Fallback to old endpoint
      try {
        const res = await getProjectVideos(projectId);
        const mapped = (res.videos || []).map((v: any) => ({
          id: v.video_id || v.id,
          title: v.title,
          url: '',
          status: v.status,
          text: v.text || '',
          error: v.error,
        }));
        setVideos(mapped);
        setCollectedCount(mapped.length);
        setTotalCount(mapped.length);
        setRemainingCount(0);
      } catch {}
    }
  }, [setVideos]);

  useEffect(() => {
    if (!project) return;
    loadVideoList(project.id);
  }, [project?.id, loadVideoList]);

  const handlePreviewPlaylist = async (url: string) => {
    if (!project) {
      addLog('warn', '\uba3c\uc800 \ud504\ub85c\uc81d\ud2b8\ub97c \uc120\ud0dd\ud558\uc138\uc694.');
      return null;
    }
    addLog('info', `\uc7ac\uc0dd\ubaa9\ub85d \uc815\ubcf4 \uc870\ud68c \uc911...`);
    try {
      const info = await getPlaylistInfo(url, project.id);
      addLog('info', `\uc7ac\uc0dd\ubaa9\ub85d\uc5d0 ${info.count}\uac1c \uc601\uc0c1\uc774 \uc788\uc2b5\ub2c8\ub2e4.`);
      return info;
    } catch (err) {
      addLog('error', `\uc7ac\uc0dd\ubaa9\ub85d \uc870\ud68c \uc2e4\ud328: ${err instanceof Error ? err.message : '\uc624\ub958'}`);
      return null;
    }
  };

  const startAutoRepeatCountdown = useCallback(() => {
    if (!autoRepeatRef.current || !project) return;

    setCountdown(120);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = null;
          // Trigger next batch
          if (autoRepeatRef.current && project) {
            handleCollect(
              lastUrlRef.current,
              false,
              lastTopPercentRef.current,
              lastMaxCountRef.current,
            );
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [project]);

  const handleCollect = async (url: string, playlist: boolean, topPercent: number | null = null, maxCount: number | null = null) => {
    if (!project) {
      addLog('warn', '\uba3c\uc800 \ud504\ub85c\uc81d\ud2b8\ub97c \uc120\ud0dd\ud558\uc138\uc694.');
      return;
    }

    // Cancel any countdown
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
      setCountdown(0);
    }

    // Save for auto-repeat
    lastUrlRef.current = url;
    lastMaxCountRef.current = maxCount;
    lastTopPercentRef.current = topPercent;

    setLoading(true);
    setProgressText('\uc218\uc9d1 \uc900\ube44 \uc911...');
    addLog('info', `\uc218\uc9d1 \uc2dc\uc791: ${url}`);

    try {
      const resp = await collectStart(url, playlist, project.id, topPercent, maxCount);
      const jid = resp.jobId || (resp as any).job_id;
      setJobId(jid);
      addLog('info', `\uc218\uc9d1 \uc791\uc5c5 \uc0dd\uc131\ub428 (ID: ${jid})`);

      startPolling(jid);
    } catch (err) {
      setLoading(false);
      setProgressText('');
      addLog('error', `\uc218\uc9d1 \uc2e4\ud328: ${err instanceof Error ? err.message : '\uc54c \uc218 \uc5c6\ub294 \uc624\ub958'}`);
    }
  };

  const handleResume = async (maxCount: number | null = 100) => {
    if (!project) {
      addLog('warn', '\uba3c\uc800 \ud504\ub85c\uc81d\ud2b8\ub97c \uc120\ud0dd\ud558\uc138\uc694.');
      return;
    }

    setLoading(true);
    setProgressText('\uc774\uc5b4\uc11c \uc218\uc9d1 \uc900\ube44 \uc911...');
    addLog('info', '\uc774\uc5b4\uc11c \uc218\uc9d1 \uc2dc\uc791...');

    try {
      const resp = await collectResume(project.id, maxCount);
      if ((resp as any).status === 'all_collected') {
        addLog('info', '\ubaa8\ub4e0 \uc601\uc0c1\uc774 \uc774\ubbf8 \uc218\uc9d1\ub418\uc5c8\uc2b5\ub2c8\ub2e4.');
        setLoading(false);
        setProgressText('');
        return;
      }
      const jid = resp.job_id;
      setJobId(jid);
      addLog('info', `\uc774\uc5b4\uc11c \uc218\uc9d1 \uc2dc\uc791 (${resp.remaining}\uac1c \ub0a8\uc74c, ID: ${jid})`);

      lastMaxCountRef.current = maxCount;
      startPolling(jid);
    } catch (err) {
      setLoading(false);
      setProgressText('');
      addLog('error', `\uc774\uc5b4\uc11c \uc218\uc9d1 \uc2e4\ud328: ${err instanceof Error ? err.message : '\uc624\ub958'}`);
    }
  };

  const startPolling = (jid: string) => {
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

        // Merge with existing full list: update statuses of matched videos
        setVideos((prev) => {
          const statusMap = new Map(mapped.map((v: Video) => [v.id, v]));
          const merged = prev.map((v) => {
            if (statusMap.has(v.id)) {
              return statusMap.get(v.id)!;
            }
            return v;
          });
          // Add any new videos not in previous list
          for (const v of mapped) {
            if (!merged.find((m) => m.id === v.id)) {
              merged.push(v);
            }
          }
          return merged;
        });

        // Update progress text
        const total = mapped.length;
        const done = mapped.filter((v: any) => v.status === 'done').length;
        const processing = mapped.filter((v: any) => v.status === 'processing').length;
        if (total > 0) {
          setProgressText(`${done}/${total} \uc218\uc9d1 \uc644\ub8cc${processing > 0 ? ' (\ucc98\ub9ac \uc911...)' : ''}`);
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
            // Reload full video list
            if (project) {
              await loadVideoList(project.id);
              addLog('success', `\uc218\uc9d1 \uc644\ub8cc`);
            }
            // Auto-repeat logic
            if (autoRepeatRef.current && project) {
              const listRes = await getVideoListFull(project.id);
              if (listRes.remaining > 0) {
                addLog('info', `\uc790\ub3d9 \ubc18\ubcf5: ${listRes.remaining}\uac1c \ub0a8\uc74c, 2\ubd84 \ud6c4 \uc7ac\uc2dc\uc791...`);
                startAutoRepeatCountdown();
              } else {
                addLog('success', '\ubaa8\ub4e0 \uc601\uc0c1 \uc218\uc9d1 \uc644\ub8cc!');
              }
            }
          } else {
            setProgressText('');
            const errMsg = status.error || '\uc218\uc9d1 \uc791\uc5c5 \uc2e4\ud328';
            addLog('error', errMsg);

            // Even on failure (e.g. user stop), reload list
            if (project) {
              await loadVideoList(project.id);
            }
          }
        }
      } catch {
        // Polling error - continue
      }
    }, 2000);
  };

  const handleStop = async () => {
    // Cancel auto-repeat countdown
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
      setCountdown(0);
    }

    if (jobId) {
      try {
        await collectStop(jobId);
        addLog('info', '\uc218\uc9d1 \uc911\uc9c0 \uc694\uccad...');
      } catch {}
    }
  };

  const videoDoneCount = videos.filter((v) => v.status === 'done').length;
  const videoProcessingCount = videos.filter((v) => v.status === 'processing').length;

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div>
        <h1 className="text-lg font-semibold text-gray-100 mb-1">{'\ub370\uc774\ud130 \uc218\uc9d1'}</h1>
        <p className="text-sm text-gray-500">YouTube {'\ub3d9\uc601\uc0c1\uc5d0\uc11c \ud14d\uc2a4\ud2b8\ub97c \ucd94\ucd9c\ud569\ub2c8\ub2e4.'}</p>
        {/* Statistics display */}
        {totalCount > 0 && (
          <div className="mt-1 text-sm text-gray-400">
            {'\uc804\uccb4'} <span className="text-white font-semibold">{totalCount}</span>{'\uac1c'}
            {' / \uc218\uc9d1 \uc644\ub8cc '}
            <span className="text-green-400 font-semibold">{collectedCount}</span>{'\uac1c'}
            {' / \ub0a8\uc740 '}
            <span className="text-yellow-400 font-semibold">{remainingCount}</span>{'\uac1c'}
          </div>
        )}
      </div>

      <UrlInput
        onSubmit={handleCollect}
        loading={loading}
        onPreview={handlePreviewPlaylist}
        autoRepeat={autoRepeat}
        onAutoRepeatChange={setAutoRepeat}
      />

      {/* Resume button */}
      {!loading && remainingCount > 0 && (
        <button
          onClick={() => handleResume(lastMaxCountRef.current || 100)}
          className="w-full px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded text-sm font-medium transition-colors"
        >
          {'\uc774\uc5b4\uc11c \uc218\uc9d1'} ({remainingCount}{'\uac1c \ub0a8\uc74c'})
        </button>
      )}

      {/* Progress indicator */}
      {(loading || countdown > 0) && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm text-yellow-400">
            {loading && (
              <div className="w-3 h-3 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
            )}
            {countdown > 0 ? (
              <span>{'\ub2e4\uc74c \ubc30\uce58 \uc2dc\uc791\uae4c\uc9c0'} {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}</span>
            ) : (
              progressText
            )}
            {(loading || countdown > 0) && (
              <button
                onClick={handleStop}
                className="ml-2 px-2 py-0.5 bg-red-600 hover:bg-red-700 rounded text-xs text-white"
              >
                {'\uc911\uc9c0'}
              </button>
            )}
          </div>
          {loading && videos.length > 0 && (
            <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-yellow-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${videos.length > 0 ? (videoDoneCount / videos.length) * 100 : 0}%` }}
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
