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

/** Extended progress with fields that may come from progress.json but aren't in the base type yet */
interface ExtendedTrainProgress extends TrainProgress {
  detail?: string;
  setup_step?: number;
  setup_total?: number;
  eval_loss?: number | null;
}

interface Props {
  project: Project | null;
  addLog: (level: 'info' | 'warn' | 'error' | 'success', msg: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  idle: 'Idle',
  starting: 'Preparing training environment...',
  setup: 'Setting up dependencies...',
  installing: 'Setting up dependencies...',
  loading_model: 'Downloading model...',
  training: 'Training in progress...',
  converting: 'Converting to GGUF format...',
  registering: 'Registering model with Ollama...',
  completed: 'Training complete! Model registered in Ollama.',
  failed: 'Training failed',
};

const defaultConfig: TrainConfig = {
  num_epochs: 2,
  learning_rate: 0.0001,
  batch_size: 2,
  lora_rank: 32,
  max_seq_length: 4096,
};

export default function TrainTab({ project, addLog }: Props) {
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [gpuChecking, setGpuChecking] = useState(true);
  const [models, setModels] = useState<TrainModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [config, setConfig] = useState<TrainConfig>(defaultConfig);
  const [progress, setProgress] = useState<ExtendedTrainProgress | null>(null);
  const [losses, setLosses] = useState<number[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive =
    progress !== null &&
    !['idle', 'completed', 'failed'].includes(progress.status as string);

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
      .then((raw: any) => {
        if (!raw || !raw.status || raw.status === 'idle') return;
        const ext: ExtendedTrainProgress = {
          status: raw.status,
          progress: raw.progress || 0,
          epoch: raw.epoch || 0,
          total_epochs: raw.total_epochs || 0,
          loss: typeof raw.loss === 'number' ? raw.loss : null,
          error: raw.error || null,
          detail: raw.detail,
          setup_step: raw.setup_step,
          setup_total: raw.setup_total,
          eval_loss: typeof raw.eval_loss === 'number' ? raw.eval_loss : null,
        };
        if (ext.status !== 'idle') {
          setProgress(ext);
          if (ext.loss !== null && typeof ext.loss === 'number') {
            setLosses((prev) => [...prev, ext.loss!]);
          }
          if (!['completed', 'failed', 'idle'].includes(ext.status as string)) {
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
        const raw: any = await trainStatus(project.id);
        const s: ExtendedTrainProgress = {
          status: raw?.status || 'idle',
          progress: raw?.progress || 0,
          epoch: raw?.epoch || 0,
          total_epochs: raw?.total_epochs || 0,
          loss: typeof raw?.loss === 'number' ? raw.loss : null,
          error: raw?.error || null,
          detail: raw?.detail,
          setup_step: raw?.setup_step,
          setup_total: raw?.setup_total,
          eval_loss: typeof raw?.eval_loss === 'number' ? raw.eval_loss : null,
        };
        setProgress(s);
        if (s.loss !== null && typeof s.loss === 'number') {
          setLosses((prev) => [...prev, s.loss!]);
        }
        if (s.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
          addLog('success', 'Training complete! Model registered in Ollama.');
        } else if (s.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          addLog('error', `Training failed: ${s.error || 'Unknown error'}`);
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
          <span className="flex-1">
            {STATUS_LABELS[progress.status as string] || progress.status}
            {progress.detail && (
              <span className="ml-2 text-xs opacity-80">— {progress.detail}</span>
            )}
          </span>
          {progress.status === 'failed' && progress.error && (
            <span className="text-xs text-red-300 ml-2">{progress.error}</span>
          )}
          {progress.status === 'failed' && (
            <button onClick={handleRetry} className="ml-2 text-xs flex items-center gap-1 hover:text-red-300 transition-colors">
              <RefreshCw size={12} />
              Retry
            </button>
          )}
        </div>
      )}

      {/* Progress Bar for setup phase */}
      {progress && ((progress.status as string) === 'setup' || progress.status === 'installing') && progress.setup_step != null && progress.setup_total != null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Setup step {progress.setup_step}/{progress.setup_total}</span>
            <span>{Math.round((progress.setup_step / progress.setup_total) * 100)}%</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.round((progress.setup_step / progress.setup_total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Progress Bar for training */}
      {progress && progress.status === 'training' && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Epoch {progress.epoch}/{progress.total_epochs}</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex gap-4 text-xs text-gray-500">
            {progress.loss != null && typeof progress.loss === 'number' && (
              <span>
                Loss: <span className="font-mono text-blue-400">{progress.loss.toFixed(4)}</span>
              </span>
            )}
            {progress.eval_loss != null && typeof progress.eval_loss === 'number' && (
              <span>
                Eval Loss: <span className="font-mono text-cyan-400">{progress.eval_loss.toFixed(4)}</span>
              </span>
            )}
          </div>
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
            step={(progress as any)?.step ?? 0}
            totalSteps={(progress as any)?.total_steps ?? 0}
            detail={progress?.detail || ''}
            isTraining={isActive}
          />
        </div>
      </div>
    </div>
  );
}
