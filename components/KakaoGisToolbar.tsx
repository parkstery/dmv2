
import React from 'react';
import { GISMode } from '../types';

interface KakaoGisToolbarProps {
  activeMode: GISMode;
  onAction: (mode: GISMode) => void;
  onToggleCadastral: () => void;
  onClear: () => void;
}

const KakaoGisToolbar: React.FC<KakaoGisToolbarProps> = ({ activeMode, onAction, onToggleCadastral, onClear }) => {
  return (
    <div className="absolute top-4 right-14 z-20 flex bg-white rounded-md shadow-lg border border-gray-300 overflow-hidden">
      <button 
        onClick={() => onAction(GISMode.ROADVIEW)}
        title="로드뷰"
        className={`w-9 h-8 flex items-center justify-center border-r border-gray-100 transition-colors ${activeMode === GISMode.ROADVIEW ? 'bg-blue-100' : 'hover:bg-gray-50'}`}
      >
        📷
      </button>
      <button 
        onClick={onToggleCadastral}
        title="지적도"
        className="w-9 h-8 flex items-center justify-center border-r border-gray-100 hover:bg-gray-50 transition-colors"
      >
        🗺️
      </button>
      <button 
        onClick={() => onAction(GISMode.DISTANCE)}
        title="거리 재기"
        className={`w-9 h-8 flex items-center justify-center border-r border-gray-100 transition-colors ${activeMode === GISMode.DISTANCE ? 'bg-blue-100' : 'hover:bg-gray-50'}`}
      >
        📏
      </button>
      <button 
        onClick={() => onAction(GISMode.AREA)}
        title="면적 재기"
        className={`w-9 h-8 flex items-center justify-center border-r border-gray-100 transition-colors ${activeMode === GISMode.AREA ? 'bg-blue-100' : 'hover:bg-gray-50'}`}
      >
        📐
      </button>
      <button 
        onClick={onClear}
        title="초기화"
        className="w-9 h-8 flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors"
      >
        🗑️
      </button>
    </div>
  );
};

export default KakaoGisToolbar;
