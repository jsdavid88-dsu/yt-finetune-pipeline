import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Square,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Monitor,
} from 'lucide-react';
import type { Project, TrainModel, TrainConfig, GpuInfo, TrainProgress } from '../../types';
import {
  trainGpuCheck,
  trainGetModels,
  trainGetConfig,
  trainStart,
  trainStatus,
  trainStop,
} from '../../api';
import ModelSelect from './ModelSelect';
import TrainConfigForm from './TrainConfig';
import LossChart from './LossChart';

interface Props {
  project: Project | null;
  addLog: (level: 'info' | 'warn' | 'error' | 'success', msg: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  idle: '대기 중',
  starting: '학습 준비 중...',
  installing: '패키지 설치 중...',
  loading_model: '모델 로딩 중...',
  training: '학습 진행 중...',
  converting: 'GGUF 변환 중...',
  registering: 'Ollama에 모델 등록 중...',
  completed: '학습 완료! 모델이 Ollama에 등록되었습니다.',
  failed: '학습 실패',
};

const defaultConfig: TrainConfig = {
  num_epochs: 3,
  learning_rate: 0.0002,
  batch_size: 4,
  lora_rank: 16,
  max_seq_length: 2048,
};

export default function TrainTab({ project, addLog }: Props) {
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [gpuChecking, setGpuChecking] = useState(true);
  const [models, setModels] = useState<TrainModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [config, setConfig] = useState<TrainConfig>(defaultConfig);
  const [progress, setProgress] = useState<TrainProgress | null>(null);
  const [losses, setLosses] = useState<number[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive =
    progress !== null &&
    !['idle', 'completed', 'failed'].includes(progress.status);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // On mount: GPU check + load models + load default config
  useEffect(() => {
    setGpuChecking(true);
    trainGpuCheck()
      .then((info) => setGpuInfo(info))
      .catch(() => setGpuInfo({ available: false, info: 'GPU 확인 실패' }))
      .finally(() => setGpuChecking(false));

    trainGetModels()
      .then(setModels)
      .catch(() => {});

    trainGetConfig()
      .then((cfg) => setConfig(cfg))
      .catch(() => {});
  }, []);

  // If project changes and there's a running training, start polling
  useEffect(() => {
    if (!project) return;
    // Check if there's already an active training for this project
    trainStatus(project.id)
      .then((s) => {
        if (s.status !== 'idle') {
          setProgress(s);
          if (s.loss !== null) {
            setLosses((prev) => [...prev, s.loss!]);
          }
          if (!['completed', 'failed', 'idle'].includes(s.status)) {
            startPolling();
          }
        }
      })
      .catch(() => {});
  }, [project?.id]);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      if (!project) return;
      try {
        const s = await trainStatus(project.id);
        setProgress(s);
        if (s.loss !== null) {
          setLosses((prev) => [...prev, s.loss!]);
        }
        if (s.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
          addLog('success', '학습 완료! 모델이 Ollama에 등록되었습니다.');
        } else if (s.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          addLog('error', `학습 실패: ${s.error || '알 수 없는 오류'}`);
        }
      } catch {
        // continue polling
      }
    }, 3000);
  }, [project, addLog]);

  const handleStart = async () => {
    if (!selectedModel) {
      addLog('warn', '모델을 선택하세요.');
      return;
    }
    if (!project) {
      addLog('warn', '먼저 프로젝트를 선택하세요.');
      return;
    }

    setLosses([]);
    setProgress({ status: 'starting', epoch: 0, total_epochs: config.num_epochs, progress: 0, loss: null, error: null });
    addLog('info', `학습 시작: ${selectedModel}, ${config.num_epochs} 에포크`);

    try {
      await trainStart({
        project_id: project.id,
        base_model: selectedModel,
        config,
      });
      startPolling();
    } catch (err: any) {
      addLog('error', `학습 시작 실패: ${err.message}`);
      setProgress(null);
    }
  };

  const handleStop = async () => {
    if (!project) return;
    try {
      await trainStop(project.id);
      if (pollRef.current) clearInterval(pollRef.current);
      setProgress(null);
      addLog('warn', '학습이 중지되었습니다.');
    } catch (err: any) {
      addLog('error', `학습 중지 실패: ${err.message}`);
    }
  };

  const handleRetry = () => {
    setProgress(null);
    setLosses([]);
  };

  const progressPercent = progress ? Math.round(progress.progress * 100) : 0;

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div>
        <h1 className="text-lg font-semibold text-gray-100 mb-1">모델 학습</h1>
        <p className="text-sm text-gray-500">Unsloth QLoRA를 사용하여 모델을 미세 조정합니다.</p>
      </div>

      {/* GPU Status Banner */}
      {gpuChecking ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 px-3 py-2 bg-gray-800/50 rounded-lg">
          <Loader2 size={14} className="animate-spin" />
          GPU 상태 확인 중...
        </div>
      ) : gpuInfo && !gpuInfo.available ? (
        <div className="flex items-center gap-2 text-sm text-yellow-400 px-3 py-2 bg-yellow-900/20 border border-yellow-800/40 rounded-lg">
          <AlertTriangle size={14} />
          GPU가 감지되지 않습니다. LoRA 학습에는 NVIDIA GPU가 필요합니다.
        </div>
      ) : gpuInfo ? (
        <div className="flex items-center gap-2 text-sm text-green-400 px-3 py-2 bg-green-900/20 border border-green-800/40 rounded-lg">
          <Monitor size={14} />
          {gpuInfo.info}
        </div>
      ) : null}

      {/* Training Status Banner */}
      {progress && progress.status !== 'idle' && (
        <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
          progress.status === 'completed'
            ? 'bg-green-900/20 border border-green-800/40 text-green-400'
            : progress.status === 'failed'
            ? 'bg-red-900/20 border border-red-800/40 text-red-400'
            : 'bg-blue-900/20 border border-blue-800/40 text-blue-400'
        }`}>
          {progress.status === 'completed' ? (
            <CheckCircle2 size={14} />
          ) : progress.status === 'failed' ? (
            <AlertTriangle size={14} />
          ) : (
            <Loader2 size={14} className="animate-spin" />
          )}
          <span className="flex-1">{STATUS_LABELS[progress.status] || progress.status}</span>
          {progress.status === 'failed' && progress.error && (
            <span className="text-xs text-red-300 ml-2">{progress.error}</span>
          )}
          {progress.status === 'failed' && (
            <button onClick={handleRetry} className="ml-2 text-xs flex items-center gap-1 hover:text-red-300 transition-colors">
              <RefreshCw size={12} />
              다시 시도
            </button>
          )}
        </div>
      )}

      {/* Progress Bar for training */}
      {progress && progress.status === 'training' && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>에포크 {progress.epoch}/{progress.total_epochs}</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {progress.loss !== null && (
            <div className="text-xs text-gray-500">
              현재 Loss: <span className="font-mono text-blue-400">{progress.loss.toFixed(4)}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">
        {/* Left: Config */}
        <div className="space-y-4 overflow-y-auto">
          <div className="card p-4">
            <ModelSelect
              models={models}
              selectedId={selectedModel}
              onChange={setSelectedModel}
              loading={isActive}
            />
          </div>

          <TrainConfigForm
            config={config}
            setConfig={setConfig}
            disabled={isActive}
          />

          <div className="flex gap-2">
            {!isActive ? (
              <button
                onClick={handleStart}
                className="btn-primary flex-1"
                disabled={!gpuInfo?.available || !project}
              >
                <Play size={16} />
                학습 시작
              </button>
            ) : (
              <button onClick={handleStop} className="btn-danger flex-1">
                <Square size={16} />
                학습 중지
              </button>
            )}
          </div>
        </div>

        {/* Right: Loss chart */}
        <div className="col-span-2">
          <LossChart
            losses={losses}
            currentEpoch={progress?.epoch ?? 0}
            totalEpochs={progress?.total_epochs ?? config.num_epochs}
            elapsedTime=""
            isTraining={isActive}
          />
        </div>
      </div>
    </div>
  );
}
