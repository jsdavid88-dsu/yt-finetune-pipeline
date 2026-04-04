import { useState, useEffect, useRef } from 'react';
import { Play, Square, Loader2 } from 'lucide-react';
import type { Project, TrainModel } from '../../types';
import { trainGetModels, trainStart, trainStatus } from '../../api';
import ModelSelect from './ModelSelect';
import TrainConfigForm from './TrainConfig';
import LossChart from './LossChart';

interface Props {
  project: Project | null;
  addLog: (level: 'info' | 'warn' | 'error' | 'success', msg: string) => void;
}

const defaultModels: TrainModel[] = [
  { id: 'llama3.2-3b', name: 'Llama 3.2', size: '3B' },
  { id: 'gemma2-2b', name: 'Gemma 2', size: '2B' },
  { id: 'qwen2.5-3b', name: 'Qwen 2.5', size: '3B' },
  { id: 'phi-3-mini', name: 'Phi-3 Mini', size: '3.8B' },
];

export default function TrainTab({ project, addLog }: Props) {
  const [models, setModels] = useState<TrainModel[]>(defaultModels);
  const [selectedModel, setSelectedModel] = useState('');
  const [epochs, setEpochs] = useState(3);
  const [learningRate, setLearningRate] = useState('2e-4');
  const [loraRank, setLoraRank] = useState(16);
  const [batchSize, setBatchSize] = useState(4);
  const [outputPath, setOutputPath] = useState('./output/lora-adapter');
  const [isTraining, setIsTraining] = useState(false);
  const [losses, setLosses] = useState<number[]>([]);
  const [currentEpoch, setCurrentEpoch] = useState(0);
  const [elapsedTime, setElapsedTime] = useState('00:00');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    trainGetModels()
      .then(setModels)
      .catch(() => setModels(defaultModels));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleStart = async () => {
    if (!selectedModel) {
      addLog('warn', '모델을 선택하세요.');
      return;
    }
    if (!project) {
      addLog('warn', '먼저 프로젝트를 선택하세요.');
      return;
    }

    setIsTraining(true);
    setLosses([]);
    setCurrentEpoch(0);
    addLog('info', `학습 시작: ${selectedModel}, ${epochs} 에포크`);

    try {
      const { jobId } = await trainStart({
        modelId: selectedModel,
        epochs,
        learningRate: parseFloat(learningRate),
        loraRank,
        batchSize,
        outputPath,
      });

      pollRef.current = setInterval(async () => {
        try {
          const status = await trainStatus(jobId);
          setLosses(status.loss);
          setCurrentEpoch(status.currentEpoch);
          setElapsedTime(status.elapsedTime);

          if (status.status === 'completed' || status.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            setIsTraining(false);
            if (status.status === 'completed') {
              addLog('success', `학습 완료! 어댑터가 ${outputPath}에 저장되었습니다.`);
            } else {
              addLog('error', '학습 실패');
            }
          }
        } catch {
          // continue polling
        }
      }, 3000);
    } catch {
      addLog('info', '데모 모드: 학습 시뮬레이션 시작');
      // Simulate training
      let step = 0;
      let loss = 2.5;
      pollRef.current = setInterval(() => {
        step++;
        loss = Math.max(0.1, loss * (0.85 + Math.random() * 0.1));
        setLosses((prev) => [...prev, parseFloat(loss.toFixed(4))]);
        setCurrentEpoch(Math.min(Math.ceil(step / 3), epochs));
        const mins = Math.floor(step * 3 / 60);
        const secs = (step * 3) % 60;
        setElapsedTime(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);

        if (step >= epochs * 3) {
          if (pollRef.current) clearInterval(pollRef.current);
          setIsTraining(false);
          addLog('success', '학습 시뮬레이션 완료');
        }
      }, 1000);
    }
  };

  const handleStop = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setIsTraining(false);
    addLog('warn', '학습이 중지되었습니다.');
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div>
        <h1 className="text-lg font-semibold text-gray-100 mb-1">모델 학습</h1>
        <p className="text-sm text-gray-500">QLoRA를 사용하여 모델을 미세 조정합니다.</p>
      </div>

      <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">
        {/* Left: Config */}
        <div className="space-y-4 overflow-y-auto">
          <div className="card p-4">
            <ModelSelect
              models={models}
              selectedId={selectedModel}
              onChange={setSelectedModel}
              loading={isTraining}
            />
          </div>

          <TrainConfigForm
            epochs={epochs}
            setEpochs={setEpochs}
            learningRate={learningRate}
            setLearningRate={setLearningRate}
            loraRank={loraRank}
            setLoraRank={setLoraRank}
            batchSize={batchSize}
            setBatchSize={setBatchSize}
            outputPath={outputPath}
            setOutputPath={setOutputPath}
            disabled={isTraining}
          />

          <div className="flex gap-2">
            {!isTraining ? (
              <button onClick={handleStart} className="btn-primary flex-1">
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

          {isTraining && (
            <div className="flex items-center gap-2 text-sm text-yellow-400 px-1">
              <Loader2 size={14} className="animate-spin" />
              학습 진행 중...
            </div>
          )}
        </div>

        {/* Right: Loss chart */}
        <div className="col-span-2">
          <LossChart
            losses={losses}
            currentEpoch={currentEpoch}
            totalEpochs={epochs}
            elapsedTime={elapsedTime}
            isTraining={isTraining}
          />
        </div>
      </div>
    </div>
  );
}
