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
  handTrackingActive?: boolean;
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
  handTrackingActive = false,
}) => {
  return (
    <div
      className="ion-padding"
      style={{
        maxWidth: 280,
        pointerEvents: 'auto',
        background: 'rgba(0, 0, 0, 0.7)',
        color: '#fff',
        borderRadius: 8,
        margin: 8,
        fontSize: '12px',
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 1000,
      }}
    >
      <IonText style={{ fontSize: '11px', lineHeight: '1.3' }}>
        <div style={{ marginBottom: 4 }}>AR: {isSessionActive ? 'ON' : 'OFF'}</div>
        <div style={{ marginBottom: 4 }}>GPS: {geoStatus.length > 20 ? geoStatus.substring(0, 20) + '...' : geoStatus}</div>
        {handTrackingActive && <div style={{ marginBottom: 4, color: '#2dd36f' }}>✓ Hands</div>}
      </IonText>

      {!isSessionActive && (
        <>
          <IonList style={{ marginTop: 8, marginBottom: 8 }}>
            <IonItem style={{ '--min-height': '40px' } as any}>
              <IonLabel position="stacked" style={{ fontSize: '11px' }}>Lat</IonLabel>
              <IonInput
                type="number"
                inputmode="decimal"
                value={targetLat}
                onIonChange={(event) => onTargetLatChange(event.detail.value ?? '')}
                style={{ fontSize: '12px' }}
              />
            </IonItem>
            <IonItem style={{ '--min-height': '40px' } as any}>
              <IonLabel position="stacked" style={{ fontSize: '11px' }}>Lon</IonLabel>
              <IonInput
                type="number"
                inputmode="decimal"
                value={targetLon}
                onIonChange={(event) => onTargetLonChange(event.detail.value ?? '')}
                style={{ fontSize: '12px' }}
              />
            </IonItem>
          </IonList>

          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <IonButton size="small" onClick={onUseCurrentPosition} style={{ fontSize: '11px', '--padding-start': '8px', '--padding-end': '8px' } as any}>
              Use GPS
            </IonButton>
            <IonButton size="small" onClick={onRequestCompass} style={{ fontSize: '11px', '--padding-start': '8px', '--padding-end': '8px' } as any}>
              {compassEnabled ? '✓ Compass' : 'Compass'}
            </IonButton>
          </div>

          <div style={{ marginTop: 8 }}>
            <IonButton
              expand="block"
              onClick={onStartSession}
              disabled={!isSupported}
              style={{ fontSize: '12px', height: '36px' }}
            >
              Start AR
            </IonButton>
          </div>
        </>
      )}

      {isSessionActive && (
        <div style={{ marginTop: 8 }}>
          <IonButton
            expand="block"
            onClick={onStopSession}
            style={{ fontSize: '12px', height: '36px' }}
          >
            Stop AR
          </IonButton>
        </div>
      )}

      {(heading !== null || distance !== null || bearing !== null) && (
        <IonText style={{ fontSize: '11px', marginTop: 8, display: 'block' }}>
          {heading !== null && <div>H: {heading.toFixed(0)}°</div>}
          {distance !== null && <div>D: {distance.toFixed(1)}m</div>}
          {bearing !== null && <div>B: {bearing.toFixed(0)}°</div>}
        </IonText>
      )}
    </div>
  );
};
