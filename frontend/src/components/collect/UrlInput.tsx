import { useState } from 'react';
import { Play, Link, ListVideo, Search } from 'lucide-react';

interface Props {
  onSubmit: (url: string, playlist: boolean) => void;
  loading: boolean;
  onPreview?: (url: string) => void;
}

export default function UrlInput({ onSubmit, loading, onPreview }: Props) {
  const [url, setUrl] = useState('');
  const [playlist, setPlaylist] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    const urls = url.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    for (const u of urls) {
      onSubmit(u, playlist);
    }
  };

  const handlePreview = () => {
    if (!url.trim() || !onPreview) return;
    onPreview(url.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="card p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-1">
        <Link size={16} className="text-blue-400" />
        YouTube URL 입력
      </div>

      <div className="flex gap-2">
        <textarea
          value={url}
          onChange={(e) => setUrl(e.target.value)}
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
              disabled={loading || !url.trim()}
              className="btn-secondary text-xs"
            >
              <Search size={14} />
              미리보기
            </button>
          )}
        </div>
      </div>

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
    </form>
  );
}
