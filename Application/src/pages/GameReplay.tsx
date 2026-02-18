import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButton,
  IonButtons,
  IonLabel,
  IonSpinner,
} from '@ionic/react';
import { useLocation, useHistory } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Circle, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { getDefaultApiUrl } from '../ressources/DefaultValues';
import { START_ZONE_RADIUS, DEFAULT_MAP_ZOOM } from '../ressources/DefaultValues';
import { play, pause } from 'ionicons/icons';
import { IonIcon } from '@ionic/react';

interface ReplayPlayer {
  id_player: string;
  role: string | null;
  latitude: string | null;
  longitude: string | null;
  status: string | null;
  displayName?: string;
}

interface ReplayProp {
  id_prop: number;
  state: string | null;
  visible: boolean | null;
  latitude: string | null;
  longitude: string | null;
  name?: string | null;
}

interface ReplaySnapshot {
  id: number;
  snapshot_timestamp: string;
  remaining_time_seconds: number | null;
  game_phase: string;
  players: ReplayPlayer[];
  props: ReplayProp[];
}

interface ReplaySession {
  id: number;
  game_code: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  winner_type: string | null;
  config: {
    map_center_latitude?: string | null;
    map_center_longitude?: string | null;
    map_radius?: number | null;
    start_zone_latitude?: string | null;
    start_zone_longitude?: string | null;
    start_zone_rogue_latitude?: string | null;
    start_zone_rogue_longitude?: string | null;
    duration?: number | null;
    objectiv_zone_radius?: number | null;
  } | null;
}

const ResizeMap = () => {
  const map = useMap();
  useEffect(() => {
    setTimeout(() => map.invalidateSize(), 0);
  }, [map]);
  return null;
};

const SNAPSHOT_INTERVAL_MS = 5000;
const SPEEDS = [1, 2, 4, 8] as const;

