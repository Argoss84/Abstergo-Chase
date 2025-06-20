export interface GameProp {
  id_prop: number;
  latitude: string;
  longitude: string;
  type: string;
  detection_radius: number;
}

export interface GameDetails {
  id_game: number;
  created_at: string;
  code: string;
  map_center_latitude: string | null;
  map_center_longitude: string | null;
  map_radius: number | null;
  city: string | null;
  max_agents: number | null;
  max_rogue: number | null;
  objectif_number: number | null;
  start_zone_latitude: string | null;
  start_zone_longitude: string | null;
  duration: number | null;
  started_date: string | null;
  start_zone_rogue_latitude: string | null;
  start_zone_rogue_longitude: string | null;
  victory_condition_nb_objectivs: number | null;
  winner_type: string | null;
  hack_duration_ms: number | null;
  objectiv_zone_radius: number | null;
  rogue_range: number | null;
  agent_range: number | null;
  is_converging_phase: boolean | null;
  props?: GameProp[];
}

export interface ObjectiveCircle {
  id_prop: number;
  center: [number, number];
  radius: number;
} 