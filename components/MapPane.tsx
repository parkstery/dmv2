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
  const googleCoverageLayerRef = useRef<any>(null);

  // Naver Refs
  const naverStreetLayerRef = useRef<any>(null);
  const naverPanoramaRef = useRef<any>(null);
  const naverPanoContainerRef = useRef<HTMLDivElement>(null);
  const [isNaverLayerOn, setIsNaverLayerOn] = useState(false);
  const isNaverLayerOnRef = useRef(false); // To keep sync in listeners if needed

  // Kakao Refs & Drawing State
  const kakaoGisRef = useRef<{
    rv: any;
    rvClient: any;
    geocoder: any;
    walker: any;
    roadviewLayer: boolean;
    clickHandler?: any; 
    addressClickListener?: any; // Added to manage cleanup
  }>({
    rv: null,
    rvClient: null,
    geocoder: null,
    walker: null,
    roadviewLayer: false
  });
  
  // Kakao Drawing Refs for Measurement
  const kakaoDrawingRef = useRef<{
    polylines: any[];
    polygons: any[];
    overlays: any[];
    listeners: (() => void)[];
  }>({
    polylines: [], polygons: [], overlays: [], listeners: []
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
        if (containerRef.current) containerRef.current.innerHTML = '';
        initGoogleMap();
        return true;
      }
      // 2. Kakao
      if (config.type === 'kakao' && window.kakao && window.kakao.maps) {
        window.kakao.maps.load(() => {
          if (containerRef.current) containerRef.current.innerHTML = '';
          initKakaoMap();
        });
        return true;
      }
      // 3. Naver
      if (config.type === 'naver' && window.naver && window.naver.maps) {
        if (containerRef.current) containerRef.current.innerHTML = '';
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
  }, [config.type]);

  // ** Reset Refs on Config Change **
  useEffect(() => {
    isDragging.current = false;
    isProgrammaticUpdate.current = false;
    setIsNaverLayerOn(false); 
    isNaverLayerOnRef.current = false;
    setGisMode(GISMode.DEFAULT);
    setIsStreetViewActive(false);
    
    // Clear Naver Panorama
    if (config.type !== 'naver') {
        naverPanoramaRef.current = null;
        if (naverPanoContainerRef.current) naverPanoContainerRef.current.innerHTML = '';
        if (naverStreetLayerRef.current) naverStreetLayerRef.current = null;
    }
    // Clear Google Coverage
    if (config.type !== 'google') {
       if (googleCoverageLayerRef.current) googleCoverageLayerRef.current.setMap(null);
    }
    // Clear Kakao Drawing
    if (config.type !== 'kakao') {
      clearKakaoDrawingResources();
    }
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
       enableCloseButton: false,
    });
    googlePanoInstanceRef.current = panorama;
    googleCoverageLayerRef.current = new window.google.maps.StreetViewCoverageLayer();

    mapRef.current = new window.google.maps.Map(containerRef.current, {
      center: { lat: globalState.lat, lng: globalState.lng },
      zoom: globalState.zoom,
      mapTypeId: config.isSatellite ? 'satellite' : 'roadmap',
      disableDefaultUI: false,
      zoomControl: true,
      streetViewControl: true,
      fullscreenControl: false,
      streetView: panorama,
      gestureHandling: 'greedy'
    });
    
    setupMapListeners('google');

    panorama.addListener('visible_changed', () => {
      const isVisible = panorama.getVisible();
      setIsStreetViewActive(isVisible);
      if (isVisible) {
        googleCoverageLayerRef.current.setMap(mapRef.current);
      } else {
        googleCoverageLayerRef.current.setMap(null);
      }
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
    setupKakaoAddressClick();
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
    
    // ** Optimized Panorama Initialization **
    // 1. DOM이 준비되었는지 확인 후 파노라마 생성
    if (naverPanoContainerRef.current) {
        naverPanoContainerRef.current.innerHTML = '';
        
        try {
            // 초기 생성 시 현재 지도 좌표로 생성하되, visible 처리는 CSS로 제어
            const pano = new window.naver.maps.Panorama(naverPanoContainerRef.current, {
                position: new window.naver.maps.LatLng(globalState.lat, globalState.lng),
                pov: { pan: -135, tilt: 29, fov: 100 },
                visible: true,
                zoomControl: true,
                minScale: 0,
                maxScale: 10
            });
            naverPanoramaRef.current = pano;

            window.naver.maps.Event.addListener(pano, 'position_changed', () => {
                const pos = pano.getPosition();
                // 드래그 중이 아닐 때만 맵 동기화
                if (!isDragging.current) {
                  isDragging.current = true;
                  onStateChange({ lat: pos.lat(), lng: pos.lng(), zoom: mapRef.current.getZoom() });
                  mapRef.current.setCenter(pos);
                  setTimeout(() => isDragging.current = false, 200);
                }
            });
        } catch(e) {
            console.error("Naver Panorama Init Error", e);
        }
    }
    
    // NOTE: Click listener is now handled in a separate useEffect for robustness.
  };

  // 3. Common Map Listeners
  const setupMapListeners = (type: MapVendor) => {
    if (!mapRef.current) return;

    const shouldUpdate = (newLat: number, newLng: number, newZoom: number) => {
        if (isProgrammaticUpdate.current) return false;
        const latDiff = Math.abs(newLat - globalState.lat);
        const lngDiff = Math.abs(newLng - globalState.lng);
        if (latDiff < 0.00001 && lngDiff < 0.00001 && newZoom === globalState.zoom) {
            return false;
        }
        return true;
    };

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

    } else if (type === 'naver') {
      window.naver.maps.Event.addListener(mapRef.current, 'dragstart', () => { isDragging.current = true; });
      window.naver.maps.Event.addListener(mapRef.current, 'dragend', () => { isDragging.current = false; });
      const handleUpdate = () => {
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

  // CHANGE: Right click -> Left click for Address
  const setupKakaoAddressClick = () => {
    // Clean up previous listener if exists
    if (kakaoGisRef.current.addressClickListener) {
        window.kakao.maps.event.removeListener(mapRef.current, 'click', kakaoGisRef.current.addressClickListener);
    }

    const onMapClick = (e: any) => {
      // *** IMPORTANT: Only run if we are in DEFAULT mode ***
      // If we are measuring (DISTANCE/AREA) or in ROADVIEW, do not show address.
      if (gisMode !== GISMode.DEFAULT) return;
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
    };

    kakaoGisRef.current.addressClickListener = onMapClick;
    window.kakao.maps.event.addListener(mapRef.current, 'click', onMapClick);
  };
  
  // Re-attach address listener when gisMode changes to ensure priority
  useEffect(() => {
    if (config.type === 'kakao' && mapRef.current && sdkLoaded) {
        setupKakaoAddressClick();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gisMode, config.type, sdkLoaded]);


  // 4. Update Effects
  useEffect(() => {
    if (!mapRef.current) return;
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
    setTimeout(() => { isProgrammaticUpdate.current = false; }, 200); 
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

  // -- Naver Street View Click Listener (Fixed with SDK State Check) --
  useEffect(() => {
    if (config.type === 'naver' && mapRef.current && sdkLoaded) {
        const map = mapRef.current;
        
        // ** Key Fix: Use SDK's streetLayer.getMap() to check visibility to avoid stale closure issues **
        const clickListener = window.naver.maps.Event.addListener(map, 'click', (e: any) => {
            const streetLayer = naverStreetLayerRef.current;
            
            // Check if street layer is active directly from the SDK object
            if (streetLayer && streetLayer.getMap()) {
                const latlng = e.coord;
                
                // 1. Activate UI
                setIsStreetViewActive(true);
                
                // 2. Wait for DOM transition then Resize & Set Position
                setTimeout(() => {
                    const pano = naverPanoramaRef.current;
                    const container = naverPanoContainerRef.current;
                    
                    if (pano && container) {
                        // Force explicit size update
                        pano.setSize(new window.naver.maps.Size(container.offsetWidth, container.offsetHeight));
                        
                        // Trigger resize event
                        window.naver.maps.Event.trigger(pano, 'resize');
                        
                        // Set position
                        pano.setPosition(latlng);
                    }
                }, 100);
            }
        });

        return () => {
            window.naver.maps.Event.removeListener(clickListener);
        };
    }
  }, [config.type, sdkLoaded]); // Dependencies simplified as we check layer state inside


  // -- Kakao Measurement Effect --
  useEffect(() => {
    if (config.type !== 'kakao' || !mapRef.current) return;
    
    // Clear listeners from previous mode
    kakaoDrawingRef.current.listeners.forEach(fn => fn());
    kakaoDrawingRef.current.listeners = [];

    const map = mapRef.current;

    // 1. Distance Measurement
    if (gisMode === GISMode.DISTANCE) {
        map.setCursor('crosshair');
        let currentLine: any = null;
        
        const handleClick = (e: any) => {
            const pos = e.latLng;
            if (!currentLine) {
                currentLine = new window.kakao.maps.Polyline({
                    map: map,
                    path: [pos],
                    strokeWeight: 3,
                    strokeColor: '#FF3333',
                    strokeOpacity: 1,
                    strokeStyle: 'solid',
                    zIndex: 10
                });
                kakaoDrawingRef.current.polylines.push(currentLine);
            } else {
                const path = currentLine.getPath();
                path.push(pos);
                currentLine.setPath(path);
            }

            // Create dot and overlay for segment
            const length = Math.round(currentLine.getLength());
            const content = `<div class="measure-label" style="background:white; border:1px solid #333; padding:2px 4px; border-radius:3px; font-size:11px;">${length}m</div>`;
            const overlay = new window.kakao.maps.CustomOverlay({
                map: map,
                position: pos,
                content: content,
                yAnchor: 2,
                zIndex: 50 // High level
            });
            kakaoDrawingRef.current.overlays.push(overlay);
        };
        
        // ** Right click ends measurement (Requested) **
        const handleRightClick = () => {
            map.setCursor('default');
            currentLine = null; // End drawing this line
        };

        window.kakao.maps.event.addListener(map, 'click', handleClick);
        window.kakao.maps.event.addListener(map, 'rightclick', handleRightClick);
        
        kakaoDrawingRef.current.listeners.push(
            () => window.kakao.maps.event.removeListener(map, 'click', handleClick),
            () => window.kakao.maps.event.removeListener(map, 'rightclick', handleRightClick)
        );
    } 
    // 2. Area Measurement
    else if (gisMode === GISMode.AREA) {
        map.setCursor('crosshair');
        let currentPoly: any = null;
        
        const handleClick = (e: any) => {
            const pos = e.latLng;
            if (!currentPoly) {
                currentPoly = new window.kakao.maps.Polygon({
                    map: map,
                    path: [pos],
                    strokeWeight: 3,
                    strokeColor: '#39f',
                    strokeOpacity: 0.8,
                    fillColor: '#A2D4EC',
                    fillOpacity: 0.5, 
                    zIndex: 10
                });
                kakaoDrawingRef.current.polygons.push(currentPoly);
            } else {
                const path = currentPoly.getPath();
                path.push(pos);
                currentPoly.setPath(path);
            }
        };
        
        // ** Right click ends measurement (Requested) **
        const handleRightClick = () => {
            if (currentPoly) {
                 const area = Math.round(currentPoly.getArea());
                 const path = currentPoly.getPath();
                 const lastPos = path[path.length-1];
                 const content = `<div class="measure-label" style="background:white; border:1px solid #333; padding:2px 4px; border-radius:3px; font-size:11px;">${area}m²</div>`;
                 const overlay = new window.kakao.maps.CustomOverlay({
                    map: map,
                    position: lastPos,
                    content: content,
                    yAnchor: 2,
                    zIndex: 50 // High level
                 });
                 kakaoDrawingRef.current.overlays.push(overlay);
                 currentPoly = null;
                 map.setCursor('default');
            }
        };

        window.kakao.maps.event.addListener(map, 'click', handleClick);
        window.kakao.maps.event.addListener(map, 'rightclick', handleRightClick);
        
        kakaoDrawingRef.current.listeners.push(
            () => window.kakao.maps.event.removeListener(map, 'click', handleClick),
            () => window.kakao.maps.event.removeListener(map, 'rightclick', handleRightClick)
        );
    }
  }, [gisMode, config.type]);


  // 5. Actions
  const handleKakaoAction = useCallback((mode: GISMode) => {
     if (config.type !== 'kakao' || !mapRef.current) return;
     
     // Reset previous Road View mode if active
     if (gisMode === GISMode.ROADVIEW && mode !== GISMode.ROADVIEW) {
         mapRef.current.removeOverlayMapTypeId(window.kakao.maps.MapTypeId.ROADVIEW);
         if (kakaoGisRef.current.clickHandler) {
             window.kakao.maps.event.removeListener(mapRef.current, 'click', kakaoGisRef.current.clickHandler);
             kakaoGisRef.current.clickHandler = null;
         }
     }
     mapRef.current.setCursor('default');

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
       };
       
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
    
    // Toggle State and Ref for Sync
    const nextState = !isNaverLayerOn;
    setIsNaverLayerOn(nextState);
    isNaverLayerOnRef.current = nextState;

    if (nextState) {
        naverStreetLayerRef.current.setMap(mapRef.current);
        mapRef.current.setCursor('crosshair');
    } else {
        naverStreetLayerRef.current.setMap(null);
        mapRef.current.setCursor('default');
    }
  }, [isNaverLayerOn]);

  const clearKakaoDrawingResources = () => {
      kakaoDrawingRef.current.polylines.forEach(p => p.setMap(null));
      kakaoDrawingRef.current.polygons.forEach(p => p.setMap(null));
      kakaoDrawingRef.current.overlays.forEach(o => o.setMap(null));
      kakaoDrawingRef.current.listeners.forEach(fn => fn());
      kakaoDrawingRef.current = { polylines: [], polygons: [], overlays: [], listeners: [] };
  };

  const closeStreetView = () => {
    setIsStreetViewActive(false);
    if (config.type === 'google') {
      if (googlePanoInstanceRef.current) googlePanoInstanceRef.current.setVisible(false);
      // Remove coverage layer from mini map when closing street view
      if (googleCoverageLayerRef.current) googleCoverageLayerRef.current.setMap(null);
    }
    // Fix: Clean up Kakao Roadview overlays/handlers
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

      {/* 3. Close Button (Square Icon) */}
      {isStreetViewActive && (
        <button 
          onClick={closeStreetView}
          className="absolute top-4 right-4 z-[110] bg-white text-gray-800 w-10 h-10 flex items-center justify-center shadow-lg rounded-sm hover:bg-gray-100 transition-colors border border-gray-300"
          title="거리뷰 닫기"
        >
          <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
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
          className={`absolute top-4 left-4 z-[110] px-2 py-1 rounded shadow border text-xs font-bold transition-colors ${isNaverLayerOn ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
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
              clearKakaoDrawingResources();
            }}
        />
      )}
    </div>
  );
};

export default MapPane;