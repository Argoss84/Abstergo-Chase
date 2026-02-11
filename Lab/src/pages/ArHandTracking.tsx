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
import { FullBodyTracking2D } from '../services/HandTracking2D';

const ArHandTracking: React.FC = () => {
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const trackingRef = useRef<FullBodyTracking2D | null>(null);
  const prevTrackingRef = useRef<boolean | null>(null);

  const [trackingActive, setTrackingActive] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [presentToast] = useIonToast();

  useEffect(() => {
    if (prevTrackingRef.current === null) {
      prevTrackingRef.current = trackingActive;
      return;
    }
    if (prevTrackingRef.current !== trackingActive) {
      prevTrackingRef.current = trackingActive;
      presentToast({
        message: trackingActive ? 'Corps et mains détectés' : 'Corps et mains : non détectés',
        duration: 2000,
        position: 'top',
        color: trackingActive ? 'success' : 'medium',
      });
    }
  }, [trackingActive, presentToast]);

  const handleStart = async () => {
    if (!containerRef.current || !videoContainerRef.current || trackingRef.current) return;

    const ht = new FullBodyTracking2D({
      onStatusChange: setTrackingActive,
      onError: (msg) => {
        presentToast({ message: msg, duration: 4000, position: 'top', color: 'warning' });
      },
      drawVideo: false,
      scalePoseToViewport: true,
    });

    const ok = await ht.start(containerRef.current, selectedDeviceId, {
      videoContainer: videoContainerRef.current,
    });
    if (ok) {
      trackingRef.current = ht;
      setIsRunning(true);
    }
  };

  const handleStop = () => {
    trackingRef.current?.cleanup();
    trackingRef.current = null;
    setIsRunning(false);
    setTrackingActive(false);
    navigator.mediaDevices?.enumerateDevices?.()?.then((devices) => {
      setCameras(devices.filter((d) => d.kind === 'videoinput' && d.deviceId));
    });
  };

  useEffect(() => {
    return () => trackingRef.current?.cleanup();
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
          <IonTitle>Corps et mains</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <div style={{ position: 'relative', width: '100%', minHeight: '100vh', height: '100%', background: '#000' }}>
          <div
            ref={videoContainerRef}
            style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}
          />
          <div
            ref={containerRef}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
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
              <div style={{ marginBottom: 8 }}>
                Corps et mains : {trackingActive ? <span style={{ color: '#2dd36f' }}>détectés</span> : '—'}
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
