import { useEffect, useState } from 'react';
import { Wifi, WifiOff, AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react';
import type { LogEntry } from '../types';

interface Props {
  logs: LogEntry[];
}

export default function StatusBar({ logs }: Props) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
        setConnected(res.ok);
      } catch {
        setConnected(false);
      }
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  const latest = logs[logs.length - 1];

  const iconMap = {
    info: <Info size={12} className="text-blue-400" />,
    warn: <AlertTriangle size={12} className="text-yellow-400" />,
    error: <AlertCircle size={12} className="text-red-400" />,
    success: <CheckCircle2 size={12} className="text-green-400" />,
  };

  return (
    <div className="h-7 bg-gray-900 border-t border-gray-800 flex items-center px-4 text-xs text-gray-500 gap-4 shrink-0">
      {/* Connection status */}
      <div className="flex items-center gap-1.5">
        {connected ? (
          <>
            <Wifi size={12} className="text-green-500" />
            <span className="text-green-500">연결됨</span>
          </>
        ) : (
          <>
            <WifiOff size={12} className="text-red-500" />
            <span className="text-red-500">연결 안됨</span>
          </>
        )}
      </div>

      <div className="w-px h-3.5 bg-gray-700" />

      {/* Latest log */}
      {latest && (
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {iconMap[latest.level]}
          <span className="truncate">{latest.message}</span>
          <span className="text-gray-600 shrink-0 ml-auto">
            {new Date(latest.timestamp).toLocaleTimeString('ko-KR')}
          </span>
        </div>
      )}
    </div>
  );
}
