import type {
  CollectJob,
  ProjectPreset,
  ChunkData,
  RefineJobStatus,
  TrainModel,
  TrainConfig,
  GpuInfo,
  TrainProgress,
  GenerateModel,
  PromptTemplate,
} from './types';

const BASE = '';

async function request<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API Error ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Collect ──────────────────────────────────────────────
export async function collectStart(
  url: string,
  playlist: boolean,
  projectId: string,
  topPercent?: number | null,
): Promise<{ jobId: string }> {
  const body: any = { url, project_id: projectId };
  if (topPercent) body.top_percent = topPercent;
  return request('/api/collect/start', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function collectStatus(jobId: string): Promise<CollectJob> {
  return request(`/api/collect/status/${jobId}`);
}

export async function collectStop(jobId: string): Promise<{ status: string }> {
  return request(`/api/collect/stop/${jobId}`, { method: 'POST' });
}

export async function collectResult(jobId: string): Promise<CollectJob> {
  return request(`/api/collect/result/${jobId}`);
}

export async function getPlaylistInfo(
  url: string,
  projectId: string
): Promise<{ count: number; videos: { video_id: string; title: string; view_count: number; duration: number }[] }> {
  return request('/api/collect/playlist-info', {
    method: 'POST',
    body: JSON.stringify({ url, project_id: projectId }),
  });
}

export async function getProjectVideos(
  projectId: string
): Promise<{ videos: any[] }> {
  return request(`/api/collect/videos/${projectId}`);
}

// ── Refine ───────────────────────────────────────────────
export async function refineDeduplicate(
  projectId: string,
  text: string
): Promise<{ text: string }> {
  return request('/api/refine/deduplicate', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, text }),
  });
}

export async function refineRewrite(
  projectId: string,
  text: string
): Promise<{ text: string }> {
  return request('/api/refine/rewrite', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, text }),
  });
}

export async function refineToJsonl(
  projectId: string,
  text: string
): Promise<{ jsonl: string }> {
  return request('/api/refine/to-jsonl', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, text }),
  });
}

export async function refineSaveText(
  projectId: string,
  text: string
): Promise<{ ok: boolean }> {
  return request('/api/refine/text', {
    method: 'PUT',
    body: JSON.stringify({ project_id: projectId, text }),
  });
}

// ── Refine Auto-Process ──────────────────────────────────
export async function refineAutoProcess(
  projectId: string,
  chunkSize?: number,
  model?: string
): Promise<{ job_id: string }> {
  const body: Record<string, unknown> = { project_id: projectId };
  if (chunkSize !== undefined) body.chunk_size = chunkSize;
  if (model !== undefined) body.model = model;
  return request('/api/refine/auto-process', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function refineAutoStatus(
  jobId: string
): Promise<RefineJobStatus> {
  return request(`/api/refine/auto-status/${jobId}`);
}

export async function refineGetChunks(
  projectId: string
): Promise<{ chunks: ChunkData[] }> {
  return request(`/api/refine/chunks/${projectId}`);
}

export async function refineGetOutlines(
  projectId: string
): Promise<{ outlines: any[] }> {
  return request(`/api/refine/outlines/${projectId}`);
}

export async function refineGetJsonl(
  projectId: string
): Promise<{ jsonl: string; count: number }> {
  return request(`/api/refine/jsonl/${projectId}`);
}

export async function refineUpdateChunkTag(
  projectId: string,
  chunkIndex: number,
  tags: { genre: string; topic: string; mood: string; scene_type: string }
): Promise<{ ok: boolean }> {
  return request(`/api/refine/chunk-tag/${projectId}/${chunkIndex}`, {
    method: 'PUT',
    body: JSON.stringify(tags),
  });
}

// ── Train ────────────────────────────────────────────────
export async function trainGpuCheck(): Promise<GpuInfo> {
  return request('/api/train/gpu-check');
}

export async function trainGetModels(): Promise<TrainModel[]> {
  return request('/api/train/models');
}

export async function trainGetConfig(): Promise<TrainConfig> {
  return request('/api/train/config');
}

export async function trainStart(body: {
  project_id: string;
  base_model: string;
  config: TrainConfig;
}): Promise<{ ok: boolean }> {
  return request('/api/train/start', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function trainStatus(projectId: string): Promise<TrainProgress> {
  return request(`/api/train/status/${projectId}`);
}

export async function trainStop(projectId: string): Promise<{ ok: boolean }> {
  return request(`/api/train/stop/${projectId}`, { method: 'POST' });
}

// ── Generate ─────────────────────────────────────────────
export async function generateGetModels(): Promise<GenerateModel[]> {
  const data: any = await request('/api/generate/models');
  return Array.isArray(data) ? data : (data?.models || []);
}

export function generateChatStream(
  model: string,
  messages: { role: string; content: string }[],
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE}/api/generate/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`API Error ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // Parse SSE lines
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              onDone();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) onChunk(parsed.content);
              if (parsed.text) onChunk(parsed.text);
            } catch {
              // Plain text chunk
              onChunk(data);
            }
          }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err);
    });

  return controller;
}

export async function generateBatch(
  model: string,
  prompts: string[]
): Promise<{ results: string[] }> {
  return request('/api/generate/batch', {
    method: 'POST',
    body: JSON.stringify({ model, prompts }),
  });
}

export async function generateExport(
  messages: { role: string; content: string }[],
  format: 'txt' | 'md'
): Promise<Blob> {
  const res = await fetch(`${BASE}/api/generate/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, format }),
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return res.blob();
}

// ── Projects ─────────────────────────────────────────────
export async function getProjects(): Promise<
  { id: string; name: string; preset: string; createdAt: string; videoCount: number }[]
> {
  return request('/api/collect/projects');
}

export async function createProject(
  name: string,
  preset: string = '일반'
): Promise<{ id: string; preset: string }> {
  return request('/api/collect/projects', {
    method: 'POST',
    body: JSON.stringify({ name, preset }),
  });
}

export async function getPresets(): Promise<ProjectPreset[]> {
  return request('/api/collect/presets');
}

// ── Templates ────────────────────────────────────────────
export async function getTemplates(): Promise<PromptTemplate[]> {
  return request('/api/generate/templates');
}

export async function saveTemplate(
  template: Omit<PromptTemplate, 'id'> & { id?: string }
): Promise<PromptTemplate> {
  return request('/api/generate/templates', {
    method: 'POST',
    body: JSON.stringify(template),
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await fetch(`${BASE}/api/generate/templates/${id}`, { method: 'DELETE' });
}
