export interface GameProp {
  id_prop: number;
  latitude: string;
  longitude: string;
  type: string;
  detection_radius: number;
}

export interface GameDetails {
  code: string;
  map_radius: number;
  map_center_latitude: string;
  map_center_longitude: string;
  start_zone_latitude?: string;
  start_zone_longitude?: string;
  start_zone_rogue_latitude?: string;
  start_zone_rogue_longitude?: string;
  props?: GameProp[];
}

export interface ObjectiveCircle {
  id_prop: number;
  center: [number, number];
  radius: number;
} 