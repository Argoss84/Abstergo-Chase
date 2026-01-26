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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Charger tous les modèles 3D depuis src/objects/ avec Vite
// Utiliser ?url pour obtenir l'URL des fichiers binaires (.glb, .gltf)
const modelAssets = import.meta.glob('../objects/*.{glb,gltf}', {
  eager: false,
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

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
  const objectRef = useRef<THREE.Object3D | null>(null);
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
  const lastCalculatedPositionRef = useRef(new THREE.Vector3(0, 0, -2));
  const smoothedHeadingRef = useRef<number | null>(null);
  const loaderRef = useRef<GLTFLoader | null>(null);

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
  const [customModel, setCustomModel] = useState<THREE.Group | null>(null);
  const [modelFileName, setModelFileName] = useState<string>('');
  const [modelLoadError, setModelLoadError] = useState<string>('');

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
    
    const newPosition = new THREE.Vector3(x, 0, z);
    
    // Filtrer les changements trop petits pour éviter les micro-mouvements
    // Surtout important quand le compas est actif (heading change souvent)
    const positionChange = lastCalculatedPositionRef.current.distanceTo(newPosition);
    const minChangeThreshold = 0.5; // Seuil minimum de changement en mètres
    
    // Mettre à jour seulement si le changement est significatif
    // Vérifier si c'est la première initialisation (position initiale est à -2 sur Z)
    const isInitialPosition = lastCalculatedPositionRef.current.z === -2 && 
                              lastCalculatedPositionRef.current.x === 0 && 
                              lastCalculatedPositionRef.current.y === 0;
    
    if (positionChange > minChangeThreshold || isInitialPosition) {
      targetOffsetRef.current.set(x, 0, z);
      lastCalculatedPositionRef.current.copy(newPosition);
    }
    
    setDistance(nextDistance);
    setBearing(nextBearing);
  }, [currentPos, targetPos, heading]);

  const loadModelFromObjects = useCallback((modelPath: string) => {
    if (!loaderRef.current) {
      loaderRef.current = new GLTFLoader();
    }

    const loader = loaderRef.current;
    setModelLoadError('');
    
    loader.load(
      modelPath,
      (gltf) => {
        // Cloner le modèle pour éviter les problèmes de référence
        const model = gltf.scene.clone();
        
        // Calculer la bounding box pour centrer et ajuster la taille
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        // Centrer le modèle
        model.position.sub(center);
        
        // Ajuster la taille si nécessaire (max 2 mètres dans la plus grande dimension)
        const maxSize = 2;
        const maxDimension = Math.max(size.x, size.y, size.z);
        if (maxDimension > maxSize) {
          const scale = maxSize / maxDimension;
          model.scale.set(scale, scale, scale);
        }
        
        setCustomModel(model);
        const fileName = modelPath.split('/').pop() || modelPath;
        setModelFileName(fileName);
        setModelLoadError('');
      },
      (progress) => {
        // Optionnel: afficher la progression du chargement
        if (progress.total > 0) {
          const percent = (progress.loaded / progress.total) * 100;
          setModelLoadError(`Chargement... ${percent.toFixed(0)}%`);
        }
      },
      (error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : 'Format non supporté';
        setModelLoadError(`Erreur de chargement: ${errorMessage}`);
      }
    );
  }, []);

  // Charger automatiquement un modèle au démarrage depuis src/objects/
  useEffect(() => {
    const tryLoadModel = async () => {
      // Obtenir tous les chemins de modèles disponibles
      const modelPaths = Object.keys(modelAssets);
      
      // Trier par priorité : model.glb > model.gltf > default.glb > default.gltf > autres
      const priorityOrder = (path: string) => {
        if (path.includes('model.glb')) return 1;
        if (path.includes('model.gltf')) return 2;
        if (path.includes('default.glb')) return 3;
        if (path.includes('default.gltf')) return 4;
        return 5;
      };
      
      const sortedPaths = modelPaths.sort((a, b) => priorityOrder(a) - priorityOrder(b));

      // Essayer de charger le premier modèle disponible
      for (const path of sortedPaths) {
        try {
          const getUrl = modelAssets[path];
          if (getUrl) {
            const url = await getUrl();
            loadModelFromObjects(url);
            return;
          }
        } catch (error) {
          // Continuer avec le prochain modèle
          continue;
        }
      }
      // Si aucun modèle n'est trouvé, utiliser le cube par défaut
      setModelLoadError('');
    };

    tryLoadModel();
  }, [loadModelFromObjects]);

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
      // Nettoyer selon le type d'objet
      const obj = objectRef.current;
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const material = obj.material;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material.dispose();
        }
      } else {
        // Nettoyer un groupe ou autre objet 3D (modèle 3D)
        obj.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
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
      
      // Utiliser le modèle personnalisé s'il existe, sinon créer un cube par défaut
      let object3D: THREE.Object3D;
      
      if (customModel) {
        // Cloner le modèle pour éviter les problèmes de référence
        object3D = customModel.clone();
        object3D.position.copy(targetOffsetRef.current);
      } else {
        // Créer un cube par défaut
        const geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        const material = new THREE.MeshStandardMaterial({ color: cubeColorRef.current });
        object3D = new THREE.Mesh(geometry, material);
        object3D.position.copy(targetOffsetRef.current);
      }
      
      smoothedPositionRef.current.copy(targetOffsetRef.current);
      scene.add(object3D);

      // Créer un raycaster pour les interactions
      const raycaster = new THREE.Raycaster();
      raycasterRef.current = raycaster;

      // Ajouter un contrôleur pour les interactions AR
      const controller = renderer.xr.getController(0);
      const handleSelect = () => {
        if (!objectRef.current || !raycasterRef.current) return;
        
        const obj = objectRef.current;
        const raycaster = raycasterRef.current;
        
        // Utiliser la position actuelle du contrôleur
        const position = new THREE.Vector3();
        const direction = new THREE.Vector3();
        position.setFromMatrixPosition(controller.matrixWorld);
        direction.set(0, 0, -1).applyMatrix4(controller.matrixWorld).sub(position).normalize();
        
        raycaster.set(position, direction);
        
        // Intersecter avec tous les enfants si c'est un groupe
        const intersections = obj instanceof THREE.Group 
          ? raycaster.intersectObjects(obj.children, true)
          : raycaster.intersectObject(obj);
        
        if (intersections.length > 0) {
          // Si c'est un cube (Mesh), changer la couleur
          if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
            const newColor = Math.random() * 0xffffff;
            cubeColorRef.current = newColor;
            setCubeColor(newColor);
            obj.material.color.setHex(newColor);
          }
          
          // Ajouter une rotation (fonctionne pour tous les objets)
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
      objectRef.current = object3D;
      resizeHandlerRef.current = handleResize;
      
      // Réinitialiser la position lissée
      smoothedPositionRef.current.copy(targetOffsetRef.current);

      renderer.xr.setSession(session);
      
      renderer.setAnimationLoop((time: number, frame?: XRFrame) => {
        if (objectRef.current && cameraRef.current) {
          const cube = objectRef.current;
          
          // Lissage de la position (lerp) pour éviter le clignotement
          // Facteur réduit pour plus de stabilité, surtout avec le compas actif
          const smoothingFactor = 0.05; // Valeur plus faible = mouvement plus stable mais moins réactif
          
          // Calculer la distance entre la position actuelle lissée et la cible
          const distanceToTarget = smoothedPositionRef.current.distanceTo(targetOffsetRef.current);
          
          // Seuil minimum : ne bouger que si le changement est significatif (> 0.1 mètre)
          // Cela évite les micro-mouvements dus aux variations du compas
          if (distanceToTarget > 0.1) {
            smoothedPositionRef.current.lerp(targetOffsetRef.current, smoothingFactor);
          } else {
            // Si très proche, interpolation plus rapide pour finir le mouvement
            smoothedPositionRef.current.lerp(targetOffsetRef.current, 0.3);
          }
          
          cube.position.copy(smoothedPositionRef.current);
          
          // Rotation automatique douce combinée avec la rotation interactive
          cube.rotation.x = cubeRotationRef.current.x + time * 0.0005;
          cube.rotation.y = cubeRotationRef.current.y + time * 0.001;
          
          // Mettre à jour la couleur si elle a changé (seulement pour les Mesh avec matériau)
          if (cube instanceof THREE.Mesh && cube.material instanceof THREE.MeshStandardMaterial) {
            const material = cube.material;
            if (material.color.getHex() !== cubeColorRef.current) {
              material.color.setHex(cubeColorRef.current);
            }
          }
        }
        renderer.render(scene, camera);
      });
    },
    [customModel]
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
      // Réinitialiser le heading lissé au démarrage
      smoothedHeadingRef.current = null;
      
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
        if (typeof webkitHeading === 'number' && !isNaN(webkitHeading)) {
          // Lisser le heading pour éviter les bonds
          const smoothingFactor = 0.2; // Facteur de lissage (0-1)
          if (smoothedHeadingRef.current === null) {
            smoothedHeadingRef.current = webkitHeading;
          } else {
            // Gérer le passage par 0/360 degrés
            let diff = webkitHeading - smoothedHeadingRef.current;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            smoothedHeadingRef.current = (smoothedHeadingRef.current + diff * smoothingFactor + 360) % 360;
          }
          setHeading(smoothedHeadingRef.current);
          return;
        }
        if (event.alpha !== null && !isNaN(event.alpha)) {
          const rawHeading = (360 - event.alpha) % 360;
          
          // Lisser le heading pour éviter les bonds
          const smoothingFactor = 0.2; // Facteur de lissage (0-1)
          if (smoothedHeadingRef.current === null) {
            smoothedHeadingRef.current = rawHeading;
          } else {
            // Gérer le passage par 0/360 degrés pour un lissage correct
            let diff = rawHeading - smoothedHeadingRef.current;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            
            // Filtrer les changements trop brusques (probablement des erreurs)
            const maxChange = 45; // Maximum de changement accepté en degrés par mise à jour
            if (Math.abs(diff) > maxChange) {
              // Ignorer ce changement, probablement une erreur de mesure
              return;
            }
            
            smoothedHeadingRef.current = (smoothedHeadingRef.current + diff * smoothingFactor + 360) % 360;
          }
          setHeading(smoothedHeadingRef.current);
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

              {modelFileName && (
                <IonText color="success" style={{ fontSize: '12px', display: 'block', marginTop: 12 }}>
                  Modèle 3D chargé: {modelFileName} (depuis src/objects/)
                </IonText>
              )}
              {modelLoadError && (
                <IonText color="warning" style={{ fontSize: '12px', display: 'block', marginTop: 12 }}>
                  {modelLoadError}
                </IonText>
              )}
              {!modelFileName && !modelLoadError && (
                <IonText style={{ fontSize: '11px', display: 'block', marginTop: 12, opacity: 0.7 }}>
                  Modèle 3D: Cube par défaut (placez un fichier .glb ou .gltf dans src/objects/)
                </IonText>
              )}

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
