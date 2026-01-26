import {
  IonButton,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonText,
} from '@ionic/react';
import type { GeoPosition } from '../../types/geolocation';

interface ArOverlayProps {
  isSupported: boolean | null;
  status: string;
  geoStatus: string;
  targetLat: string;
  targetLon: string;
  onTargetLatChange: (value: string) => void;
  onTargetLonChange: (value: string) => void;
  modelFileName: string;
  modelLoadError: string;
  currentPos: GeoPosition | null;
  onUseCurrentPosition: () => void;
  compassEnabled: boolean;
  onRequestCompass: () => void;
  isSessionActive: boolean;
  onStartSession: () => void;
  onStopSession: () => void;
  heading: number | null;
  distance: number | null;
  bearing: number | null;
}

export const ArOverlay: React.FC<ArOverlayProps> = ({
  isSupported,
  status,
  geoStatus,
  targetLat,
  targetLon,
  onTargetLatChange,
  onTargetLonChange,
  modelFileName,
  modelLoadError,
  currentPos,
  onUseCurrentPosition,
  compassEnabled,
  onRequestCompass,
  isSessionActive,
  onStartSession,
  onStopSession,
  heading,
  distance,
  bearing,
}) => {
  return (
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
            onIonChange={(event) => onTargetLatChange(event.detail.value ?? '')}
          />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">Target longitude</IonLabel>
          <IonInput
            type="number"
            inputmode="decimal"
            value={targetLon}
            onIonChange={(event) => onTargetLonChange(event.detail.value ?? '')}
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
        <IonButton size="small" onClick={onUseCurrentPosition}>
          Use current position
        </IonButton>
        <IonButton size="small" onClick={onRequestCompass}>
          {compassEnabled ? 'Compass enabled' : 'Enable compass'}
        </IonButton>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <IonButton
          expand="block"
          onClick={isSessionActive ? onStopSession : onStartSession}
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
          WebXR AR requires HTTPS or localhost. GPS alignment is approximate and depends on compass
          accuracy.
        </div>
      </IonText>
    </div>
  );
};
