
export type MapVendor = 'google' | 'kakao' | 'naver';

export interface MapState {
  lat: number;
  lng: number;
  zoom: number;
}

export interface PaneConfig {
  type: MapVendor;
  isSatellite: boolean;
}

export interface SearchResult {
  place_name: string;
  road_address_name: string;
  address_name: string;
  x: string;
  y: string;
}

export interface HistoryItem {
  name: string;
  lat: number;
  lng: number;
}

export enum GISMode {
  DEFAULT = 'default',
  ROADVIEW = 'roadview',
  DISTANCE = 'distance',
  AREA = 'area'
}

declare global {
  interface Window {
    kakao: any;
    google: any;
    naver: any;
  }
}
