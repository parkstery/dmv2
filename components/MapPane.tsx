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
  const naverMarkerRef = useRef<any>(null); // Marker on Mini-map
  const [isNaverLayerOn, setIsNaverLayerOn] = useState(false);
  
  // Kakao Refs & Drawing State
  const kakaoGisRef = useRef<{
    rv: any;
    rvClient: any;
    geocoder: any;
    walker: any;
    roadviewLayer: boolean;
    clickHandler?: any; 
    addressClickListener?: any;
    walkerOverlay?: any; // Walker on Mini-map
  }>({
    rv: null,
    rvClient: null,
    geocoder: null,
    walker: null,
    roadviewLayer: false
  });
  
  // Kakao Drawing Refs for Measurement (Global storage for bulk clear)
  const kakaoDrawingRef = useRef<{
    overlays: any[]; // Stores everything for bulk clear: lines, polygons, overlays
    listeners: (() => void)[];
  }>({
    overlays: [], listeners: []
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
    setGisMode(GISMode.DEFAULT);
    setIsStreetViewActive(false);
    
    // Clear Naver Resources
    if (config.type !== 'naver') {
        if (naverPanoramaRef.current) naverPanoramaRef.current = null;
        if (naverMarkerRef.current) { naverMarkerRef.current.setMap(null); naverMarkerRef.current = null; }
        if (naverPanoContainerRef.current) naverPanoContainerRef.current.innerHTML = '';
        if (naverStreetLayerRef.current) naverStreetLayerRef.current = null;
    }
    // Clear Google Resources
    if (config.type !== 'google') {
       if (googleCoverageLayerRef.current) googleCoverageLayerRef.current.setMap(null);
    }
    // Clear Kakao Resources
    if (config.type !== 'kakao') {
      clearKakaoDrawingResources();
      if (kakaoGisRef.current.walkerOverlay) {
          kakaoGisRef.current.walkerOverlay.setMap(null);
          kakaoGisRef.current.walkerOverlay = null;
      }
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
    if (kakaoGisRef.current.addressClickListener) {
        window.kakao.maps.event.removeListener(mapRef.current, 'click', kakaoGisRef.current.addressClickListener);
    }
    const onMapClick = (e: any) => {
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
  
  useEffect(() => {
    if (config.type === 'kakao' && mapRef.current && sdkLoaded) {
        setupKakaoAddressClick();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gisMode, config.type, sdkLoaded]);


  // -- Naver Street View Click Listener & Marker Sync --
  useEffect(() => {
    if (config.type === 'naver' && mapRef.current && sdkLoaded) {
        const map = mapRef.current;
        
        // Listen to map clicks to open Panorama
        const clickListener = window.naver.maps.Event.addListener(map, 'click', (e: any) => {
            const streetLayer = naverStreetLayerRef.current;
            
            // Only proceed if the Street Layer is currently ON
            if (streetLayer && streetLayer.getMap()) {
                const latlng = e.coord;
                
                // Show Panorama UI
                setIsStreetViewActive(true);
                
                // Init Panorama & Marker
                setTimeout(() => {
                    const container = naverPanoContainerRef.current;
                    if (container) {
                        // Create or Update Panorama
                        if (!naverPanoramaRef.current) {
                            const pano = new window.naver.maps.Panorama(container, {
                                position: latlng,
                                pov: { pan: -135, tilt: 29, fov: 100 },
                                visible: true
                            });
                            naverPanoramaRef.current = pano;

                            // Sync Map & Marker when Panorama moves
                            window.naver.maps.Event.addListener(pano, 'position_changed', () => {
                                const pos = pano.getPosition();
                                // Sync Map Center
                                mapRef.current.setCenter(pos);
                                // Sync Marker
                                if (naverMarkerRef.current) {
                                    naverMarkerRef.current.setPosition(pos);
                                }
                            });
                        } else {
                            // Just update position and force resize
                            naverPanoramaRef.current.setPosition(latlng);
                            window.naver.maps.Event.trigger(naverPanoramaRef.current, 'resize');
                        }

                        // Create Marker on Map if not exists
                        if (!naverMarkerRef.current) {
                            naverMarkerRef.current = new window.naver.maps.Marker({
                                position: latlng,
                                map: mapRef.current,
                                icon: {
                                    url: 'https://ssl.pstatic.net/static/maps/mantle/1x/marker-default.png',
                                    size: new window.naver.maps.Size(22, 35),
                                    anchor: new window.naver.maps.Point(11, 35)
                                }
                            });
                        } else {
                            naverMarkerRef.current.setMap(mapRef.current);
                            naverMarkerRef.current.setPosition(latlng);
                        }
                    }
                }, 100);
            }
        });

        return () => {
            window.naver.maps.Event.removeListener(clickListener);
        };
    }
  }, [config.type, sdkLoaded]);


  // -- Kakao Measurement Effect --
  useEffect(() => {
    if (config.type !== 'kakao' || !mapRef.current) return;
    
    // Cleanup Listeners only (keep overlays for manual close)
    kakaoDrawingRef.current.listeners.forEach(fn => fn());
    kakaoDrawingRef.current.listeners = [];

    const map = mapRef.current;

    // 1. Distance Measurement
    if (gisMode === GISMode.DISTANCE) {
        map.setCursor('default');
        
        let isDrawing = false;
        let drawingLine: any = null;
        let moveLine: any = null;
        let distanceOverlay: any = null;
        
        // Use a local array to track the *current* measurement session's objects
        // so we can delete ONLY these when the "X" button is clicked.
        let currentSessionObjects: any[] = [];

        const handleClick = (e: any) => {
            const clickPosition = e.latLng;

            if (!isDrawing) {
                // Start Drawing
                isDrawing = true;
                currentSessionObjects = []; // Start new session
                
                // Fixed line
                drawingLine = new window.kakao.maps.Polyline({
                    map: map,
                    path: [clickPosition],
                    strokeWeight: 3,
                    strokeColor: '#db4040',
                    strokeOpacity: 1,
                    strokeStyle: 'solid'
                });
                
                // Moving line
                moveLine = new window.kakao.maps.Polyline({
                    map: map,
                    path: [],
                    strokeWeight: 3,
                    strokeColor: '#db4040',
                    strokeOpacity: 0.5, 
                    strokeStyle: 'solid'
                });
                
                // Floating Info Window
                distanceOverlay = new window.kakao.maps.CustomOverlay({
                    map: map,
                    content: '<div class="info"></div>', 
                    position: clickPosition,
                    xAnchor: 0,
                    yAnchor: 0,
                    zIndex: 100
                });

                // Start dot
                const circle = new window.kakao.maps.CustomOverlay({
                    map: map,
                    position: clickPosition,
                    content: '<div style="width:8px; height:8px; background:black; border:2px solid white; border-radius:50%;"></div>',
                    zIndex: 50
                });
                
                currentSessionObjects.push(drawingLine, moveLine, distanceOverlay, circle);
                // Also push to global ref for "Clear All" functionality
                kakaoDrawingRef.current.overlays.push(drawingLine, moveLine, distanceOverlay, circle);
                
            } else {
                // Add Point
                const path = drawingLine.getPath();
                path.push(clickPosition);
                drawingLine.setPath(path);

                const distance = Math.round(drawingLine.getLength());
                
                // Dot
                const circle = new window.kakao.maps.CustomOverlay({
                    map: map,
                    position: clickPosition,
                    content: '<div style="width:8px; height:8px; background:black; border:2px solid white; border-radius:50%;"></div>',
                    zIndex: 50
                });
                
                // Intermediate distance
                const content = `<div style="background:white; padding:2px 5px; border:1px solid #888; border-radius:3px; font-size:11px; color:#333;">${distance}m</div>`;
                const nodeOverlay = new window.kakao.maps.CustomOverlay({
                    map: map,
                    position: clickPosition,
                    content: content,
                    yAnchor: 1.5,
                    zIndex: 50
                });
                
                currentSessionObjects.push(circle, nodeOverlay);
                kakaoDrawingRef.current.overlays.push(circle, nodeOverlay);
            }
        };

        const handleMouseMove = (e: any) => {
            if (!isDrawing) return;
            const mousePosition = e.latLng;

            const path = drawingLine.getPath();
            const lastPos = path[path.length - 1];
            moveLine.setPath([lastPos, mousePosition]);
            moveLine.setMap(map);

            const distance = Math.round(drawingLine.getLength() + moveLine.getLength());
            
            const content = `<div style="background:white; border:1px solid #db4040; padding:5px; border-radius:3px; font-size:12px; font-weight:bold; color:#db4040; box-shadow:1px 1px 3px rgba(0,0,0,0.2);">
                <span style="color:#333; font-weight:normal;">총거리</span> ${distance}m
            </div>`;
            
            distanceOverlay.setPosition(mousePosition);
            distanceOverlay.setContent(content);
        };
        
        const handleRightClick = (e: any) => {
             if (!isDrawing) return;

             // Finish Drawing
             moveLine.setMap(null); 
             distanceOverlay.setMap(null); 

             const path = drawingLine.getPath();
             const totalDist = Math.round(drawingLine.getLength());
             const lastPos = path[path.length-1];

             // Calculations
             const walkTime = Math.floor(totalDist / 67); 
             const bycicleTime = Math.floor(totalDist / 227); 
             const walkHour = Math.floor(walkTime / 60);
             const walkMin = walkTime % 60;
             const bikeHour = Math.floor(bycicleTime / 60);
             const bikeMin = bycicleTime % 60;

             const walkText = walkHour > 0 ? `${walkHour}시간 ${walkMin}분` : `${walkMin}분`;
             const bikeText = bikeHour > 0 ? `${bikeHour}시간 ${bikeMin}분` : `${bikeMin}분`;

             // Create Summary Overlay with Close Button
             const content = document.createElement('div');
             content.style.cssText = 'background:white; border:1px solid #333; padding:10px; border-radius:5px; font-size:12px; min-width:140px; box-shadow: 2px 2px 5px rgba(0,0,0,0.3); font-family: sans-serif; position: relative;';
             content.innerHTML = `
                <div style="font-weight:bold; margin-bottom:5px; border-bottom:1px solid #ddd; padding-bottom:5px; padding-right: 15px;">
                    총거리 <span style="color:#db4040; font-size:14px;">${totalDist}</span>m
                </div>
                <div style="color:#555; line-height:1.5;">
                    도보 ${walkText}<br>
                    자전거 ${bikeText}
                </div>
                <button class="close-btn" style="position: absolute; top: 2px; right: 2px; border: none; background: none; cursor: pointer; color: #999; font-size: 16px; font-weight: bold; line-height: 1;">×</button>
             `;

             const endOverlay = new window.kakao.maps.CustomOverlay({
                 map: map,
                 position: lastPos,
                 content: content,
                 yAnchor: 1.2,
                 zIndex: 200
             });

             // Add Close Logic
             const closeBtn = content.querySelector('.close-btn');
             if (closeBtn) {
                 closeBtn.addEventListener('click', (ev) => {
                     ev.stopPropagation(); // Prevent map click
                     endOverlay.setMap(null);
                     // Remove all objects related to this measurement
                     currentSessionObjects.forEach(obj => obj.setMap(null));
                 });
             }
             
             // Push endOverlay to storage
             kakaoDrawingRef.current.overlays.push(endOverlay);

             // Reset local state
             isDrawing = false;
             drawingLine = null;
             moveLine = null;
             distanceOverlay = null;
        };

        window.kakao.maps.event.addListener(map, 'click', handleClick);
        window.kakao.maps.event.addListener(map, 'mousemove', handleMouseMove);
        window.kakao.maps.event.addListener(map, 'rightclick', handleRightClick);
        
        kakaoDrawingRef.current.listeners.push(
            () => window.kakao.maps.event.removeListener(map, 'click', handleClick),
            () => window.kakao.maps.event.removeListener(map, 'mousemove', handleMouseMove),
            () => window.kakao.maps.event.removeListener(map, 'rightclick', handleRightClick)
        );
    } 
    // 2. Area Measurement
    else if (gisMode === GISMode.AREA) {
        map.setCursor('default');
        
        let isDrawing = false;
        let drawingPolygon: any = null; // Committed polygon
        let movePolygon: any = null;    // Dynamic polygon (preview)
        let areaOverlay: any = null;    // Floating info
        let currentSessionObjects: any[] = [];

        const handleClick = (e: any) => {
            const clickPosition = e.latLng;

            if (!isDrawing) {
                // Start Drawing
                isDrawing = true;
                currentSessionObjects = [];

                // Initialize Committed Polygon
                drawingPolygon = new window.kakao.maps.Polygon({
                    map: map,
                    path: [clickPosition], 
                    strokeWeight