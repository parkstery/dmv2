
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
  const isInternalUpdate = useRef(false);
  const [sdkLoaded, setSdkLoaded] = useState(false); // Track SDK loading status

  // Naver Street View Refs
  const naverStreetLayerRef = useRef<any>(null);
  const naverPanoramaRef = useRef<any>(null);
  const naverMarkerRef = useRef<any>(null);

  // Kakao specific refs
  const kakaoGisRef = useRef<{
    rv: any;
    rvClient: any;
    geocoder: any;
    walker: any;
    overlays: any[];
    shapes: any[];
    markers: any[];
    roadviewLayer: boolean;
  }>({
    rv: null,
    rvClient: null,
    geocoder: null,
    walker: null,
    overlays: [],
    shapes: [],
    markers: [],
    roadviewLayer: false
  });

  const [gisMode, setGisMode] = useState<GISMode>(GISMode.DEFAULT);
  const [showRoadview, setShowRoadview] = useState(false);
  const roadviewRef = useRef<HTMLDivElement>(null);

  // Helper: Zoom conversion
  const zoomToKakao = (z: number) => Math.max(1, Math.min(14, 20 - z));
  const kakaoToZoom = (l: number) => Math.max(3, Math.min(20, 20 - l));

  // Initialization Logic
  useEffect(() => {
    let intervalId: any = null;

    const checkAndInit = () => {
      if (config.type === 'google' && window.google && window.google.maps) {
        initGoogleMap();
        return true;
      }
      if (config.type === 'kakao' && window.kakao && window.kakao.maps) {
        // Kakao needs explicit load wait sometimes
        window.kakao.maps.load(() => {
          initKakaoMap();
        });
        return true;
      }
      if (config.type === 'naver' && window.naver && window.naver.maps) {
        initNaverMap();
        return true;
      }
      return false;
    };

    // Try immediately
    if (!checkAndInit()) {
      // Retry every 200ms if SDK is not ready
      intervalId = setInterval(() => {
        if (checkAndInit()) {
          clearInterval(intervalId);
          setSdkLoaded(true);
        }
      }, 200);
    } else {
      setSdkLoaded(true);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (mapRef.current) {
        if (config.type === 'naver' && mapRef.current.destroy) {
           // Naver destroy usually handles itself, keeping careful
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.type]);


  const initGoogleMap = () => {
    if (!containerRef.current) return;
    try {
      mapRef.current = new window.google.maps.Map(containerRef.current, {
        center: { lat: globalState.lat, lng: globalState.lng },
        zoom: globalState.zoom,
        mapTypeId: config.isSatellite ? 'satellite' : 'roadmap',
        disableDefaultUI: false,
        zoomControl: true,
      });
      setupMapListeners('google');
    } catch (e) { console.error("Google Init Error", e); }
  };

  const initKakaoMap = () => {
    if (!containerRef.current) return;
    try {
      const options = {
        center: new window.kakao.maps.LatLng(globalState.lat, globalState.lng),
        level: zoomToKakao(globalState.zoom)
      };
      mapRef.current = new window.kakao.maps.Map(containerRef.current, options);
      if (config.isSatellite) {
        mapRef.current.setMapTypeId(window.kakao.maps.MapTypeId.HYBRID);
      }
      
      // Init GIS tools
      if (window.kakao.maps.services) {
        kakaoGisRef.current.geocoder = new window.kakao.maps.services.Geocoder();
      }
      kakaoGisRef.current.rvClient = new window.kakao.maps.RoadviewClient();
      
      setupMapListeners('kakao');
      setupKakaoRightClick();
    } catch (e) { console.error("Kakao Init Error", e); }
  };

  const initNaverMap = () => {
    if (!containerRef.current) return;
    try {
      mapRef.current = new window.naver.maps.Map(containerRef.current, {
        center: new window.naver.maps.LatLng(globalState.lat, globalState.lng),
        zoom: globalState.zoom,
        mapTypeId: config.isSatellite ? window.naver.maps.MapTypeId.SATELLITE : window.naver.maps.MapTypeId.NORMAL
      });
      
      // Init Street View
      naverStreetLayerRef.current = new window.naver.maps.StreetLayer();
      naverPanoramaRef.current = new window.naver.maps.Panorama(document.createElement('div'), {
         position: new window.naver.maps.LatLng(globalState.lat, globalState.lng),
         visible: false
      });

      setupMapListeners('naver');
    } catch (e) { console.error("Naver Init Error", e); }
  };

  const setupMapListeners = (type: MapVendor) => {
    if (!mapRef.current) return;

    if (type === 'google') {
      mapRef.current.addListener('center_changed', () => {
        if (isInternalUpdate.current) return;
        const c = mapRef.current.getCenter();
        onStateChange({ lat: c.lat(), lng: c.lng(), zoom: mapRef.current.getZoom() });
      });
      mapRef.current.addListener('zoom_changed', () => {
        if (isInternalUpdate.current) return;
        const c = mapRef.current.getCenter();
        onStateChange({ lat: c.lat(), lng: c.lng(), zoom: mapRef.current.getZoom() });
      });
    } else if (type === 'kakao') {
      window.kakao.maps.event.addListener(mapRef.current, 'center_changed', () => {
        if (isInternalUpdate.current) return;
        const c = mapRef.current.getCenter();
        onStateChange({ lat: c.getLat(), lng: c.getLng(), zoom: kakaoToZoom(mapRef.current.getLevel()) });
      });
      window.kakao.maps.event.addListener(mapRef.current, 'zoom_changed', () => {
        if (isInternalUpdate.current) return;
        const c = mapRef.current.getCenter();
        onStateChange({ lat: c.getLat(), lng: c.getLng(), zoom: kakaoToZoom(mapRef.current.getLevel()) });
      });
    } else if (type === 'naver') {
      window.naver.maps.Event.addListener(mapRef.current, 'idle', () => {
        if (isInternalUpdate.current) return;
        const c = mapRef.current.getCenter();
        onStateChange({ lat: c.lat(), lng: c.lng(), zoom: mapRef.current.getZoom() });
      });
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

  // Sync / Resize / Search Effects
  useEffect(() => {
    if (!mapRef.current) return;
    const triggerResize = () => {
      try {
          if (config.type === 'kakao') {
            mapRef.current.relayout();
            mapRef.current.setCenter(new window.kakao.maps.LatLng(globalState.lat, globalState.lng));
          } else if (config.type === 'google') {
            window.google.maps.event.trigger(mapRef.current, 'resize');
            mapRef.current.setCenter({ lat: globalState.lat, lng: globalState.lng });
          } else if (config.type === 'naver') {
            window.naver.maps.Event.trigger(mapRef.current, 'resize');
            mapRef.current.setCenter(new window.naver.maps.LatLng(globalState.lat, globalState.lng));
          }
      } catch (e) {}
    };
    setTimeout(triggerResize, 100);
    setTimeout(triggerResize, 500);
  }, [isFullscreen, config.type, sdkLoaded]);

  useEffect(() => {
    if (!mapRef.current) return;
    isInternalUpdate.current = true;
    try {
        if (config.type === 'google') {
          mapRef.current.setCenter({ lat: globalState.lat, lng: globalState.lng });
          mapRef.current.setZoom(globalState.zoom);
        } else if (config.type === 'kakao') {
          mapRef.current.setCenter(new window.kakao.maps.LatLng(globalState.lat, globalState.lng));
          mapRef.current.setLevel(zoomToKakao(globalState.zoom));
        } else if (config.type === 'naver') {
          mapRef.current.setCenter(new window.naver.maps.LatLng(globalState.lat, globalState.lng));
          mapRef.current.setZoom(globalState.zoom);
        }
    } catch(e) {}
    setTimeout(() => { isInternalUpdate.current = false; }, 100);
  }, [globalState.lat, globalState.lng, globalState.zoom, config.type, sdkLoaded]);

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

  useEffect(() => {
    if (!mapRef.current) return;
    if (markerRef.current) markerRef.current.setMap(null);
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

  // GIS Actions (Kakao & Naver Street View)
  const handleGisAction = useCallback((mode: GISMode) => {
     // ... (Existing GIS Logic - Keep same)
     if (config.type !== 'kakao' || !mapRef.current) return;
     if (gisMode === GISMode.ROADVIEW) {
       mapRef.current.removeOverlayMapTypeId(window.kakao.maps.MapTypeId.ROADVIEW);
       mapRef.current.setCursor('default');
     }
     if (mode === GISMode.ROADVIEW) {
       mapRef.current.addOverlayMapTypeId(window.kakao.maps.MapTypeId.ROADVIEW);
       mapRef.current.setCursor('crosshair');
       const clickHandler = (e: any) => {
         const pos = e.latLng;
         kakaoGisRef.current.rvClient.getNearestPanoId(pos, 50, (panoId: any) => {
           if (panoId) {
             setShowRoadview(true);
             setTimeout(() => {
               if (roadviewRef.current) {
                 const rv = new window.kakao.maps.Roadview(roadviewRef.current);
                 rv.setPanoId(panoId, pos);
                 kakaoGisRef.current.rv = rv;
               }
             }, 300);
           }
         });
         window.kakao.maps.event.removeListener(mapRef.current, 'click', clickHandler);
         mapRef.current.removeOverlayMapTypeId(window.kakao.maps.MapTypeId.ROADVIEW);
         mapRef.current.setCursor('default');
         setGisMode(GISMode.DEFAULT);
       };
       window.kakao.maps.event.addListener(mapRef.current, 'click', clickHandler);
     }
     setGisMode(mode);
  }, [config.type, gisMode]);

  const toggleCadastral = useCallback(() => {
    if (config.type !== 'kakao' || !mapRef.current) return;
    const isCadastral = kakaoGisRef.current.roadviewLayer;
    if (isCadastral) mapRef.current.removeOverlayMapTypeId(window.kakao.maps.MapTypeId.USE_DISTRICT);
    else mapRef.current.addOverlayMapTypeId(window.kakao.maps.MapTypeId.USE_DISTRICT);
    kakaoGisRef.current.roadviewLayer = !isCadastral;
  }, [config.type]);

  const toggleNaverStreet = useCallback(() => {
    if (!mapRef.current || !naverStreetLayerRef.current) return;
    const layer = naverStreetLayerRef.current;
    if (layer.getMap()) layer.setMap(null);
    else layer.setMap(mapRef.current);
  }, []);

  return (
    <div className="w-full h-full relative group bg-gray-200">
      <div ref={containerRef} className="w-full h-full" />
      
      {!sdkLoaded && (
         <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10 text-gray-500">
            <div className="text-center">
              <p>Loading Map ({config.type})...</p>
              <p className="text-xs text-gray-400">Waiting for SDK...</p>
            </div>
         </div>
      )}

      {/* Buttons */}
      <button 
        onClick={onToggleFullscreen}
        className="absolute bottom-10 right-3 z-30 bg-white p-1.5 rounded shadow border border-gray-300 hover:bg-gray-50 transition-colors"
      >
        {isFullscreen ? (
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-gray-700"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
        ) : (
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-gray-700"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
        )}
      </button>
      
      {config.type === 'naver' && (
        <button onClick={toggleNaverStreet} className="absolute top-3 right-3 z-30 bg-white px-2 py-1 rounded shadow border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50">
          거리뷰
        </button>
      )}
      
      {config.type === 'kakao' && (
        <>
          <KakaoGisToolbar activeMode={gisMode} onAction={handleGisAction} onToggleCadastral={toggleCadastral} onClear={() => {
              setGisMode(GISMode.DEFAULT);
              if (mapRef.current) {
                mapRef.current.removeOverlayMapTypeId(window.kakao.maps.MapTypeId.ROADVIEW);
                mapRef.current.removeOverlayMapTypeId(window.kakao.maps.MapTypeId.USE_DISTRICT);
                mapRef.current.setCursor('default');
              }
              kakaoGisRef.current.roadviewLayer = false;
            }}
          />
          {showRoadview && (
            <div className="absolute inset-0 z-50 bg-black flex flex-col">
              <div className="bg-gray-800 p-2 flex justify-between items-center text-white">
                <span className="text-sm font-bold">로드뷰</span>
                <button onClick={() => setShowRoadview(false)} className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded text-xs">닫기 X</button>
              </div>
              <div ref={roadviewRef} className="flex-1" />
            </div>
          )}
        </>
      )}
      <div className="absolute top-2 left-2 pointer-events-none opacity-20 group-hover:opacity-50 transition-opacity z-10">
        <span className="bg-black text-white px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest">{side} pane</span>
      </div>
    </div>
  );
};

export default MapPane;
