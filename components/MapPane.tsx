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
    
    // Clear listeners from previous mode
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
        let dots: any[] = [];

        const handleClick = (e: any) => {
            const clickPosition = e.latLng;

            if (!isDrawing) {
                // Start Drawing
                isDrawing = true;
                
                // Fixed line (red, solid)
                drawingLine = new window.kakao.maps.Polyline({
                    map: map,
                    path: [clickPosition],
                    strokeWeight: 3,
                    strokeColor: '#db4040',
                    strokeOpacity: 1,
                    strokeStyle: 'solid'
                });
                
                // Moving line (red, solid - follows mouse)
                moveLine = new window.kakao.maps.Polyline({
                    map: map,
                    path: [],
                    strokeWeight: 3,
                    strokeColor: '#db4040',
                    strokeOpacity: 0.5, // Slightly lighter
                    strokeStyle: 'solid'
                });
                
                // Floating Info Window
                distanceOverlay = new window.kakao.maps.CustomOverlay({
                    map: map,
                    content: '<div class="info"></div>', // Initial placeholder
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
                dots.push(circle);

                // Push to global ref for cleanup
                kakaoDrawingRef.current.polylines.push(drawingLine, moveLine);
                kakaoDrawingRef.current.overlays.push(distanceOverlay, circle);
                
            } else {
                // Add Point
                const path = drawingLine.getPath();
                path.push(clickPosition);
                drawingLine.setPath(path);

                const distance = Math.round(drawingLine.getLength());
                
                // Add intermediate dot
                const circle = new window.kakao.maps.CustomOverlay({
                    map: map,
                    position: clickPosition,
                    content: '<div style="width:8px; height:8px; background:black; border:2px solid white; border-radius:50%;"></div>',
                    zIndex: 50
                });
                
                // Add intermediate text overlay (Accumulated Distance)
                const content = `<div style="background:white; padding:2px 5px; border:1px solid #888; border-radius:3px; font-size:11px; color:#333;">${distance}m</div>`;
                const nodeOverlay = new window.kakao.maps.CustomOverlay({
                    map: map,
                    position: clickPosition,
                    content: content,
                    yAnchor: 1.5,
                    zIndex: 50
                });
                
                dots.push(circle, nodeOverlay);
                kakaoDrawingRef.current.overlays.push(circle, nodeOverlay);
            }
        };

        const handleMouseMove = (e: any) => {
            if (!isDrawing) return;
            const mousePosition = e.latLng;

            // Update move line path: [last fixed point, mouse point]
            const path = drawingLine.getPath();
            const lastPos = path[path.length - 1];
            moveLine.setPath([lastPos, mousePosition]);
            moveLine.setMap(map);

            // Calculate total distance including mouse segment
            const distance = Math.round(drawingLine.getLength() + moveLine.getLength());
            
            // Update floating info window
            const content = `<div style="background:white; border:1px solid #db4040; padding:5px; border-radius:3px; font-size:12px; font-weight:bold; color:#db4040; box-shadow:1px 1px 3px rgba(0,0,0,0.2);">
                <span style="color:#333; font-weight:normal;">총거리</span> ${distance}m
            </div>`;
            
            distanceOverlay.setPosition(mousePosition);
            distanceOverlay.setContent(content);
        };
        
        const handleRightClick = (e: any) => {
             if (!isDrawing) return;

             // Finish Drawing
             moveLine.setMap(null); // Remove rubber-band line
             distanceOverlay.setMap(null); // Remove floating info window

             const path = drawingLine.getPath();
             // Right click usually ends at the last CLICKED point, 
             // so we don't add the right-click position as a new node.
             
             const totalDist = Math.round(drawingLine.getLength());
             const lastPos = path[path.length-1];

             // Summary Overlay (Walk/Bike Time)
             const walkTime = Math.floor(totalDist / 67); // approx 4km/h = 67m/min
             const bycicleTime = Math.floor(totalDist / 227); // approx 16km/h = 267m/min (Kakao uses ~227)

             const walkHour = Math.floor(walkTime / 60);
             const walkMin = walkTime % 60;
             const bikeHour = Math.floor(bycicleTime / 60);
             const bikeMin = bycicleTime % 60;

             const walkText = walkHour > 0 ? `${walkHour}시간 ${walkMin}분` : `${walkMin}분`;
             const bikeText = bikeHour > 0 ? `${bikeHour}시간 ${bikeMin}분` : `${bikeMin}분`;

             const content = `
                <div style="background:white; border:1px solid #333; padding:10px; border-radius:5px; font-size:12px; min-width:140px; box-shadow: 2px 2px 5px rgba(0,0,0,0.3); font-family: sans-serif;">
                    <div style="font-weight:bold; margin-bottom:5px; border-bottom:1px solid #ddd; padding-bottom:5px;">
                        총거리 <span style="color:#db4040; font-size:14px;">${totalDist}</span>m
                    </div>
                    <div style="color:#555; line-height:1.5;">
                        도보 ${walkText}<br>
                        자전거 ${bikeText}
                    </div>
                </div>
             `;

             const endOverlay = new window.kakao.maps.CustomOverlay({
                 map: map,
                 position: lastPos,
                 content: content,
                 yAnchor: 1.2,
                 zIndex: 200
             });
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
                    zIndex: 50
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
         if (kakaoGisRef.current.walkerOverlay) {
             kakaoGisRef.current.walkerOverlay.setMap(null);
             kakaoGisRef.current.walkerOverlay = null;
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

                 // Create Walker Overlay on Mini-Map
                 if (!kakaoGisRef.current.walkerOverlay) {
                     const content = document.createElement('div');
                     content.style.width = '26px';
                     content.style.height = '46px';
                     content.style.background = 'url(https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/walker.png) no-repeat 0 0';
                     content.style.backgroundSize = '26px 46px';
                     
                     kakaoGisRef.current.walkerOverlay = new window.kakao.maps.CustomOverlay({
                         position: pos,
                         content: content,
                         map: mapRef.current,
                         yAnchor: 1
                     });
                 }

                 window.kakao.maps.event.addListener(rv, 'position_changed', () => {
                    const rvPos = rv.getPosition();
                    isDragging.current = true; 
                    
                    // Sync Map Center
                    onStateChange({ lat: rvPos.getLat(), lng: rvPos.getLng(), zoom: mapRef.current.getLevel() });
                    mapRef.current.setCenter(rvPos);
                    
                    // Sync Walker
                    if (kakaoGisRef.current.walkerOverlay) {
                        kakaoGisRef.current.walkerOverlay.setPosition(rvPos);
                    }

                    setTimeout(() => isDragging.current = false, 200);
                 });

                 // Rotate Walker on Viewpoint Change
                 window.kakao.maps.event.addListener(rv, 'viewpoint_changed', () => {
                     const viewpoint = rv.getViewpoint();
                     if (kakaoGisRef.current.walkerOverlay) {
                         const content = kakaoGisRef.current.walkerOverlay.getContent();
                         content.style.transform = `rotate(${viewpoint.pan}deg)`;
                     }
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
          if (kakaoGisRef.current.walkerOverlay) {
              kakaoGisRef.current.walkerOverlay.setMap(null);
              kakaoGisRef.current.walkerOverlay = null;
          }
          mapRef.current.setCursor('default');
          setGisMode(GISMode.DEFAULT);
      }
    }
    // Fix: Clean up Naver
    if (config.type === 'naver') {
        if (naverMarkerRef.current) {
            naverMarkerRef.current.setMap(null);
            naverMarkerRef.current = null;
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
      
      {/* Repositioned Naver Toggle Button: Left-Top */}
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
              if (kakaoGisRef.current.walkerOverlay) {
                  kakaoGisRef.current.walkerOverlay.setMap(null);
                  kakaoGisRef.current.walkerOverlay = null;
              }
              clearKakaoDrawingResources();
            }}
        />
      )}
    </div>
  );
};

export default MapPane;
