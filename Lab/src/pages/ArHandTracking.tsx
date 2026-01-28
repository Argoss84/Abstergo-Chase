import {
  IonButton,
  IonContent,
  IonHeader,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { useEffect, useRef, useState } from 'react';
import { HandTracking2D } from '../services/HandTracking2D';

const ArHandTracking: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handTrackingRef = useRef<HandTracking2D | null>(null);

  const [handTrackingActive, setHandTrackingActive] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const [presentToast] = useIonToast();
  const prevHandTrackingRef = useRef<boolean | null>(null);

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

  const handleStart = async () => {
    if (!containerRef.current || handTrackingRef.current) return;

    const ht = new HandTracking2D({
      onStatusChange: setHandTrackingActive,
      onError: (msg) => {
        presentToast({ message: msg, duration: 4000, position: 'top', color: 'warning' });
      },
    });

    const ok = await ht.start(containerRef.current, selectedDeviceId || undefined);
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
        <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
          <div
            ref={containerRef}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
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
              <div style={{ marginBottom: 6 }}>
                Mains : {handTrackingActive ? <span style={{ color: '#2dd36f' }}>détectées</span> : '—'}
              </div>
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
