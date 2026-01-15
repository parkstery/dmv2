import React, { useState, useEffect, useRef } from 'react';
import { MapVendor, PaneConfig, SearchResult, HistoryItem } from '../types';

interface HeaderProps {
  leftConfig: PaneConfig;
  rightConfig: PaneConfig;
  onLeftChange: (cfg: PaneConfig) => void;
  onRightChange: (cfg: PaneConfig) => void;
  onSearchSelect: (res: SearchResult) => void;
  onClearSearch: () => void;
}

const Header: React.FC<HeaderProps> = ({
  leftConfig,
  rightConfig,
  onLeftChange,
  onRightChange,
  onSearchSelect,
  onClearSearch
}) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const psRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Kakao Maps SDK Load & Places Init
    const initPlaces = () => {
      if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
        psRef.current = new window.kakao.maps.services.Places();
      }
    };

    if (window.kakao && window.kakao.maps) {
        // autoload=false이므로 load 호출 필요
        window.kakao.maps.load(() => {
            initPlaces();
        });
    }

    // Load History
    const saved = localStorage.getItem('mapSearchHistory');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  const saveToHistory = (item: SearchResult) => {
    const newItem: HistoryItem = { 
      name: item.place_name, 
      lat: parseFloat(item.y), 
      lng: parseFloat(item.x) 
    };
    // Remove duplicates and keep top 10
    const newHistory = [newItem, ...history.filter(h => h.name !== newItem.name)].slice(0, 10);
    setHistory(newHistory);
    localStorage.setItem('mapSearchHistory', JSON.stringify(newHistory));
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (!val.trim()) {
      setSuggestions([]);
      setShowHistory(true); // Show history when input is cleared
      return;
    }
    setShowHistory(false); // Hide history when typing

    if (psRef.current) {
      psRef.current.keywordSearch(val, (data: any, status: any) => {
        if (status === window.kakao.maps.services.Status.OK) {
          setSuggestions(data.slice(0, 10));
        } else {
          setSuggestions([]);
        }
      });
    }
  };

  const selectItem = (item: SearchResult) => {
    onSearchSelect(item);
    setQuery(item.place_name);
    setSuggestions([]);
    saveToHistory(item);
  };

  const selectHistoryItem = (item: HistoryItem) => {
    const res: SearchResult = {
      place_name: item.name,
      address_name: '',
      road_address_name: '',
      x: item.lng.toString(),
      y: item.lat.toString()
    };
    selectItem(res);
    setShowHistory(false);
  };

  // Close history when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(event.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative bg-[#222] text-white p-1.5 flex items-center gap-2 shadow-md z-[9999] overflow-visible whitespace-nowrap min-h-[46px]">
      {/* Left Control */}
      <div className="flex items-center gap-1">
        <select 
          value={leftConfig.type} 
          onChange={(e) => onLeftChange({...leftConfig, type: e.target.value as MapVendor})}
          className="bg-white text-black text-xs rounded px-1 py-1 h-[28px] outline-none border border-gray-400 font-sans"
        >
          <option value="google">Google</option>
          <option value="kakao">Kakao</option>
          <option value="naver">Naver</option>
        </select>
        <button 
          onClick={() => onLeftChange({...leftConfig, isSatellite: !leftConfig.isSatellite})}
          className="h-[28px] w-[28px] bg-white border border-gray-300 rounded flex items-center justify-center hover:bg-gray-100"
          title={leftConfig.isSatellite ? "지도 모드" : "위성 모드"}
        >
          {leftConfig.isSatellite ? '🛰️' : '🗺️'}
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative flex items-center gap-1 flex-grow max-w-sm group" ref={inputRef as any}>
        <input 
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={() => { if(!query) setShowHistory(true); }}
          placeholder="주소/지명"
          className="bg-white text-black text-sm px-2 py-1 rounded w-full h-[28px] outline-none border border-gray-300 focus:border-blue-500"
        />
        <button 
          onClick={() => { 
             setQuery(''); 
             onClearSearch(); 
             setSuggestions([]); 
             setShowHistory(true); // Show history when cleared
          }}
          className="h-[28px] w-[28px] bg-white border border-gray-300 rounded flex items-center justify-center text-gray-600 hover:bg-gray-100"
          title="지우기"
        >
          🗑️
        </button>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 bg-white border border-gray-400 shadow-xl max-h-60 overflow-y-auto z-[10000] mt-1 rounded text-black text-sm">
            {suggestions.map((item, idx) => (
              <div 
                key={idx}
                className={`px-3 py-2 cursor-pointer border-b border-gray-100 hover:bg-blue-50`}
                onClick={() => selectItem(item)}
              >
                <div className="font-bold truncate">{item.place_name}</div>
                <div className="text-xs text-gray-500 truncate">{item.road_address_name || item.address_name}</div>
              </div>
            ))}
          </div>
        )}

        {/* History */}
        {showHistory && history.length > 0 && suggestions.length === 0 && (
          <div className="absolute top-full left-0 w-48 bg-white border border-gray-400 shadow-xl z-[10000] mt-1 rounded text-black text-sm">
            <div className="px-2 py-1 bg-gray-100 text-xs font-bold text-gray-500">최근 검색 기록</div>
            {history.map((item, idx) => (
              <div 
                key={idx}
                className="px-3 py-2 cursor-pointer border-b border-gray-100 hover:bg-blue-50 truncate"
                onClick={() => selectHistoryItem(item)}
              >
                {item.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right Control */}
      <div className="flex items-center gap-1">
        <select 
          value={rightConfig.type} 
          onChange={(e) => onRightChange({...rightConfig, type: e.target.value as MapVendor})}
          className="bg-white text-black text-xs rounded px-1 py-1 h-[28px] outline-none border border-gray-400 font-sans"
        >
          <option value="google">Google</option>
          <option value="kakao">Kakao</option>
          <option value="naver">Naver</option>
        </select>
        <button 
          onClick={() => onRightChange({...rightConfig, isSatellite: !rightConfig.isSatellite})}
          className="h-[28px] w-[28px] bg-white border border-gray-300 rounded flex items-center justify-center hover:bg-gray-100"
          title={rightConfig.isSatellite ? "지도 모드" : "위성 모드"}
        >
          {rightConfig.isSatellite ? '🛰️' : '🗺️'}
        </button>
      </div>

      {/* Padlet Link */}
      <a 
        href="https://padlet.com/googiden/padlet-qr93paqb7efcunwe" 
        target="_blank" 
        rel="noreferrer"
        className="ml-auto text-[#4DC4FF] border border-[#4DC4FF] px-2 py-0.5 rounded text-xs font-bold hover:bg-[#4DC4FF] hover:text-white transition-colors whitespace-nowrap"
      >
        !! &gt;
      </a>
    </div>
  );
};

export default Header;