const GameReplay: React.FC = () => {
  const location = useLocation();
  const history = useHistory();
  const [session, setSession] = useState<ReplaySession | null>(null);
  const [snapshots, setSnapshots] = useState<ReplaySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const lastFrameRef = useRef<number>(0);
  const animationRef = useRef<number | null>(null);

  const gameCode = (() => {
    const params = new URLSearchParams(location.search);
    return params.get('code')?.trim().toUpperCase() || null;
  })();

  useEffect(() => {
    if (!gameCode) {
      setError('Code de partie manquant');
      setLoading(false);
      return;
    }
    const apiUrl = getDefaultApiUrl();
    fetch(`${apiUrl}/api/game-replay/${gameCode}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Partie introuvable' : `Erreur ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setSession(data.session);
        setSnapshots(data.snapshots || []);
        setCurrentIndex(0);
        setProgress(0);
      })
      .catch((err) => setError(err.message || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }, [gameCode]);

  const animate = useCallback(() => {
    if (!isPlaying || snapshots.length === 0) return;
    const now = performance.now();
    const elapsed = (now - lastFrameRef.current) / 1000;
    lastFrameRef.current = now;

    const segmentDuration = SNAPSHOT_INTERVAL_MS / 1000 / speed;
    let newProgress = progress + elapsed / segmentDuration;

    if (newProgress >= 1) {
      if (currentIndex >= snapshots.length - 1) {
        setIsPlaying(false);
        setProgress(1);
        return;
      }
      setCurrentIndex((i) => Math.min(i + 1, snapshots.length - 1));
      newProgress = newProgress - 1;
    }
    setProgress(newProgress);
    animationRef.current = requestAnimationFrame(animate);
  }, [isPlaying, snapshots.length, currentIndex, progress, speed]);

  useEffect(() => {
    if (isPlaying) {
      lastFrameRef.current = performance.now();
      animationRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, animate]);

  const handlePlayPause = () => {
    if (snapshots.length === 0) return;
    if (currentIndex >= snapshots.length - 1 && progress >= 1) {
      setCurrentIndex(0);
      setProgress(0);
    }
    setIsPlaying((p) => !p);
  };

  const handleSpeedChange = () => {
    const idx = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const total = Math.max(1, snapshots.length - 1);
    const idx = Math.floor(val * total);
    const prog = val * total - idx;
    setCurrentIndex(Math.min(idx, snapshots.length - 1));
    setProgress(prog);
  };

  const currentSnapshot = snapshots[currentIndex] || null;
  const nextSnapshot = currentIndex < snapshots.length - 1 ? snapshots[currentIndex + 1] : null;

  const interpolate = (a: number, b: number, t: number) => a + (b - a) * t;

  const getPlayerPositions = (): Array<{ id: string; role: string | null; lat: number; lng: number; name?: string }> => {
    if (!currentSnapshot) return [];
    const players = currentSnapshot.players.filter(
      (p) => p.latitude != null && p.longitude != null && p.status !== 'disconnected'
    );
    return players.map((p) => {
      const lat = parseFloat(p.latitude!);
      const lng = parseFloat(p.longitude!);
      if (nextSnapshot && progress > 0) {
        const next = nextSnapshot.players.find((np) => np.id_player === p.id_player);
        if (next?.latitude != null && next?.longitude != null) {
          return {
            id: p.id_player,
            role: p.role,
            lat: interpolate(lat, parseFloat(next.latitude), progress),
            lng: interpolate(lng, parseFloat(next.longitude), progress),
            name: p.displayName
          };
        }
      }
      return { id: p.id_player, role: p.role, lat, lng, name: p.displayName };
    });
  };

  const getPropPositions = (): Array<{ id: number; lat: number; lng: number; state: string | null; name?: string }> => {
    if (!currentSnapshot) return [];
    const props = currentSnapshot.props.filter((p) => p.latitude != null && p.longitude != null);
    return props.map((p) => {
      const lat = parseFloat(p.latitude!);
      const lng = parseFloat(p.longitude!);
      return {
        id: p.id_prop,
        lat,
        lng,
        state: p.state,
        name: p.name || undefined
      };
    });
  };

  const config = session?.config;
  const centerLat = config?.map_center_latitude ? parseFloat(config.map_center_latitude) : 48.8566;
  const centerLng = config?.map_center_longitude ? parseFloat(config.map_center_longitude) : 2.3522;
  const mapRadius = config?.map_radius ?? 500;

  const seekValue = snapshots.length > 1 ? (currentIndex + progress) / (snapshots.length - 1) : 0;

  if (loading) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Replay</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px' }}>
            <IonSpinner name="crescent" />
            <span style={{ marginLeft: 12 }}>Chargement du replay...</span>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  if (error || !session) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Replay</IonTitle>
            <IonButtons slot="start">
              <IonButton onClick={() => history.push('/home')}>Retour</IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <p style={{ color: 'var(--ion-color-danger)' }}>{error || 'Partie introuvable'}</p>
          <IonButton onClick={() => history.push('/home')}>Retour à l'accueil</IonButton>
        </IonContent>
      </IonPage>
    );
  }

  const playerPositions = getPlayerPositions();
  const propPositions = getPropPositions();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => history.push('/home')}>Retour</IonButton>
          </IonButtons>
          <IonTitle>Replay - {session.game_code}</IonTitle>
          {currentSnapshot && (
            <IonLabel slot="end" style={{ marginRight: 12 }}>
              ⏱ {currentSnapshot.remaining_time_seconds != null ? `${Math.floor((currentSnapshot.remaining_time_seconds || 0) / 60)}:${String((currentSnapshot.remaining_time_seconds || 0) % 60).padStart(2, '0')}` : '—'}
            </IonLabel>
          )}
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div style={{ height: 'calc(100vh - 200px)', position: 'relative' }}>
          <MapContainer
            center={[centerLat, centerLng]}
            zoom={DEFAULT_MAP_ZOOM}
            style={{ height: '100%', width: '100%' }}
          >
            <ResizeMap />
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />
            <Circle
              center={[centerLat, centerLng]}
              radius={mapRadius}
              pathOptions={{ color: 'blue', fillColor: 'blue', fillOpacity: 0.05 }}
            />
            {config?.start_zone_latitude && config?.start_zone_longitude && (
              <>
                <Circle
                  center={[parseFloat(config.start_zone_latitude), parseFloat(config.start_zone_longitude)]}
                  radius={START_ZONE_RADIUS}
                  pathOptions={{ color: 'blue', fillColor: 'blue', fillOpacity: 0.2 }}
                />
                <Marker
                  position={[parseFloat(config.start_zone_latitude), parseFloat(config.start_zone_longitude)]}
                  icon={L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div style="background:#0066ff;width:16px;height:16px;border-radius:50%;border:2px solid white;"></div>`,
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                  })}
                />
              </>
            )}
            {config?.start_zone_rogue_latitude && config?.start_zone_rogue_longitude && (
              <>
                <Circle
                  center={[parseFloat(config.start_zone_rogue_latitude), parseFloat(config.start_zone_rogue_longitude)]}
                  radius={START_ZONE_RADIUS}
                  pathOptions={{ color: 'green', fillColor: 'green', fillOpacity: 0.2 }}
                />
                <Marker
                  position={[parseFloat(config.start_zone_rogue_latitude), parseFloat(config.start_zone_rogue_longitude)]}
                  icon={L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div style="background:#00aa44;width:16px;height:16px;border-radius:50%;border:2px solid white;"></div>`,
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                  })}
                />
              </>
            )}
            {propPositions.map((prop) => (
              <Marker
                key={prop.id}
                position={[prop.lat, prop.lng]}
                icon={L.divIcon({
                  className: 'custom-div-icon',
                  html: `<div style="background:${prop.state === 'CAPTURED' ? '#888' : '#ff6b6b'};width:14px;height:14px;border-radius:50%;border:2px solid white;"></div>`,
                  iconSize: [14, 14],
                  iconAnchor: [7, 7]
                })}
              />
            ))}
            {playerPositions.map((p) => (
              <Marker
                key={p.id}
                position={[p.lat, p.lng]}
                icon={L.divIcon({
                  className: 'custom-div-icon',
                  html: `<div style="background:${p.role === 'AGENT' ? '#3880ff' : p.role === 'ROGUE' ? '#ff4961' : '#6c757d'};width:20px;height:20px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:10px;color:white;font-weight:bold;">${p.role === 'AGENT' ? 'A' : p.role === 'ROGUE' ? 'R' : '?'}</div>`,
                  iconSize: [20, 20],
                  iconAnchor: [10, 10]
                })}
              />
            ))}
          </MapContainer>
        </div>

        <div style={{ padding: 12, background: 'var(--ion-background-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <IonButton size="small" onClick={handlePlayPause}>
              <IonIcon icon={isPlaying ? pause : play} />
            </IonButton>
            <IonButton size="small" fill="outline" onClick={handleSpeedChange}>
              {speed}x
            </IonButton>
            <span style={{ fontSize: 12, color: 'var(--ion-color-medium)' }}>
              {currentIndex + 1} / {snapshots.length}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={seekValue}
            onChange={handleSeek}
            style={{ width: '100%', accentColor: 'var(--ion-color-primary)' }}
          />
        </div>
      </IonContent>
    </IonPage>
  );
};

export default GameReplay;
