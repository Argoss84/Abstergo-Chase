import {
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

type GeoPosition = {
  lat: number;
  lon: number;
  accuracy: number | null;
  heading: number | null;
};

const toRad = (degrees: number) => (degrees * Math.PI) / 180;
const toDeg = (radians: number) => (radians * 180) / Math.PI;

const computeDistanceBearing = (from: GeoPosition, to: GeoPosition) => {
  const earthRadius = 6371000;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const deltaLat = toRad(to.lat - from.lat);
  const deltaLon = toRad(to.lon - from.lon);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = earthRadius * c;

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;

  return { distance, bearing };
};

const ArGps: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const objectRef = useRef<THREE.Mesh | null>(null);
  const sessionRef = useRef<XRSession | null>(null);
  const resizeHandlerRef = useRef<(() => void) | null>(null);
  const orientationHandlerRef = useRef<((event: DeviceOrientationEvent) => void) | null>(null);
  const geoWatchIdRef = useRef<number | null>(null);
  const targetOffsetRef = useRef(new THREE.Vector3(0, 0, -2));
  const smoothedPositionRef = useRef(new THREE.Vector3(0, 0, -2));
  const raycasterRef = useRef<THREE.Raycaster | null>(null);
  const controllerRef = useRef<THREE.XRTargetRaySpace | null>(null);
  const cubeRotationRef = useRef({ x: 0, y: 0 });
  const cubeColorRef = useRef(0x2dd36f);

  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [geoStatus, setGeoStatus] = useState('Waiting for location...');
  const [heading, setHeading] = useState<number | null>(null);
  const [currentPos, setCurrentPos] = useState<GeoPosition | null>(null);
  const [targetLat, setTargetLat] = useState('');
  const [targetLon, setTargetLon] = useState('');
  const [distance, setDistance] = useState<number | null>(null);
  const [bearing, setBearing] = useState<number | null>(null);
  const [compassEnabled, setCompassEnabled] = useState(false);
  const [cubeColor, setCubeColor] = useState(0x2dd36f);
  const [cubeRotation, setCubeRotation] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let mounted = true;
    if (!navigator.xr || !navigator.xr.isSessionSupported) {
      setIsSupported(false);
      setStatus('WebXR not available in this browser.');
      return;
    }

    navigator.xr
      .isSessionSupported('immersive-ar')
      .then((supported) => {
        if (mounted) {
          setIsSupported(supported);
          if (!supported) {
            setStatus('WebXR AR is not supported on this device.');
          }
        }
      })
      .catch(() => {
        if (mounted) {
          setIsSupported(false);
          setStatus('Unable to check WebXR support.');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoStatus('Geolocation not supported.');
      return;
    }

    geoWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const nextPos: GeoPosition = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null,
          heading: position.coords.heading ?? null,
        };
        setCurrentPos(nextPos);
        setGeoStatus(`Location OK (±${Math.round(nextPos.accuracy ?? 0)}m)`);
      },
      (error) => {
        setGeoStatus(`Geolocation error: ${error.message}`);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );

    return () => {
      if (geoWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
      }
    };
  }, []);

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

    const { distance: nextDistance, bearing: nextBearing } = computeDistanceBearing(currentPos, targetPos);
    const headingDeg = heading ?? currentPos.heading ?? 0;
    const relativeBearing = (nextBearing - headingDeg + 360) % 360;
    const relativeRad = toRad(relativeBearing);

    const x = nextDistance * Math.sin(relativeRad);
    const z = -nextDistance * Math.cos(relativeRad);

    targetOffsetRef.current.set(x, 0, z);
    setDistance(nextDistance);
    setBearing(nextBearing);
  }, [currentPos, targetPos, heading]);

  const cleanupThree = useCallback(() => {
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.setAnimationLoop(null);
    }

    if (resizeHandlerRef.current) {
      window.removeEventListener('resize', resizeHandlerRef.current);
    }

    if (renderer && containerRef.current && renderer.domElement.parentElement === containerRef.current) {
      containerRef.current.removeChild(renderer.domElement);
    }

    if (objectRef.current) {
      objectRef.current.geometry.dispose();
      const material = objectRef.current.material;
      if (Array.isArray(material)) {
        material.forEach((item) => item.dispose());
      } else {
        material.dispose();
      }
    }

    if (controllerRef.current) {
      // Le contrôleur sera nettoyé automatiquement avec la scène
      controllerRef.current = null;
    }
    
    raycasterRef.current = null;
    controllerRef.current = null;

    renderer?.dispose();
    rendererRef.current = null;
    sceneRef.current = null;
    cameraRef.current = null;
    objectRef.current = null;
    resizeHandlerRef.current = null;
  }, []);

  const initThree = useCallback(
    (session: XRSession) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.xr.enabled = true;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        70,
        container.clientWidth / container.clientHeight,
        0.01,
        2000
      );

      const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
      scene.add(light);

      // Réinitialiser les refs au démarrage
      cubeRotationRef.current = { x: 0, y: 0 };
      cubeColorRef.current = 0x2dd36f;
      setCubeRotation({ x: 0, y: 0 });
      setCubeColor(0x2dd36f);
      
      const geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
      const material = new THREE.MeshStandardMaterial({ color: cubeColorRef.current });
      const cube = new THREE.Mesh(geometry, material);
      cube.position.copy(targetOffsetRef.current);
      smoothedPositionRef.current.copy(targetOffsetRef.current);
      scene.add(cube);

      // Créer un raycaster pour les interactions
      const raycaster = new THREE.Raycaster();
      raycasterRef.current = raycaster;

      // Ajouter un contrôleur pour les interactions AR
      const controller = renderer.xr.getController(0);
      const handleSelect = () => {
        if (!objectRef.current || !raycasterRef.current) return;
        
        const cube = objectRef.current;
        const raycaster = raycasterRef.current;
        
        // Utiliser la position actuelle du contrôleur
        const position = new THREE.Vector3();
        const direction = new THREE.Vector3();
        position.setFromMatrixPosition(controller.matrixWorld);
        direction.set(0, 0, -1).applyMatrix4(controller.matrixWorld).sub(position).normalize();
        
        raycaster.set(position, direction);
        const intersections = raycaster.intersectObject(cube);
        
        if (intersections.length > 0) {
          // Changer la couleur du cube au clic
          const newColor = Math.random() * 0xffffff;
          cubeColorRef.current = newColor;
          setCubeColor(newColor);
          (cube.material as THREE.MeshStandardMaterial).color.setHex(newColor);
          
          // Ajouter une rotation
          cubeRotationRef.current = {
            x: cubeRotationRef.current.x + Math.PI / 4,
            y: cubeRotationRef.current.y + Math.PI / 4,
          };
          setCubeRotation(cubeRotationRef.current);
        }
      };
      
      controller.addEventListener('selectstart', handleSelect);
      controllerRef.current = controller;
      scene.add(controller);

      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      container.appendChild(renderer.domElement);

      const handleResize = () => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      window.addEventListener('resize', handleResize);

      rendererRef.current = renderer;
      sceneRef.current = scene;
      cameraRef.current = camera;
      objectRef.current = cube;
      resizeHandlerRef.current = handleResize;
      
      // Réinitialiser la position lissée
      smoothedPositionRef.current.copy(targetOffsetRef.current);

      renderer.xr.setSession(session);
      
      renderer.setAnimationLoop((time: number, frame?: XRFrame) => {
        if (objectRef.current && cameraRef.current) {
          const cube = objectRef.current;
          
          // Lissage de la position (lerp) pour éviter le clignotement
          const smoothingFactor = 0.15; // Ajustez cette valeur (0-1) pour plus/moins de lissage
          smoothedPositionRef.current.lerp(targetOffsetRef.current, smoothingFactor);
          cube.position.copy(smoothedPositionRef.current);
          
          // Rotation automatique douce combinée avec la rotation interactive
          cube.rotation.x = cubeRotationRef.current.x + time * 0.0005;
          cube.rotation.y = cubeRotationRef.current.y + time * 0.001;
          
          // Mettre à jour la couleur si elle a changé
          const material = cube.material as THREE.MeshStandardMaterial;
          if (material.color.getHex() !== cubeColorRef.current) {
            material.color.setHex(cubeColorRef.current);
          }
        }
        renderer.render(scene, camera);
      });
    },
    []
  );

  const handleSessionEnd = useCallback(() => {
    setIsSessionActive(false);
    cleanupThree();
    setStatus('AR session ended.');
    sessionRef.current = null;
  }, [cleanupThree]);

  const startSession = useCallback(async () => {
    if (!navigator.xr || isSessionActive) {
      return;
    }

    setStatus('Starting AR session...');
    try {
      const sessionInit: XRSessionInit = {
        requiredFeatures: ['local'],
        optionalFeatures: ['dom-overlay', 'local-floor'],
      };
      const overlayRoot = overlayRef.current;
      const session = await navigator.xr.requestSession(
        'immersive-ar',
        overlayRoot ? ({ ...sessionInit, domOverlay: { root: overlayRoot } } as XRSessionInit) : sessionInit
      );

      session.addEventListener('end', handleSessionEnd);
      sessionRef.current = session;
      initThree(session);
      setIsSessionActive(true);
      setStatus('AR session active.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setStatus(`AR start failed: ${message}`);
    }
  }, [handleSessionEnd, initThree, isSessionActive]);

  const stopSession = useCallback(async () => {
    if (sessionRef.current) {
      await sessionRef.current.end();
    }
  }, []);

  const requestCompass = useCallback(async () => {
    if (compassEnabled) {
      return;
    }

    const requestPermission = (
      DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
    ).requestPermission;

    try {
      if (requestPermission) {
        const permission = await requestPermission();
        if (permission !== 'granted') {
          setGeoStatus('Compass permission denied.');
          return;
        }
      }

      const handler = (event: DeviceOrientationEvent) => {
        const webkitHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
          .webkitCompassHeading;
        if (typeof webkitHeading === 'number') {
          setHeading(webkitHeading);
          return;
        }
        if (event.alpha !== null) {
          const nextHeading = (360 - event.alpha) % 360;
          setHeading(nextHeading);
        }
      };

      window.addEventListener('deviceorientationabsolute', handler, true);
      window.addEventListener('deviceorientation', handler, true);
      orientationHandlerRef.current = handler;
      setCompassEnabled(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setGeoStatus(`Compass error: ${message}`);
    }
  }, [compassEnabled]);

  useEffect(() => {
    return () => {
      if (orientationHandlerRef.current) {
        window.removeEventListener('deviceorientationabsolute', orientationHandlerRef.current, true);
        window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
      }
      if (sessionRef.current) {
        sessionRef.current.end().catch(() => undefined);
      }
      cleanupThree();
    };
  }, [cleanupThree]);

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
            <div
              className="ion-padding"
              style={{
                maxWidth: 420,
                pointerEvents: 'auto',
                background: 'rgba(0, 0, 0, 0.6)',
                color: '#fff',
                borderRadius: 12,
                margin: 12,
              }}
            >
              <IonText>
                <div>WebXR: {isSupported === null ? 'checking...' : isSupported ? 'supported' : 'no'}</div>
                <div>Status: {status}</div>
                <div>Geo: {geoStatus}</div>
              </IonText>

              <IonList>
                <IonItem>
                  <IonLabel position="stacked">Target latitude</IonLabel>
                  <IonInput
                    type="number"
                    inputmode="decimal"
                    value={targetLat}
                    onIonChange={(event) => setTargetLat(event.detail.value ?? '')}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">Target longitude</IonLabel>
                  <IonInput
                    type="number"
                    inputmode="decimal"
                    value={targetLon}
                    onIonChange={(event) => setTargetLon(event.detail.value ?? '')}
                  />
                </IonItem>
              </IonList>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <IonButton
                  size="small"
                  onClick={() => {
                    if (currentPos) {
                      setTargetLat(currentPos.lat.toFixed(6));
                      setTargetLon(currentPos.lon.toFixed(6));
                    }
                  }}
                >
                  Use current position
                </IonButton>
                <IonButton size="small" onClick={requestCompass}>
                  {compassEnabled ? 'Compass enabled' : 'Enable compass'}
                </IonButton>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <IonButton
                  expand="block"
                  onClick={isSessionActive ? stopSession : startSession}
                  disabled={!isSupported}
                >
                  {isSessionActive ? 'Stop AR' : 'Start AR'}
                </IonButton>
              </div>

              <IonText>
                <div>Heading: {heading !== null ? `${heading.toFixed(0)}°` : 'n/a'}</div>
                <div>Distance: {distance !== null ? `${distance.toFixed(1)} m` : 'n/a'}</div>
                <div>Bearing: {bearing !== null ? `${bearing.toFixed(0)}°` : 'n/a'}</div>
              </IonText>
              <IonText>
                <div style={{ marginTop: 8 }}>
                  WebXR AR requires HTTPS or localhost. GPS alignment is approximate and depends on
                  compass accuracy.
                </div>
              </IonText>
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default ArGps;
