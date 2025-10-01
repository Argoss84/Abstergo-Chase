import React, { useState, useRef, useEffect } from 'react';
import { 
  IonButton, 
  IonIcon, 
  IonFab, 
  IonFabButton, 
  IonFabList,
  IonAlert,
  IonToast,
  IonSegment,
  IonSegmentButton,
  IonLabel
} from '@ionic/react';
import { 
  camera, 
  cameraReverse, 
  stop, 
  play, 
  flash, 
  flashOff,
  settings
} from 'ionicons/icons';
import './Camera.css';
import { Scanner } from '@yudiel/react-qr-scanner';

type CameraMode = 'capture' | 'photo';

interface CameraProps {
  onCapture?: (imageData: string) => void;
  onQRCodeDetected?: (qrCode: string) => void;
  onClose?: () => void;
  showControls?: boolean;
  autoStart?: boolean;
  className?: string;
  defaultMode?: CameraMode;
}

const Camera: React.FC<CameraProps> = ({
  onCapture,
  onQRCodeDetected,
  onClose,
  showControls = true,
  autoStart = false,
  className = '',
  defaultMode = 'capture'
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentCamera, setCurrentCamera] = useState<'back' | 'front'>('back');
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const streamRef = useRef<MediaStream | null>(null);
  
  // États pour les modes de caméra
  const [currentMode, setCurrentMode] = useState<CameraMode>(defaultMode);
  const [qrDetectionActive, setQrDetectionActive] = useState(false);

  // Obtenir la liste des caméras disponibles
  const getAvailableCameras = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(device => device.kind === 'videoinput');
      setAvailableCameras(cameras);
      return cameras;
    } catch (error) {
      console.error('Erreur lors de la récupération des caméras:', error);
      return [];
    }
  };

  // Démarrer le flux vidéo
  const startCamera = async (facingMode: 'user' | 'environment' = 'environment') => {
    try {
      // Arrêter le flux existant s'il y en a un
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setIsStreaming(true);
        setCurrentCamera(facingMode === 'environment' ? 'back' : 'front');
      }
    } catch (error) {
      console.error('Erreur lors du démarrage de la caméra:', error);
      setAlertMessage('Impossible d\'accéder à la caméra. Vérifiez les permissions.');
      setShowAlert(true);
    }
  };

  // Arrêter le flux vidéo
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  };

  // Basculer entre caméra avant et arrière
  const switchCamera = async () => {
    const newCamera = currentCamera === 'back' ? 'front' : 'back';
    const facingMode = newCamera === 'back' ? 'environment' : 'user';
    await startCamera(facingMode);
  };

  // Capturer une photo
  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) return;

    // Ajuster la taille du canvas à la vidéo
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Dessiner l'image de la vidéo sur le canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convertir en base64
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    
    if (onCapture) {
      onCapture(imageData);
    }

    setToastMessage('Photo capturée !');
    setShowToast(true);
  };

  // Gérer le flash (si disponible)
  const toggleFlash = () => {
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack && videoTrack.getCapabilities) {
        const capabilities = videoTrack.getCapabilities() as any;
        if (capabilities.torch) {
          videoTrack.applyConstraints({
            advanced: [{ torch: !flashEnabled } as any]
          });
          setFlashEnabled(!flashEnabled);
        } else {
          setToastMessage('Flash non disponible sur cet appareil');
          setShowToast(true);
        }
      }
    }
  };

  // Détection QR via Scanner (mode capture)
  const handleScan = (detectedCodes: Array<{ rawValue: string }> | undefined) => {
    if (!detectedCodes || detectedCodes.length === 0) return;
    const value = detectedCodes[0]?.rawValue;
    if (value) {
      if (onQRCodeDetected) {
        onQRCodeDetected(value);
      }
      setToastMessage(`🔍 QR Code détecté: ${value}`);
      setShowToast(true);
    }
  };

  const handleScannerError = (err: unknown) => {
    console.error('Erreur du scanner QR:', err);
    setAlertMessage('Erreur du scanner QR. Vérifiez les permissions caméra.');
    setShowAlert(true);
  };

  // Basculer entre les modes
  const switchMode = (mode: CameraMode) => {
    setCurrentMode(mode);
    if (mode === 'capture') {
      // Arrêter notre flux vidéo pour laisser le Scanner accéder à la caméra
      if (isStreaming) {
        stopCamera();
      }
      setQrDetectionActive(true);
    } else {
      // Mode photo: démarrer notre propre flux caméra
      if (!isStreaming) {
        startCamera(currentCamera === 'back' ? 'environment' : 'user');
      }
      setQrDetectionActive(false);
    }
    setToastMessage(`Mode ${mode === 'capture' ? 'Capture (QR)' : 'Photo'} activé`);
    setShowToast(true);
  };

  // Initialisation
  useEffect(() => {
    getAvailableCameras();
    if (autoStart) {
      if (defaultMode === 'photo') {
        startCamera('environment');
      } else {
        setQrDetectionActive(true);
      }
    }
    return () => {
      stopCamera();
    };
  }, [autoStart]);

  // Gérer le démarrage de la détection QR quand le mode change
  useEffect(() => {
    if (currentMode === 'capture') {
      setQrDetectionActive(true);
    } else {
      setQrDetectionActive(false);
    }
  }, [currentMode]);

  // Nettoyer les intervalles au démontage
  useEffect(() => {
    return () => {
      // Cleanup handled by unmounting
    };
  }, []);

  return (
    <div className={`camera-container ${className}`}>
      {/* Zone de prévisualisation vidéo */}
      <div className="camera-preview">
        {currentMode === 'photo' ? (
          <video
            ref={videoRef}
            className="camera-video"
            playsInline
            muted
          />
        ) : (
          <div className="camera-video">
            <Scanner
              onScan={handleScan}
              onError={handleScannerError}
              scanDelay={500}
              paused={false}
              formats={['qr_code']}
              constraints={{
                facingMode: currentCamera === 'back' ? 'environment' : 'user'
              }}
            />
          </div>
        )}
        
        {/* Canvas caché pour la capture */}
        <canvas
          ref={canvasRef}
          className="camera-canvas"
          style={{ display: 'none' }}
        />

        {/* Overlay avec informations */}
        <div className="camera-overlay">
          <div className="camera-info">
            <span className="camera-status">
              {isStreaming || currentMode === 'capture' ? '● ENREGISTREMENT' : '○ ARRÊTÉ'}
            </span>
            <span className="camera-type">
              {currentCamera === 'back' ? 'CAMÉRA ARRIÈRE' : 'CAMÉRA AVANT'}
            </span>
          </div>
          
          {/* Sélecteur de mode */}
          <div className="camera-mode-selector">
            <IonSegment 
              value={currentMode} 
              onIonChange={(e) => switchMode(e.detail.value as CameraMode)}
              className="mode-segment"
            >
              <IonSegmentButton value="capture">
                <IonLabel>Capture</IonLabel>
              </IonSegmentButton>
              <IonSegmentButton value="photo">
                <IonLabel>Photo</IonLabel>
              </IonSegmentButton>
            </IonSegment>
          </div>
          
          {/* Indicateur de détection QR */}
          {currentMode === 'capture' && qrDetectionActive && (
            <div className="qr-detection-indicator">
              <span className="qr-scanning">🔍 SCAN QR EN COURS...</span>
            </div>
          )}
        </div>
      </div>

      {/* Contrôles de la caméra */}
      {showControls && (
        <div className="camera-controls">
          <IonFab vertical="bottom" horizontal="start" slot="fixed">
            <IonFabButton 
              color="dark" 
              onClick={onClose}
              className="camera-close-btn"
            >
              <IonIcon icon={stop} />
            </IonFabButton>
          </IonFab>

          <IonFab vertical="bottom" horizontal="center" slot="fixed">
            <IonFabButton 
              color="primary" 
              onClick={capturePhoto}
              disabled={!isStreaming}
              className="camera-capture-btn"
            >
              <IonIcon icon={camera} />
            </IonFabButton>
          </IonFab>

          <IonFab vertical="bottom" horizontal="end" slot="fixed">
            <IonFabList side="top">
              <IonFabButton 
                color="medium" 
              onClick={async () => {
                const newCamera = currentCamera === 'back' ? 'front' : 'back';
                setCurrentCamera(newCamera);
                if (currentMode === 'photo') {
                  await startCamera(newCamera === 'back' ? 'environment' : 'user');
                }
              }}
              disabled={currentMode === 'photo' ? !isStreaming : false}
                className="camera-switch-btn"
              >
                <IonIcon icon={cameraReverse} />
              </IonFabButton>
              
              <IonFabButton 
                color="warning" 
              onClick={currentMode === 'photo' ? toggleFlash : undefined}
              disabled={currentMode === 'photo' ? !isStreaming : true}
                className="camera-flash-btn"
              >
                <IonIcon icon={flashEnabled ? flash : flashOff} />
              </IonFabButton>
              
              <IonFabButton 
                color="success" 
              onClick={currentMode === 'photo' ? (isStreaming ? stopCamera : () => startCamera('environment')) : undefined}
                className="camera-start-btn"
              >
              <IonIcon icon={currentMode === 'photo' ? (isStreaming ? stop : play) : play} />
              </IonFabButton>
            </IonFabList>
          </IonFab>
        </div>
      )}

      {/* Alert pour les erreurs */}
      <IonAlert
        isOpen={showAlert}
        onDidDismiss={() => setShowAlert(false)}
        header="Erreur Caméra"
        message={alertMessage}
        buttons={['OK']}
      />

      {/* Toast pour les notifications */}
      <IonToast
        isOpen={showToast}
        onDidDismiss={() => setShowToast(false)}
        message={toastMessage}
        duration={2000}
        position="top"
      />
    </div>
  );
};

export default Camera;
