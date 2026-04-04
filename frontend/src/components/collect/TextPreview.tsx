import { FileText } from 'lucide-react';
import type { Video } from '../../types';

interface Props {
  video: Video | null;
}

export default function TextPreview({ video }: Props) {
  if (!video) {
    return (
      <div className="card h-full flex items-center justify-center text-gray-500 p-8">
        <div className="text-center">
          <FileText size={32} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">동영상을 선택하면 추출된 텍스트가 여기에 표시됩니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card h-full flex flex-col">
      <div className="px-4 py-2.5 border-b border-gray-800 text-sm font-medium text-gray-400 flex items-center gap-2">
        <FileText size={14} />
        텍스트 미리보기
      </div>
      <div className="px-4 py-2 border-b border-gray-800">
        <h3 className="text-sm font-medium text-gray-200 truncate">{video.title}</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {video.status === 'done' && video.text ? (
          <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
            {video.text}
          </pre>
        ) : video.status === 'processing' ? (
          <div className="flex items-center gap-2 text-yellow-400 text-sm">
            <div className="w-4 h-4 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
            텍스트 추출 중...
          </div>
        ) : video.status === 'error' ? (
          <div className="text-red-400 text-sm">
            오류: {video.error || '텍스트를 추출할 수 없습니다.'}
          </div>
        ) : (
          <div className="text-gray-500 text-sm">대기 중...</div>
        )}
      </div>
    </div>
  );
}
