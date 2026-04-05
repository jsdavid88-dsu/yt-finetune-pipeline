import { useState } from 'react';
import { Play, Link, ListVideo, Search, Filter } from 'lucide-react';

interface PlaylistPreview {
  count: number;
  videos: { video_id: string; title: string; view_count: number; duration: number }[];
}

interface Props {
  onSubmit: (url: string, playlist: boolean, topPercent: number | null) => void;
  loading: boolean;
  onPreview?: (url: string) => Promise<PlaylistPreview | null>;
}

const FILTER_OPTIONS = [
  { label: '전체', value: null },
  { label: '상위 10%', value: 10 },
  { label: '상위 25%', value: 25 },
  { label: '상위 50%', value: 50 },
];

function formatViews(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}천`;
  return `${n}`;
}

export default function UrlInput({ onSubmit, loading, onPreview }: Props) {
  const [url, setUrl] = useState('');
  const [playlist, setPlaylist] = useState(false);
  const [topPercent, setTopPercent] = useState<number | null>(null);
  const [preview, setPreview] = useState<PlaylistPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    const urls = url.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    onSubmit(urls.join('\n'), playlist, topPercent);
  };

  const handlePreview = async () => {
    if (!url.trim() || !onPreview) return;
    setPreviewing(true);
    const result = await onPreview(url.trim());
    setPreview(result);
    setPreviewing(false);
  };

  // Calculate filtered count
  const filteredCount = preview
    ? topPercent
      ? Math.max(1, Math.floor(preview.count * topPercent / 100))
      : preview.count
    : 0;

  // Get cutoff view count for display
  const cutoffViews = preview && topPercent && preview.videos.length > 0
    ? preview.videos[Math.min(filteredCount - 1, preview.videos.length - 1)]?.view_count || 0
    : 0;

  return (
    <form onSubmit={handleSubmit} className="card p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-1">
        <Link size={16} className="text-blue-400" />
        YouTube URL 입력
      </div>

      <div className="flex gap-2">
        <textarea
          value={url}
          onChange={(e) => { setUrl(e.target.value); setPreview(null); }}
          placeholder={"URL을 입력하세요 (여러 개는 줄바꿈으로 구분)\nhttps://www.youtube.com/watch?v=...\nhttps://www.youtube.com/playlist?list=..."}
          className="input-field flex-1 resize-none"
          rows={3}
          disabled={loading}
        />
        <div className="flex flex-col gap-2">
          <button type="submit" disabled={loading || !url.trim()} className="btn-primary flex-1">
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Play size={16} />
            )}
            수집 시작
          </button>
          {onPreview && (
            <button
              type="button"
              onClick={handlePreview}
              disabled={loading || previewing || !url.trim()}
              className="btn-secondary text-xs"
            >
              {previewing ? (
                <div className="w-3 h-3 border-2 border-gray-400/30 border-t-gray-400 rounded-full animate-spin" />
              ) : (
                <Search size={14} />
              )}
              미리보기
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={playlist}
            onChange={(e) => setPlaylist(e.target.checked)}
            className="w-4 h-4 rounded bg-gray-800 border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
          />
          <ListVideo size={14} />
          재생목록 전체 수집
        </label>

        {/* Filter option */}
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Filter size={14} />
          <select
            value={topPercent ?? ''}
            onChange={(e) => setTopPercent(e.target.value ? Number(e.target.value) : null)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-300"
            disabled={loading}
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.value ?? ''}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500">(조회수 기준)</span>
        </div>
      </div>

      {/* Preview results */}
      {preview && (
        <div className="bg-gray-800/50 rounded-lg p-3 space-y-2 border border-gray-700/50">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">
              총 <span className="text-white font-semibold">{preview.count.toLocaleString()}</span>개 영상
              {topPercent && (
                <>
                  {' → '}
                  <span className="text-blue-400 font-semibold">{filteredCount.toLocaleString()}</span>개 수집 예정
                  <span className="text-gray-500 text-xs ml-1">
                    ({cutoffViews.toLocaleString()}회 이상)
                  </span>
                </>
              )}
            </span>
          </div>

          {/* Top videos preview */}
          <div className="max-h-[200px] overflow-y-auto space-y-1">
            {preview.videos.slice(0, topPercent ? filteredCount : 20).map((v, i) => (
              <div
                key={v.video_id}
                className={`flex items-center gap-2 text-xs py-1 px-2 rounded ${
                  topPercent && i >= filteredCount ? 'opacity-30' : ''
                }`}
              >
                <span className="text-gray-500 w-6 text-right">{i + 1}.</span>
                <span className="text-yellow-400 w-14 text-right">{formatViews(v.view_count)}회</span>
                <span className="text-gray-500 w-10 text-right">{Math.floor((v.duration || 0) / 60)}분</span>
                <span className="text-gray-300 truncate flex-1">{v.title}</span>
              </div>
            ))}
            {!topPercent && preview.videos.length > 20 && (
              <div className="text-xs text-gray-500 text-center py-1">
                ... 외 {preview.videos.length - 20}개
              </div>
            )}
          </div>
        </div>
      )}
    </form>
  );
}
