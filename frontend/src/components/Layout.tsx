import type { TabId, Project, Video, LogEntry } from '../types';
import TabBar from './TabBar';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import CollectTab from './collect/CollectTab';
import RefineTab from './refine/RefineTab';
import TrainTab from './train/TrainTab';
import GenerateTab from './generate/GenerateTab';

interface Props {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  selectedProject: Project | null;
  onSelectProject: (p: Project) => void;
  videos: Video[];
  setVideos: React.Dispatch<React.SetStateAction<Video[]>>;
  logs: LogEntry[];
  addLog: (level: LogEntry['level'], msg: string) => void;
}

export default function Layout({
  activeTab,
  onTabChange,
  selectedProject,
  onSelectProject,
  videos,
  setVideos,
  logs,
  addLog,
}: Props) {
  const renderTab = () => {
    switch (activeTab) {
      case 'collect':
        return <CollectTab project={selectedProject} addLog={addLog} videos={videos} setVideos={setVideos} />;
      case 'refine':
        return <RefineTab project={selectedProject} addLog={addLog} videos={videos} />;
      case 'train':
        return <TrainTab project={selectedProject} addLog={addLog} />;
      case 'generate':
        return <GenerateTab project={selectedProject} addLog={addLog} />;
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TabBar activeTab={activeTab} onTabChange={onTabChange} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          selectedProject={selectedProject}
          onSelectProject={onSelectProject}
          addLog={addLog}
        />
        <main className="flex-1 overflow-y-auto p-6">{renderTab()}</main>
      </div>
      <StatusBar logs={logs} />
    </div>
  );
}
