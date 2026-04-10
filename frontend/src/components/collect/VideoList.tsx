import { useRef, useEffect } from 'react';
import { Video as VideoIcon, Clock, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { Video } from '../../types';

interface Props {
  videos: Video[];
  selectedId: string | null;
  onSelect: (v: Video) => void;
}

const statusConfig = {
  waiting: {
    label: '\ub300\uae30',
    class: 'badge-waiting',
    icon: Clock,
  },
  processing: {
    label: '\uc9c4\ud589\uc911',
    class: 'badge-processing',
    icon: Loader2,
  },
  done: {
    label: '\uc644\ub8cc',
    class: 'badge-success',
    icon: CheckCircle2,
  },
  error: {
    label: '\uc624\ub958',
    class: 'badge-error',
    icon: XCircle,
  },
} as const;

export default function VideoList({ videos, selectedId, onSelect }: Props) {
  const processingRef = useRef<HTMLButtonElement | null>(null);

  // Auto-scroll to the currently processing video
  useEffect(() => {
    if (processingRef.current) {
      processingRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [videos]);

  if (videos.length === 0) {
    return (
      <div className="card p-8 text-center text-gray-500">
        <VideoIcon size={32} className="mx-auto mb-3 opacity-50" />
        <p className="text-sm">{'\uc218\uc9d1\ub41c \ub3d9\uc601\uc0c1\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.'}</p>
        <p className="text-xs mt-1">URL{'\uc744 \uc785\ub825\ud558\uace0 \uc218\uc9d1\uc744 \uc2dc\uc791\ud558\uc138\uc694.'}</p>
      </div>
    );
  }

  return (
    <div className="card divide-y divide-gray-800">
      <div className="px-4 py-2.5 text-sm font-medium text-gray-400 flex items-center gap-2">
        <VideoIcon size={14} />
        {'\ub3d9\uc601\uc0c1 \ubaa9\ub85d'} ({videos.length}{'\uac1c'})
      </div>
      <div className="max-h-80 overflow-y-auto">
        {videos.map((video) => {
          const status = statusConfig[video.status];
          const StatusIcon = status.icon;
          const isSelected = selectedId === video.id;
          const isProcessing = video.status === 'processing';
          return (
            <button
              key={video.id}
              ref={isProcessing ? processingRef : undefined}
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
                  className={`mr-1 ${isProcessing ? 'animate-spin' : ''}`}
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
