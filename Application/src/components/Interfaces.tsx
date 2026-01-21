export interface GameProp {
  id_prop: number;
  created_at: string;
  id_game: number;
  latitude: string | null;
  longitude: string | null;
  type: string | null;
  name: string | null;
  description: string | null;
  color: string | null;
  visible: boolean | null;
  detection_radius: number | null;
  visibility_last_change_date: string | null;
  state: string | null;
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
  remaining_time: number | null;
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
  started: boolean | null;
  countdown_started: boolean | null;
  props?: GameProp[];
  players?: Player[];
  objective_circles?: ObjectiveCircle[];
}

export interface ObjectiveCircle {
  id_prop: number;
  center: [number, number];
  radius: number;
}

export interface Player {
  id_player: string;
  created_at: string;
  user_id: string;
  id_game: number;
  latitude: string | null;
  longitude: string | null;
  color: string | null;
  role: string | null;
  isInStartZone: boolean | null;
  IsReady: boolean | null;
  status: string | null;
  updated_at: string | null;
  is_admin: boolean | null;
  displayName?: string;
} 
