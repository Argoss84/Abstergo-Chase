import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { ArOverlay } from '../components/ar/ArOverlay';
import { useCompass } from '../hooks/useCompass';
import { useGeolocation } from '../hooks/useGeolocation';
import { useModelLoader } from '../hooks/useModelLoader';
import { useWebXR } from '../hooks/useWebXR';
import type { GeoPosition } from '../types/geolocation';
import { computeDistanceBearing, toRad } from '../utils/geolocation';
import { SceneManager } from '../services/three/SceneManager';

const ArGps: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const targetOffsetRef = useRef(new THREE.Vector3(0, 0, -2));

  const [targetLat, setTargetLat] = useState('');
  const [targetLon, setTargetLon] = useState('');
  const [distance, setDistance] = useState<number | null>(null);
  const [bearing, setBearing] = useState<number | null>(null);
  const [cubeColor, setCubeColor] = useState(0x2dd36f);
  const [cubeRotation, setCubeRotation] = useState({ x: 0, y: 0 });
  const [geoStatusError, setGeoStatusError] = useState<string>('');

  const { currentPos, geoStatus: geoStatusFromHook } = useGeolocation();
  const geoStatus = geoStatusError || geoStatusFromHook;

  const { customModel, modelFileName, modelLoadError } = useModelLoader();

  const { heading, compassEnabled, requestCompass } = useCompass((error) => {
    setGeoStatusError(error);
  });

  const {
    isSupported,
    isSessionActive,
    status,
    startSession: startWebXRSession,
    stopSession: stopWebXRSession,
  } = useWebXR();

  useEffect(() => {
    if (currentPos && !targetLat && !targetLon) {
      setTargetLat(currentPos.lat.toFixed(6));
      setTargetLon(currentPos.lon.toFixed(6));
    }
  }, [currentPos, targetLat, targetLon]);

  const targetPos = useMemo(() => {
    const lat = Number(targetLat);
    const lon = Number(targetLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }
    return { lat, lon, accuracy: null, heading: null } as GeoPosition;
  }, [targetLat, targetLon]);

  useEffect(() => {
    if (!currentPos || !targetPos) {
      return;
    }

    const { distance: nextDistance, bearing: nextBearing } = computeDistanceBearing(
      currentPos,
      targetPos
    );
    const headingDeg = heading ?? currentPos.heading ?? 0;
    const relativeBearing = (nextBearing - headingDeg + 360) % 360;
    const relativeRad = toRad(relativeBearing);

    const x = nextDistance * Math.sin(relativeRad);
    const z = -nextDistance * Math.cos(relativeRad);

    const newPosition = new THREE.Vector3(x, 0, z);

    if (sceneManagerRef.current) {
      sceneManagerRef.current.updatePosition(newPosition);
    } else {
      targetOffsetRef.current.set(x, 0, z);
    }

    setDistance(nextDistance);
    setBearing(nextBearing);
  }, [currentPos, targetPos, heading]);

  const handleStartSession = async () => {
    if (!containerRef.current) return;

    await startWebXRSession(
      (session) => {
        if (!containerRef.current) return;

        const sceneManager = new SceneManager({
          onCubeColorChange: setCubeColor,
          onCubeRotationChange: setCubeRotation,
          enableHandTracking: false,
        });

        sceneManager.init(
          session,
          containerRef.current,
          customModel,
          targetOffsetRef.current
        );

        sceneManagerRef.current = sceneManager;
      },
      overlayRef.current
    );
  };

  const handleStopSession = async () => {
    if (sceneManagerRef.current) {
      sceneManagerRef.current.cleanup();
      sceneManagerRef.current = null;
    }
    await stopWebXRSession();
  };

  const handleRequestCompass = async () => {
    await requestCompass();
  };

  const handleUseCurrentPosition = () => {
    if (currentPos) {
      setTargetLat(currentPos.lat.toFixed(6));
      setTargetLon(currentPos.lon.toFixed(6));
    }
  };

  useEffect(() => {
    return () => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.cleanup();
      }
    };
  }, []);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>AR GPS</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <div
            ref={containerRef}
            style={{ position: 'absolute', inset: 0, background: '#000' }}
          />
          <div
            ref={overlayRef}
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
            }}
          >
            <ArOverlay
              isSupported={isSupported}
              status={status}
              geoStatus={geoStatus}
              targetLat={targetLat}
              targetLon={targetLon}
              onTargetLatChange={setTargetLat}
              onTargetLonChange={setTargetLon}
              modelFileName={modelFileName}
              modelLoadError={modelLoadError}
              currentPos={currentPos}
              onUseCurrentPosition={handleUseCurrentPosition}
              compassEnabled={compassEnabled}
              onRequestCompass={handleRequestCompass}
              isSessionActive={isSessionActive}
              onStartSession={handleStartSession}
              onStopSession={handleStopSession}
              heading={heading}
              distance={distance}
              bearing={bearing}
            />
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default ArGps;
