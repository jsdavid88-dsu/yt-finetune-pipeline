export type TabId = 'collect' | 'refine' | 'train' | 'generate';

export interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

export interface ProjectPreset {
  name: string;
  genre: string;
  chunk_size: number;
  tagging_prompt: string;
  base_model: string;
  generation_prompt: string;
}

export interface Project {
  id: string;
  name: string;
  preset: string;
  createdAt: string;
  videoCount: number;
}

export interface Video {
  id: string;
  title: string;
  url: string;
  status: 'waiting' | 'processing' | 'done' | 'error';
  text?: string;
  error?: string;
}

export interface CollectJob {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  videos: Video[];
  progress: number;
  total: number;
}

export interface ChunkTag {
  genre: string;
  topic: string;
  mood: string;
  scene_type: string;
}

export interface ChunkAnalysis {
  genre: string;
  core_event: string;
  characters: string[];
  emotional_arc: string;
  hook: string;
  summary: string;
  narrative_technique: string;
  is_content: boolean;
}

export interface ChunkData {
  index: number;
  text: string;
  corrected_text?: string;
  tags: ChunkTag | null;
  analysis?: ChunkAnalysis | null;
  episode?: string;
}

export interface OutlineScene {
  index: number;
  position: string;
  core_event: string;
  emotional_arc: string;
  hook: string;
  summary: string;
}

export interface EpisodeOutline {
  episode: string;
  genre: string;
  scenes: OutlineScene[];
}

export interface RefineJobStatus {
  job_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total: number;
  processed: number;
  current_chunk_preview: string | null;
  error: string | null;
}

export interface RefineResult {
  original: string;
  refined: string;
  jsonl: string;
}

export interface TrainModel {
  id: string;
  name: string;
  params: string;
}

export interface TrainConfig {
  num_epochs: number;
  learning_rate: number;
  batch_size: number;
  lora_rank: number;
  max_seq_length: number;
}

export interface GpuInfo {
  available: boolean;
  info: string;
}

export interface TrainProgress {
  status: "idle" | "starting" | "installing" | "loading_model" | "training" | "converting" | "registering" | "completed" | "failed";
  epoch: number;
  total_epochs: number;
  progress: number;
  loss: number | null;
  error: string | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
}

export interface GenerateModel {
  name: string;
  size: string;
  modified_at: string;
}

export interface JsonlEntry {
  instruction: string;
  input: string;
  output: string;
}

export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  timestamp: string;
}
