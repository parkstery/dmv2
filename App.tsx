
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { MapState, PaneConfig, MapVendor, SearchResult } from './types';
import Header from './components/Header';
import MapPane from './components/MapPane';

const App: React.FC = () => {
  const [globalState, setGlobalState] = useState<MapState>({
    lat: 37.5665,
    lng: 126.9780,
    zoom: 13
  });

  const [leftConfig, setLeftConfig] = useState<PaneConfig>({
    type: 'google',
    isSatellite: true
  });

  const [rightConfig, setRightConfig] = useState<PaneConfig>({
    type: 'kakao',
    isSatellite: false
  });

  const [searchPos, setSearchPos] = useState<{lat: number, lng: number} | null>(null);
  const [fullscreenPane, setFullscreenPane] = useState<'left' | 'right' | null>(null);

  // Ref to track which pane is currently "driving" the sync
  const activeSyncRef = useRef<'left' | 'right' | null>(null);

  const handleStateChange = useCallback((newState: MapState, source: 'left' | 'right') => {
    if (activeSyncRef.current === null || activeSyncRef.current === source) {
      activeSyncRef.current = source;
      setGlobalState(newState);
      setTimeout(() => {
        activeSyncRef.current = null;
      }, 50);
    }
  }, []);

  const handleSearchSelect = useCallback((result: SearchResult) => {
    const newPos = { lat: parseFloat(result.y), lng: parseFloat(result.x) };
    setGlobalState({ ...newPos, zoom: 18 });
    setSearchPos(newPos);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchPos(null);
  }, []);

  const toggleFullscreen = (side: 'left' | 'right') => {
    setFullscreenPane(prev => (prev === side ? null : side));
  };

  // Handle Resize on Layout Change
  useEffect(() => {
    // Trigger window resize event to force maps to check their container size
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 100);
  }, [fullscreenPane]);

  return (
    <div className="flex flex-col h-[100dvh] w-screen bg-gray-100 overflow-hidden font-sans">
      <Header 
        leftConfig={leftConfig}
        rightConfig={rightConfig}
        onLeftChange={setLeftConfig}
        onRightChange={setRightConfig}
        onSearchSelect={handleSearchSelect}
        onClearSearch={clearSearch}
      />
      
      <div className="flex flex-1 flex-col md:flex-row overflow-hidden relative">
        {/* Left Pane */}
        <div className={`
          relative transition-all duration-300 ease-in-out border-b md:border-b-0 md:border-r border-gray-600
          ${fullscreenPane === 'right' ? 'hidden' : 'flex-1'}
          ${fullscreenPane === 'left' ? 'h-full w-full' : ''}
        `}>
          <MapPane 
            side="left"
            config={leftConfig}
            globalState={globalState}
            onStateChange={(state) => handleStateChange(state, 'left')}
            searchPos={searchPos}
            isFullscreen={fullscreenPane === 'left'}
            onToggleFullscreen={() => toggleFullscreen('left')}
          />
        </div>

        {/* Right Pane */}
        <div className={`
          relative transition-all duration-300 ease-in-out
          ${fullscreenPane === 'left' ? 'hidden' : 'flex-1'}
          ${fullscreenPane === 'right' ? 'h-full w-full' : ''}
        `}>
          <MapPane 
            side="right"
            config={rightConfig}
            globalState={globalState}
            onStateChange={(state) => handleStateChange(state, 'right')}
            searchPos={searchPos}
            isFullscreen={fullscreenPane === 'right'}
            onToggleFullscreen={() => toggleFullscreen('right')}
          />
        </div>
      </div>
    </div>
  );
};

export default App;
