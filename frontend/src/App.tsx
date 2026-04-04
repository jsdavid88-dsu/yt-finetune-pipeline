import { useState, useCallback } from 'react';
import type { TabId, Project, Video, LogEntry } from './types';
import Layout from './components/Layout';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('collect');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: '1',
      level: 'info',
      message: '애플리케이션이 시작되었습니다.',
      timestamp: new Date().toISOString(),
    },
  ]);

  const addLog = useCallback(
    (level: LogEntry['level'], message: string) => {
      setLogs((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          level,
          message,
          timestamp: new Date().toISOString(),
        },
      ]);
    },
    []
  );

  return (
    <Layout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      selectedProject={selectedProject}
      onSelectProject={setSelectedProject}
      videos={videos}
      setVideos={setVideos}
      logs={logs}
      addLog={addLog}
    />
  );
}
