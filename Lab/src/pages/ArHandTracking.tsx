import {
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { HandTracking2D } from '../services/HandTracking2D';
import { useCompass } from '../hooks/useCompass';
import { useGeolocation } from '../hooks/useGeolocation';
import { useModelLoader } from '../hooks/useModelLoader';
import type { GeoPosition } from '../types/geolocation';
import { computeDistanceBearing, toRad } from '../utils/geolocation';

function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      c.geometry?.dispose();
      const m = c.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    }
  });
}

const MODEL_DISTANCE_M = 5;
const EYE_HEIGHT_M = 1.6; // hauteur des yeux → sol à -EYE_HEIGHT_M

const ArHandTracking: React.FC = () => {
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const threeContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handTrackingRef = useRef<HandTracking2D | null>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const headingRef = useRef<number | null>(null);
  const initialHeadingRef = useRef<number | null>(null);
  const customModelRef = useRef<THREE.Group | null>(null);
  const targetOffsetRef = useRef(new THREE.Vector3(0, -EYE_HEIGHT_M, -MODEL_DISTANCE_M));

  const [handTrackingActive, setHandTrackingActive] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [targetLat, setTargetLat] = useState('');
  const [targetLon, setTargetLon] = useState('');
  const [distance, setDistance] = useState<number | null>(null);
  const [bearing, setBearing] = useState<number | null>(null);
  const [relativeBearing, setRelativeBearing] = useState<number | null>(null);

  const [presentToast] = useIonToast();
  const prevHandTrackingRef = useRef<boolean | null>(null);

  const { currentPos, geoStatus } = useGeolocation();
  const { customModel, modelFileName, modelLoadError } = useModelLoader();
  const { heading, compassEnabled, requestCompass, betaRef, gammaRef } = useCompass((err) => {
    presentToast({ message: err, duration: 3000, position: 'top', color: 'warning' });
  });

  useEffect(() => {
    headingRef.current = heading;
  }, [heading]);

  useEffect(() => {
    customModelRef.current = customModel;
  }, [customModel]);

  useEffect(() => {
    if (currentPos && !targetLat && !targetLon) {
      setTargetLat(currentPos.lat.toFixed(6));
      setTargetLon(currentPos.lon.toFixed(6));
    }
  }, [currentPos, targetLat, targetLon]);

  const targetPos = useMemo((): GeoPosition | null => {
    const lat = Number(targetLat);
    const lon = Number(targetLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, accuracy: null, heading: null };
  }, [targetLat, targetLon]);

  // Modèle à 5 m au sol : "devant" = direction du téléphone au chargement. y=-EYE_HEIGHT_M = posé par terre.
  useEffect(() => {
    const h = heading ?? null;
    if (h != null && !isNaN(h) && initialHeadingRef.current === null) {
      initialHeadingRef.current = h;
    }
    const init = initialHeadingRef.current ?? 0;
    const current = h ?? init;
    const rel = (init - current + 360) % 360;
    const relRad = toRad(rel);
    const x = MODEL_DISTANCE_M * Math.sin(relRad);
    const z = -MODEL_DISTANCE_M * Math.cos(relRad);
    targetOffsetRef.current.set(x, -EYE_HEIGHT_M, z);
    setRelativeBearing(rel);
  }, [heading]);

  // Distance / cap vers la cible GPS (affichage seulement, le modèle n’utilise pas la cible).
  useEffect(() => {
    if (!currentPos || !targetPos) {
      setDistance(null);
      setBearing(null);
      return;
    }
    const { distance: d, bearing: b } = computeDistanceBearing(currentPos, targetPos);
    setDistance(d);
    setBearing(b);
  }, [currentPos, targetPos]);

  useEffect(() => {
    if (prevHandTrackingRef.current === null) {
      prevHandTrackingRef.current = handTrackingActive;
      return;
    }
    if (prevHandTrackingRef.current !== handTrackingActive) {
      prevHandTrackingRef.current = handTrackingActive;
      presentToast({
        message: handTrackingActive ? 'Mains : détectées' : 'Mains : non détectées',
        duration: 2000,
        position: 'top',
        color: handTrackingActive ? 'success' : 'medium',
      });
    }
  }, [handTrackingActive, presentToast]);

  // Scène Three.js type WebXR : fond 100% transparent, seul model.glb est dessiné (par-dessus la vidéo caméra)
  useEffect(() => {
    const container = threeContainerRef.current;
    if (!container) return;

    const w = Math.max(1, container.clientWidth || 1);
    const h = Math.max(1, container.clientHeight || 1);
    const aspect = w / h;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(w, h);
    renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:block;pointer-events:none;';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);

    const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(light);

    container.appendChild(renderer.domElement);

    const onResize = (): void => {
      if (!container?.parentElement || !camera || !renderer) return;
      const rw = Math.max(1, container.clientWidth);
      const rh = Math.max(1, container.clientHeight);
      renderer.setSize(rw, rh);
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    let rafId: number;
    const loop = (): void => {
      rafId = requestAnimationFrame(loop);
      const cm = customModelRef.current;
      if (cm && !modelRef.current && scene) {
        const m = cm.clone();
        m.position.copy(targetOffsetRef.current);
        scene.add(m);
        modelRef.current = m;
      }
      const model = modelRef.current;
      if (model) {
        model.position.copy(targetOffsetRef.current);
        const head = headingRef.current;
        if (head != null && !isNaN(head)) {
          model.rotation.y = toRad(-head);
        } else {
          model.rotation.y += 0.005;
        }
      }
      const b = betaRef.current;
      const g = gammaRef.current;
      if (b != null && g != null && !isNaN(b) && !isNaN(g)) {
        camera.rotation.order = 'YXZ';
        // beta=90° = téléphone droit vers l'horizon → rotation.x=0 pour regarder l'horizon (plan XZ). Modèle au sol visible en bas du champ.
        camera.rotation.x = toRad(b - 90);
        camera.rotation.z = toRad(-g);
      }
      if (renderer && scene && camera) {
        renderer.render(scene, camera);
      }
    };
    loop();

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      if (modelRef.current && scene) {
        scene.remove(modelRef.current);
        disposeObject3D(modelRef.current);
        modelRef.current = null;
      }
      if (renderer?.domElement?.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      renderer?.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  const handleUseCurrentPosition = () => {
    if (currentPos) {
      setTargetLat(currentPos.lat.toFixed(6));
      setTargetLon(currentPos.lon.toFixed(6));
    }
  };

  const modelLoading = !customModel && (modelLoadError === '' || modelLoadError.startsWith('Chargement'));

  const handleStart = async () => {
    if (!containerRef.current || !videoContainerRef.current || handTrackingRef.current) return;

    const ht = new HandTracking2D({
      onStatusChange: setHandTrackingActive,
      onError: (msg) => {
        presentToast({ message: msg, duration: 4000, position: 'top', color: 'warning' });
      },
      drawVideo: false,
      scaleHandsToViewport: true,
    });

    const ok = await ht.start(containerRef.current, selectedDeviceId, {
      videoContainer: videoContainerRef.current,
    });
    if (ok) {
      handTrackingRef.current = ht;
      setIsRunning(true);
    }
  };

  const handleStop = () => {
    handTrackingRef.current?.cleanup();
    handTrackingRef.current = null;
    setIsRunning(false);
    setHandTrackingActive(false);
    // Ré-enumérer les caméras après arrêt (les libellés sont disponibles une fois la permission accordée)
    navigator.mediaDevices?.enumerateDevices?.()?.then((devices) => {
      setCameras(devices.filter((d) => d.kind === 'videoinput' && d.deviceId));
    });
  };

  useEffect(() => {
    return () => handTrackingRef.current?.cleanup();
  }, []);

  const canStart = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      setCameras(devices.filter((d) => d.kind === 'videoinput' && d.deviceId));
    });
  }, []);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Détection des mains</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <div style={{ position: 'relative', width: '100%', minHeight: '100vh', height: '100%', background: '#000' }}>
          {/* Couche 0 – Caméra en direct (équivalent pass-through WebXR) */}
          <div
            ref={videoContainerRef}
            style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}
          />
          {/* Couche 1 – model.glb seul, fond transparent (comme en WebXR) */}
          <div
            ref={threeContainerRef}
            style={{ position: 'absolute', inset: 0, zIndex: 1 }}
          />
          {/* Overlay chargement modèle 3D (dans l’environnement) */}
          {modelLoading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                background: 'rgba(0,0,0,0.4)',
              }}
            >
              <div style={{ textAlign: 'center', color: '#fff', fontSize: 14, padding: 16 }}>
                <div style={{ marginBottom: 8 }}>Chargement du modèle 3D…</div>
                <div style={{ opacity: 0.9 }}>
                  {modelLoadError.startsWith('Chargement') ? modelLoadError : 'Préparation…'}
                </div>
              </div>
            </div>
          )}
          {/* Flèche vers le modèle (5 m dans la direction du téléphone au chargement) */}
          {relativeBearing != null && (
            <div
              style={{
                position: 'absolute',
                bottom: 72,
                left: 0,
                right: 0,
                zIndex: 2,
                display: 'flex',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,0,0,0.5)',
                  borderRadius: '50%',
                  transform: `rotate(${relativeBearing}deg)`,
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{ width: 28, height: 28, flexShrink: 0 }}
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 19V5M12 5l-6 6M12 5l6 6" />
                </svg>
              </div>
            </div>
          )}
          {/* Couche 2 – Mains (drawVideo: false) */}
          <div
            ref={containerRef}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 3,
              pointerEvents: 'none',
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'flex-start',
              padding: 8,
            }}
          >
            <div
              style={{
                pointerEvents: 'auto',
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                borderRadius: 8,
                padding: 10,
                fontSize: 12,
                maxWidth: 200,
              }}
            >
              {!isRunning && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ marginBottom: 4, opacity: 0.9 }}>Caméra</div>
                  <IonSelect
                    value={selectedDeviceId}
                    onIonChange={(e) => setSelectedDeviceId(e.detail.value ?? '')}
                    interface="popover"
                    style={{ minWidth: 160, '--background': 'rgba(40,40,40,0.95)', '--color': '#fff' } as React.CSSProperties}
                  >
                    <IonSelectOption value="">Par défaut</IonSelectOption>
                    {cameras.map((cam) => (
                      <IonSelectOption key={cam.deviceId} value={cam.deviceId}>
                        {cam.label || `Caméra ${cam.deviceId.slice(0, 8)}`}
                      </IonSelectOption>
                    ))}
                  </IonSelect>
                </div>
              )}
              <div style={{ marginBottom: 4 }}>
                Mains : {handTrackingActive ? <span style={{ color: '#2dd36f' }}>détectées</span> : '—'}
              </div>
              <div style={{ marginBottom: 4, opacity: 0.9 }}>
                GPS : {currentPos ? `${currentPos.lat.toFixed(5)}, ${currentPos.lon.toFixed(5)}` : '—'}
              </div>
              <div style={{ marginBottom: 4, fontSize: 10, opacity: 0.8 }}>{geoStatus}</div>
              <div style={{ marginBottom: 4 }}>
                Boussole : {compassEnabled ? 'OK' : <button type="button" onClick={() => requestCompass()} style={{ background: 'transparent', border: '1px solid #666', color: '#fff', borderRadius: 4, padding: '2px 6px', fontSize: 10 }}>Activer</button>}
              </div>
              <div style={{ marginBottom: 4 }}>
                Modèle 3D :{' '}
                {customModel ? (
                  <span style={{ color: '#2dd36f' }}>✓ {modelFileName || 'model.glb'}</span>
                ) : modelLoadError.startsWith('Chargement') ? (
                  <span style={{ color: '#ffc409' }}>{modelLoadError}</span>
                ) : modelLoadError ? (
                  <span style={{ color: '#eb445a' }}>Erreur</span>
                ) : (
                  <span style={{ color: '#ffc409' }}>Chargement…</span>
                )}
              </div>
              <div style={{ marginBottom: 2, fontSize: 10, opacity: 0.9 }}>Modèle : 5 m devant, posé au sol (devant = direction du téléphone au chargement)</div>
              <div style={{ marginBottom: 2, fontSize: 10, opacity: 0.9 }}>Cible GPS (optionnel, pour distance)</div>
              <div style={{ marginBottom: 2, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <IonInput
                  type="number"
                  inputmode="decimal"
                  placeholder="Lat"
                  value={targetLat}
                  onIonInput={(e) => setTargetLat(e.detail.value ?? '')}
                  style={{ width: 70, fontSize: 11, '--padding-start': '6px', '--padding-end': '6px' } as React.CSSProperties}
                />
                <IonInput
                  type="number"
                  inputmode="decimal"
                  placeholder="Lon"
                  value={targetLon}
                  onIonInput={(e) => setTargetLon(e.detail.value ?? '')}
                  style={{ width: 70, fontSize: 11, '--padding-start': '6px', '--padding-end': '6px' } as React.CSSProperties}
                />
                <button
                  type="button"
                  onClick={handleUseCurrentPosition}
                  style={{ background: 'transparent', border: '1px solid #666', color: '#fff', borderRadius: 4, padding: '2px 6px', fontSize: 10 }}
                >
                  Ma position
                </button>
              </div>
              {(distance != null || bearing != null) && (
                <div style={{ marginBottom: 4, fontSize: 10, opacity: 0.85 }}>
                  {distance != null && `Cible: ${distance.toFixed(1)} m`}
                  {distance != null && ' · '}
                  Modèle: {MODEL_DISTANCE_M} m
                  {bearing != null && ` · Cap: ${bearing.toFixed(0)}°`}
                </div>
              )}
              {!isRunning ? (
                <IonButton
                  size="small"
                  expand="block"
                  onClick={handleStart}
                  disabled={!canStart}
                  style={{ height: 36, fontSize: 12 }}
                >
                  Démarrer
                </IonButton>
              ) : (
                <IonButton
                  size="small"
                  expand="block"
                  onClick={handleStop}
                  style={{ height: 36, fontSize: 12 }}
                >
                  Arrêter
                </IonButton>
              )}
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default ArHandTracking;
