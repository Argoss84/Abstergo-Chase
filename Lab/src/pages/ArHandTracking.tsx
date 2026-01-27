import { IonButton, IonContent, IonHeader, IonPage, IonTitle, IonToolbar, useIonToast } from '@ionic/react';
import { useEffect, useRef, useState } from 'react';
import { HandTracking2D } from '../services/HandTracking2D';

const ArHandTracking: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handTrackingRef = useRef<HandTracking2D | null>(null);

  const [handTrackingActive, setHandTrackingActive] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

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

    const ok = await ht.start(containerRef.current);
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
  };

  useEffect(() => {
    return () => handTrackingRef.current?.cleanup();
  }, []);

  const canStart = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

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
