
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MapVendor, MapState, PaneConfig, GISMode } from '../types';
import KakaoGisToolbar from './KakaoGisToolbar';

interface MapPaneProps {
  side: 'left' | 'right';
  config: PaneConfig;
  globalState: MapState;
  onStateChange: (state: MapState) => void;
  searchPos: { lat: number, lng: number } | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

const MapPane: React.FC<MapPaneProps> = ({ 
  side, config, globalState, onStateChange, searchPos, 
  isFullscreen, onToggleFullscreen 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  
  // -- Sync Control Refs --
  const isDragging = useRef(false); 
  const isProgrammaticUpdate = useRef(false);

  const [sdkLoaded, setSdkLoaded] = useState(false); 
  
  // -- Street View / Road View States --
  const [isStreetViewActive, setIsStreetViewActive] = useState(false);

  // Google Refs
  const googlePanoRef = useRef<HTMLDivElement>(null);
  const googlePanoInstanceRef = useRef<any>(null);

  // Naver Refs
  const naverStreetLayerRef = useRef<any>(null);
  const naverPanoramaRef = useRef<any>(null);
  const naverPanoContainerRef = useRef<HTMLDivElement>(null);
  const [isNaverLayerOn, setIsNaverLayerOn] = useState(false);

  // Kakao Refs
  const kakaoGisRef = useRef<{
    rv: any;
    rvClient: any;
    geocoder: any;
    walker: any;
    roadviewLayer: boolean;
    clickHandler?: any; // To store and remove click handler
  }>({
    rv: null,
    rvClient: null,
    geocoder: null,
    walker: null,
    roadviewLayer: false
  });
  const [gisMode, setGisMode] = useState<GISMode>(GISMode.DEFAULT);
  const roadviewRef = useRef<HTMLDivElement>(null);

  // Helper: Zoom conversion
  const zoomToKakao = (z: number) => Math.max(1, Math.min(14, 20 - z));
  const kakaoToZoom = (l: number) => Math.max(3, Math.min(20, 20 - l));

  // 1. SDK Loading Check & Init
  useEffect(() => {
    let intervalId: any = null;
    const checkAndInit = () => {
      // 1. Google
      if (config.type === 'google' && window.google && window.google.maps) {
        if (containerRef.current) containerRef.current.innerHTML = ''; // Clean Container
        initGoogleMap();
        return true;
      }
      // 2. Kakao
      if (config.type === 'kakao' && window.kakao && window.kakao.maps) {
        window.kakao.maps.load(() => {
          if (containerRef.current) containerRef.current.innerHTML = ''; // Clean Container
          initKakaoMap();
        });
        return true;
      }
      // 3. Naver
      if (config.type === 'naver' && window.naver && window.naver.maps) {
        if (containerRef.current) containerRef.current.innerHTML = ''; // Clean Container
        initNaverMap();
        return true;
      }
      return false;
    };

    if (!checkAndInit()) {
      intervalId = setInterval(() => {
        if (checkAndInit()) {
          clearInterval(intervalId);
          setSdkLoaded(true);
        }
      }, 300);
    } else {
      setSdkLoaded(true);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.type]); // Re-run when map type changes

  // ** Reset Refs on Config Change **
  useEffect(() => {
    isDragging.current = false;
    isProgrammaticUpdate.current = false;
    setIsNaverLayerOn(false); // Reset GIS tools
    setGisMode(GISMode.DEFAULT);
  }, [config.type]);


  // -- Resize & Refresh Handler --
  useEffect(() => {
    if (!mapRef.current) return;
    
    const timer = setTimeout(() => {
      try {
        if (config.type === 'google') {
          window.google.maps.event.trigger(mapRef.current, 'resize');
          mapRef.current.setCenter({ lat: globalState.lat, lng: globalState.lng });
        } else if (config.type === 'kakao') {
          mapRef.current.relayout();
          mapRef.current.setCenter(new window.kakao.maps.LatLng(globalState.lat, globalState.lng));
        } else if (config.type === 'naver') {
          window.naver.maps.Event.trigger(mapRef.current, 'resize');
          mapRef.current.setCenter(new window.naver.maps.LatLng(globalState.lat, globalState.lng));
          
          // CRITICAL: Naver Panorama Resize Trigger
          if (isStreetViewActive && naverPanoramaRef.current) {
             window.naver.maps.Event.trigger(naverPanoramaRef.current, 'resize');
          }
        }
      } catch(e) { console.error(e); }
    }, 350); 
    
    return () => clearTimeout(timer);
  }, [isStreetViewActive, config.type]);


  // 2. Initialize Maps
  const initGoogleMap = () => {
    if (!containerRef.current || !googlePanoRef.current) return;
    
    const panorama = new window.google.maps.StreetViewPanorama(googlePanoRef.current, {
       visible: false,
       enableCloseButton: true
    });
    googlePanoInstanceRef.current = panorama;

    mapRef.current = new window.google.maps.Map(containerRef.current, {
      center: { lat: globalState.lat, lng: globalState.lng },
      zoom: globalState.zoom,
      mapTypeId: config.isSatellite ? 'satellite' : 'roadmap',
      disableDefaultUI: false,
      zoomControl: true,
      streetViewControl: true, 
      streetView: panorama,
      gestureHandling: 'greedy'
    });
    
    setupMapListeners('google');

    panorama.addListener('visible_changed', () => {
      const isVisible = panorama.getVisible();
      setIsStreetViewActive(isVisible);
    });

    panorama.addListener('position_changed', () => {
      if (panorama.getVisible()) {
        const pos = panorama.getPosition();
        if (pos) {
          isDragging.current = true; 
          onStateChange({ lat: pos.lat(), lng: pos.lng(), zoom: mapRef.current.getZoom() });
          mapRef.current.setCenter(pos); 
          setTimeout(() => isDragging.current = false, 200);
        }
      }
    });
  };

  const initKakaoMap = () => {
    if (!containerRef.current) return;
    const options = {
      center: new window.kakao.maps.LatLng(globalState.lat, globalState.lng),
      level: zoomToKakao(globalState.zoom)
    };
    mapRef.current = new window.kakao.maps.Map(containerRef.current, options);
    if (config.isSatellite) {
      mapRef.current.setMapTypeId(window.kakao.maps.MapTypeId.HYBRID);
    }
    
    if (window.kakao.maps.services) {
      kakaoGisRef.current.geocoder = new window.kakao.maps.services.Geocoder();
    }
    kakaoGisRef.current.rvClient = new window.kakao.maps.RoadviewClient();
    
    setupMapListeners('kakao');
    setupKakaoRightClick();
  };

  const initNaverMap = () => {
    if (!containerRef.current) return;
    mapRef.current = new window.naver.maps.Map(containerRef.current, {
      center: new window.naver.maps.LatLng(globalState.lat, globalState.lng),
      zoom: globalState.zoom,
      mapTypeId: config.isSatellite ? window.naver.maps.MapTypeId.SATELLITE : window.naver.maps.MapTypeId.NORMAL
    });
    
    naverStreetLayerRef.current = new window.naver.maps.StreetLayer();
    
    setupMapListeners('naver');
    
    window.naver.maps.Event.addListener(mapRef.current, 'click', (e: any) => {
      if (naverStreetLayerRef.current?.getMap()) {
         const latlng = e.coord;
         setIsStreetViewActive(true);
         
         // Increased timeout to wait for container transition to finish
         setTimeout(() => {
           if (naverPanoContainerRef.current) {
             if (!naverPanoramaRef.current) {
                // 파노라마 초기화
                naverPanoramaRef.current = new window.naver.maps.Panorama(naverPanoContainerRef.current, {
                  position: latlng,
                  pov: { pan: -135, tilt: 29, fov: 100 },
                  visible: true,
                  zoomControl: true,
                  minScale: 0, 
                  maxScale: 10,
                });
                
                window.naver.maps.Event.addListener(naverPanoramaRef.current, 'position_changed', () => {
                   const pos = naverPanoramaRef.current.getPosition();
                   isDragging.current = true;
                   onStateChange({ lat: pos.lat(), lng: pos.lng(), zoom: mapRef.current.getZoom() });
                   mapRef.current.setCenter(pos);
                   setTimeout(() => isDragging.current = false, 200);
                });
             } else {
               naverPanoramaRef.current.setPosition(latlng);
             }
           }
         }, 350); // 350ms to ensure CSS transition (300ms) is complete
      }
    });
  };

  // 3. Common Map Listeners (Robust Sync with Epsilon Check)
  const setupMapListeners = (type: MapVendor) => {
    if (!mapRef.current) return;

    // Helper: Coordinate Epsilon Check to prevent loops
    // Loop Prevention with higher tolerance (0.00001 ~ 1m)
    const shouldUpdate = (newLat: number, newLng: number, newZoom: number) => {
        if (isProgrammaticUpdate.current) return false;
        
        const latDiff = Math.abs(newLat - globalState.lat);
        const lngDiff = Math.abs(newLng - globalState.lng);
        
        if (latDiff < 0.00001 && lngDiff < 0.00001 && newZoom === globalState.zoom) {
            return false;
        }
        return true;
    };

    // --- GOOGLE ---
    if (type === 'google') {
      mapRef.current.addListener('dragstart', () => { isDragging.current = true; });
      mapRef.current.addListener('dragend', () => { isDragging.current = false; });
      
      const handleUpdate = () => {
        const c = mapRef.current.getCenter();
        const z = mapRef.current.getZoom();
        if (shouldUpdate(c.lat(), c.lng(), z)) {
            onStateChange({ lat: c.lat(), lng: c.lng(), zoom: z });
        }
      };

      mapRef.current.addListener('center_changed', handleUpdate);
      mapRef.current.addListener('zoom_changed', handleUpdate);

    // --- KAKAO ---
    } else if (type === 'kakao') {
      window.kakao.maps.event.addListener(mapRef.current, 'dragstart', () => { isDragging.current = true; });
      window.kakao.maps.event.addListener(mapRef.current, 'dragend', () => { isDragging.current = false; });

      const handleUpdate = () => {
        const c = mapRef.current.getCenter();
        const z = kakaoToZoom(mapRef.current.getLevel());
        if (shouldUpdate(c.getLat(), c.getLng(), z)) {
            onStateChange({ lat: c.getLat(), lng: c.getLng(), zoom: z });
        }
      };

      window.kakao.maps.event.addListener(mapRef.current, 'center_changed', handleUpdate);
      window.kakao.maps.event.addListener(mapRef.current, 'zoom_changed', handleUpdate);

    // --- NAVER ---
    } else if (type === 'naver') {
      window.naver.maps.Event.addListener(mapRef.current, 'dragstart', () => { isDragging.current = true; });
      window.naver.maps.Event.addListener(mapRef.current, 'dragend', () => { isDragging.current = false; });

      const handleUpdate = () => {
        // Ensure we don't process updates during programmatic move
        if (isProgrammaticUpdate.current) return;

        const c = mapRef.current.getCenter();
        const z = mapRef.current.getZoom();
        if (shouldUpdate(c.lat(), c.lng(), z)) {
            onStateChange({ lat: c.lat(), lng: c.lng(), zoom: z });
        }
      };

      window.naver.maps.Event.addListener(mapRef.current, 'center_changed', handleUpdate);
      window.naver.maps.Event.addListener(mapRef.current, 'zoom_changed', handleUpdate);
    }
  };

  const setupKakaoRightClick = () => {
    window.kakao.maps.event.addListener(mapRef.current, 'rightclick', (e: any) => {
      if (!kakaoGisRef.current.geocoder) return;
      const pos = e.latLng;
      kakaoGisRef.current.geocoder.coord2Address(pos.getLng(), pos.getLat(), (result: any, status: any) => {
        if (status === window.kakao.maps.services.Status.OK) {
          const address = result[0].road_address?.address_name || result[0].address?.address_name || '주소없음';
          const content = `<div class="info-overlay"><div class="font-bold">📍 ${address}</div></div>`;
          const overlay = new window.kakao.maps.CustomOverlay({
            position: pos, content: content, yAnchor: 2.2, map: mapRef.current
          });
          setTimeout(() => overlay.setMap(null), 3000);
        }
      });
    });
  };

  // 4. Update Effects (Global State -> Map)
  useEffect(() => {
    if (!mapRef.current) return;
    
    // If user is dragging, do not apply external updates to prevent jitter
    if (isDragging.current) return;

    isProgrammaticUpdate.current = true;

    try {
        if (config.type === 'google') {
          mapRef.current.setCenter({ lat: globalState.lat, lng: globalState.lng });
          mapRef.current.setZoom(globalState.zoom);
        } else if (config.type === 'kakao') {
          const center = mapRef.current.getCenter();
          if (Math.abs(center.getLat() - globalState.lat) > 0.000001 || Math.abs(center.getLng() - globalState.lng) > 0.000001) {
             mapRef.current.setCenter(new window.kakao.maps.LatLng(globalState.lat, globalState.lng));
          }
          mapRef.current.setLevel(zoomToKakao(globalState.zoom));
        } else if (config.type === 'naver') {
          mapRef.current.setCenter(new window.naver.maps.LatLng(globalState.lat, globalState.lng));
          mapRef.current.setZoom(globalState.zoom);
        }
    } catch(e) {}
    
    // Timeout to allow map to settle and prevent event echo
    setTimeout(() => { isProgrammaticUpdate.current = false; }, 200); 
  }, [globalState.lat, globalState.lng, globalState.zoom, config.type, sdkLoaded]);

  // Type change effect
  useEffect(() => {
    if (!mapRef.current) return;
    try {
      if (config.type === 'google') {
        mapRef.current.setMapTypeId(config.isSatellite ? 'satellite' : 'roadmap');
      } else if (config.type === 'kakao') {
        mapRef.current.setMapTypeId(config.isSatellite ? window.kakao.maps.MapTypeId.HYBRID : window.kakao.maps.MapTypeId.ROADMAP);
      } else if (config.type === 'naver') {
        mapRef.current.setMapTypeId(config.isSatellite ? window.naver.maps.MapTypeId.SATELLITE : window.naver.maps.MapTypeId.NORMAL);
      }
    } catch(e) {}
  }, [config.isSatellite, config.type, sdkLoaded]);

  // Marker Update
  useEffect(() => {
    if (!mapRef.current) return;
    // Marker reset is tricky across vendors, best to create new always
    if (markerRef.current) {
        try { markerRef.current.setMap(null); } catch(e){}
    }
    
    if (searchPos) {
      try {
          if (config.type === 'google') {
            markerRef.current = new window.google.maps.Marker({ position: searchPos, map: mapRef.current });
          } else if (config.type === 'kakao') {
            markerRef.current = new window.kakao.maps.Marker({ position: new window.kakao.maps.LatLng(searchPos.lat, searchPos.lng), map: mapRef.current });
          } else if (config.type === 'naver') {
            markerRef.current = new window.naver.maps.Marker({ position: new window.naver.maps.LatLng(searchPos.lat, searchPos.lng), map: mapRef.current });
          }
      } catch(e) {}
    }
  }, [searchPos, config.type, sdkLoaded]);

  // 5. Actions
  const handleKakaoAction = useCallback((mode: GISMode) => {
     if (config.type !== 'kakao' || !mapRef.current) return;
     
     // 이전 모드가 로드뷰였지만, 도로 뷰 오버레이는 유지해야 하므로 여기서 지우지 않음.
     // 오직 커서와 이벤트 리스너만 정리.
     if (gisMode !== GISMode.ROADVIEW) {
         mapRef.current.setCursor('default');
     }

     if (mode === GISMode.ROADVIEW) {
       mapRef.current.addOverlayMapTypeId(window.kakao.maps.MapTypeId.ROADVIEW);
       mapRef.current.setCursor('crosshair');
       
       const clickHandler = (e: any) => {
         const pos = e.latLng;
         kakaoGisRef.current.rvClient.getNearestPanoId(pos, 50, (panoId: any) => {
           if (panoId) {
             setIsStreetViewActive(true); 
             setTimeout(() => {
               if (roadviewRef.current) {
                 const rv = new window.kakao.maps.Roadview(roadviewRef.current);
                 rv.setPanoId(panoId, pos);
                 kakaoGisRef.current.rv = rv;

                 window.kakao.maps.event.addListener(rv, 'position_changed', () => {
                    const rvPos = rv.getPosition();
                    isDragging.current = true; 
                    onStateChange({ lat: rvPos.getLat(), lng: rvPos.getLng(), zoom: mapRef.current.getLevel() });
                    mapRef.current.setCenter(rvPos);
                    setTimeout(() => isDragging.current = false, 200);
                 });
               }
             }, 300);
           }
         });
         // Do not remove click listener or reset mode to keep overlay active
       };
       
       // Remove previous listener if exists to prevent duplicates
       if (kakaoGisRef.current.clickHandler) {
           window.kakao.maps.event.removeListener(mapRef.current, 'click', kakaoGisRef.current.clickHandler);
       }
       
       kakaoGisRef.current.clickHandler = clickHandler;
       window.kakao.maps.event.addListener(mapRef.current, 'click', clickHandler);
     }
     setGisMode(mode);
  }, [config.type, gisMode]);

  const toggleKakaoCadastral = useCallback(() => {
    if (config.type !== 'kakao' || !mapRef.current) return;
    const isCadastral = kakaoGisRef.current.roadviewLayer;
    if (isCadastral) mapRef.current.removeOverlayMapTypeId(window.kakao.maps.MapTypeId.USE_DISTRICT);
    else mapRef.current.addOverlayMapTypeId(window.kakao.maps.MapTypeId.USE_DISTRICT);
    kakaoGisRef.current.roadviewLayer = !isCadastral;
  }, [config.type]);

  const toggleNaverStreetLayer = useCallback(() => {
    if (!mapRef.current || !naverStreetLayerRef.current) return;
    if (isNaverLayerOn) {
        naverStreetLayerRef.current.setMap(null);
        mapRef.current.setCursor('default');
    } else {
        naverStreetLayerRef.current.setMap(mapRef.current);
        mapRef.current.setCursor('crosshair');
    }
    setIsNaverLayerOn(!isNaverLayerOn);
  }, [isNaverLayerOn]);

  const closeStreetView = () => {
    setIsStreetViewActive(false);
    if (config.type === 'google' && googlePanoInstanceRef.current) {
      googlePanoInstanceRef.current.setVisible(false);
    }
    // Fix: 카카오 거리뷰 닫을 때 오버레이 및 리스너 정리
    if (config.type === 'kakao' && mapRef.current) {
      if (gisMode === GISMode.ROADVIEW) {
          mapRef.current.removeOverlayMapTypeId(window.kakao.maps.MapTypeId.ROADVIEW);
          if (kakaoGisRef.current.clickHandler) {
              window.kakao.maps.event.removeListener(mapRef.current, 'click', kakaoGisRef.current.clickHandler);
              kakaoGisRef.current.clickHandler = null;
          }
          mapRef.current.setCursor('default');
          setGisMode(GISMode.DEFAULT);
      }
    }
  };

  return (
    <div className="w-full h-full relative group bg-gray-50 overflow-hidden">
      
      {/* 
         LAYOUT:
         Mini Map: Z-Index 100
         Street View: Z-Index 10
      */}

      {/* 1. Main Map / Mini Map Container */}
      <div 
        ref={containerRef} 
        className={`transition-all duration-300 ease-in-out bg-white
          ${isStreetViewActive 
            ? 'absolute bottom-3 left-3 w-[240px] h-[240px] z-[100] border-4 border-white shadow-2xl rounded-lg overflow-hidden' 
            : 'w-full h-full z-0'
          }`}
      />

      {/* 2. Street View Containers */}
      <div 
        ref={googlePanoRef}
        className={`absolute inset-0 bg-black transition-opacity duration-300 
           ${config.type === 'google' && isStreetViewActive ? 'z-10 opacity-100 pointer-events-auto' : 'z-[-1] opacity-0 pointer-events-none'}`} 
      />

      <div 
        ref={roadviewRef}
        className={`absolute inset-0 bg-black transition-opacity duration-300 
           ${config.type === 'kakao' && isStreetViewActive ? 'z-10 opacity-100 pointer-events-auto' : 'z-[-1] opacity-0 pointer-events-none'}`} 
      />

      <div 
        ref={naverPanoContainerRef}
        className={`absolute inset-0 bg-black transition-opacity duration-300 
           ${config.type === 'naver' && isStreetViewActive ? 'z-10 opacity-100 pointer-events-auto' : 'z-[-1] opacity-0 pointer-events-none'}`} 
      />

      {/* 3. Close Button */}
      {isStreetViewActive && (
        <button 
          onClick={closeStreetView}
          className="absolute top-3 left-1/2 transform -translate-x-1/2 z-[110] bg-red-600 text-white px-4 py-2 rounded-full shadow-lg font-bold hover:bg-red-700 transition-colors"
        >
          거리뷰 닫기 ✕
        </button>
      )}

      {/* 4. Loading & Controls */}
      {!sdkLoaded && (
         <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-[120] text-gray-500">
            <span>Loading...</span>
         </div>
      )}

      <button 
        onClick={onToggleFullscreen}
        className="absolute bottom-10 right-3 z-[110] bg-white p-1.5 rounded shadow border border-gray-300 hover:bg-gray-50 transition-colors"
        title="전체화면"
      >
        {isFullscreen ? (
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-gray-700"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
        ) : (
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-gray-700"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
        )}
      </button>
      
      {config.type === 'naver' && (
        <button 
          onClick={toggleNaverStreetLayer} 
          className={`absolute top-3 right-3 z-30 px-2 py-1 rounded shadow border text-xs font-bold transition-colors ${isNaverLayerOn ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
        >
          {isNaverLayerOn ? '거리뷰 ON' : '거리뷰'}
        </button>
      )}
      
      {config.type === 'kakao' && (
        <KakaoGisToolbar activeMode={gisMode} onAction={handleKakaoAction} onToggleCadastral={toggleKakaoCadastral} onClear={() => {
              setGisMode(GISMode.DEFAULT);
              if (mapRef.current) {
                mapRef.current.removeOverlayMapTypeId(window.kakao.maps.MapTypeId.ROADVIEW);
                mapRef.current.removeOverlayMapTypeId(window.kakao.maps.MapTypeId.USE_DISTRICT);
                mapRef.current.setCursor('default');
              }
              kakaoGisRef.current.roadviewLayer = false;
            }}
        />
      )}

      <div className="absolute top-2 left-2 pointer-events-none opacity-20 group-hover:opacity-50 transition-opacity z-10">
        <span className="bg-black text-white px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest">{side} pane</span>
      </div>
    </div>
  );
};

export default MapPane;
