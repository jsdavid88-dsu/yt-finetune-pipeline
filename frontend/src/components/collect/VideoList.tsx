import { Video as VideoIcon, Clock, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { Video } from '../../types';

interface Props {
  videos: Video[];
  selectedId: string | null;
  onSelect: (v: Video) => void;
}

const statusConfig = {
  waiting: {
    label: '대기',
    class: 'badge-waiting',
    icon: Clock,
  },
  processing: {
    label: '진행중',
    class: 'badge-processing',
    icon: Loader2,
  },
  done: {
    label: '완료',
    class: 'badge-success',
    icon: CheckCircle2,
  },
  error: {
    label: '오류',
    class: 'badge-error',
    icon: XCircle,
  },
} as const;

export default function VideoList({ videos, selectedId, onSelect }: Props) {
  if (videos.length === 0) {
    return (
      <div className="card p-8 text-center text-gray-500">
        <VideoIcon size={32} className="mx-auto mb-3 opacity-50" />
        <p className="text-sm">수집된 동영상이 없습니다.</p>
        <p className="text-xs mt-1">URL을 입력하고 수집을 시작하세요.</p>
      </div>
    );
  }

  return (
    <div className="card divide-y divide-gray-800">
      <div className="px-4 py-2.5 text-sm font-medium text-gray-400 flex items-center gap-2">
        <VideoIcon size={14} />
        동영상 목록 ({videos.length}개)
      </div>
      <div className="max-h-80 overflow-y-auto">
        {videos.map((video) => {
          const status = statusConfig[video.status];
          const StatusIcon = status.icon;
          const isSelected = selectedId === video.id;
          return (
            <button
              key={video.id}
              onClick={() => onSelect(video)}
              className={`
                w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                ${isSelected ? 'bg-blue-600/10 border-l-2 border-blue-500' : 'hover:bg-gray-800/50 border-l-2 border-transparent'}
              `}
            >
              <div className="flex-1 min-w-0">
                <div className={`text-sm truncate ${video.status === 'error' ? 'text-red-300' : 'text-gray-200'}`}>{video.title}</div>
                {video.error ? (
                  <div className="text-xs text-red-400 truncate mt-0.5">{video.error}</div>
                ) : (
                  <div className="text-xs text-gray-500 truncate mt-0.5">{video.url}</div>
                )}
              </div>
              <span className={status.class}>
                <StatusIcon
                  size={10}
                  className={`mr-1 ${video.status === 'processing' ? 'animate-spin' : ''}`}
                />
                {status.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
