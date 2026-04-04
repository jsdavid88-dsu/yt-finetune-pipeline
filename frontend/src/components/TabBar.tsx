import { Download, FileText, Brain, PenTool } from 'lucide-react';
import type { TabId } from '../types';

interface Props {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const tabs: { id: TabId; label: string; icon: typeof Download }[] = [
  { id: 'collect', label: '수집', icon: Download },
  { id: 'refine', label: '정제', icon: FileText },
  { id: 'train', label: '학습', icon: Brain },
  { id: 'generate', label: '생성', icon: PenTool },
];

export default function TabBar({ activeTab, onTabChange }: Props) {
  return (
    <div className="flex items-center bg-gray-900 border-b border-gray-800 px-4">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              flex items-center gap-2 px-5 py-3 text-sm font-medium
              border-b-2 transition-colors duration-150
              ${
                isActive
                  ? 'border-blue-500 text-blue-400 bg-gray-950/50'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
              }
            `}
          >
            <Icon size={16} />
            {tab.label}
          </button>
        );
      })}
      <div className="flex-1" />
      <span className="text-xs text-gray-500">YT Fine-tune Pipeline</span>
    </div>
  );
}
