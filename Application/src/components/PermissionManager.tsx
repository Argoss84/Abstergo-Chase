import React, { useEffect, useState } from 'react';
import { 
  IonModal, 
  IonHeader, 
  IonToolbar, 
  IonTitle, 
  IonContent, 
  IonButton, 
  IonList, 
  IonItem, 
  IonLabel, 
  IonIcon,
  IonButtons,
  IonFooter
} from '@ionic/react';
import { checkmark, close, warningOutline } from 'ionicons/icons';
import { useLocation } from 'react-router-dom';

interface Permission {
  name: string;
  displayName: string;
  apiName: PermissionName;
  status: PermissionState | 'unavailable';
  required: boolean;
  requestFunction: () => Promise<PermissionState>;
}

const PermissionManager: React.FC = () => {
  const [showAlert, setShowAlert] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [hasChecked, setHasChecked] = useState(false);
  const location = useLocation();

  // Liste des autorisations nécessaires
  const checkPermissions = async (): Promise<Permission[]> => {
    const perms: Permission[] = [];

    // Vérifier la géolocalisation
    if ('geolocation' in navigator) {
      let geoStatus: PermissionState | 'unavailable' = 'unavailable';
      try {
        if ('permissions' in navigator) {
          const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
          geoStatus = result.state;
        } else {
          // Si l'API Permissions n'est pas disponible, on considère comme "prompt"
          geoStatus = 'prompt';
        }
      } catch (error) {
        console.log('Permissions API non disponible pour géolocalisation');
        geoStatus = 'prompt';
      }

      perms.push({
        name: 'geolocation',
        displayName: 'Géolocalisation (GPS)',
        apiName: 'geolocation' as PermissionName,
        status: geoStatus,
        required: true,
        requestFunction: async () => {
          return new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
              () => resolve('granted'),
              () => resolve('denied'),
              { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
          });
        }
      });
    } else {
      // Géolocalisation non disponible sur cet appareil
      perms.push({
        name: 'geolocation',
        displayName: 'Géolocalisation (GPS)',
        apiName: 'geolocation' as PermissionName,
        status: 'unavailable',
        required: true,
        requestFunction: async () => 'denied'
      });
    }

    // Vérifier la caméra
    if ('mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices) {
      let cameraStatus: PermissionState | 'unavailable' = 'prompt';
      let hasCameras = false;
      
      try {
        // Vérifier si des caméras sont disponibles
        const devices = await navigator.mediaDevices.enumerateDevices();
        hasCameras = devices.some(device => device.kind === 'videoinput');
        
        if (!hasCameras) {
          cameraStatus = 'unavailable';
        } else if ('permissions' in navigator) {
          const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
          cameraStatus = result.state;
        }
      } catch (error) {
        console.log('Erreur lors de la vérification de la caméra:', error);
        cameraStatus = 'prompt';
      }

      perms.push({
        name: 'camera',
        displayName: 'Caméra',
        apiName: 'camera' as PermissionName,
        status: cameraStatus,
        required: true,
        requestFunction: async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
              video: { facingMode: 'environment' }, 
              audio: false 
            });
            // Arrêter le stream immédiatement
            stream.getTracks().forEach(track => track.stop());
            return 'granted';
          } catch (error) {
            return 'denied';
          }
        }
      });
    } else {
      // API caméra non disponible
      perms.push({
        name: 'camera',
        displayName: 'Caméra',
        apiName: 'camera' as PermissionName,
        status: 'unavailable',
        required: true,
        requestFunction: async () => 'denied'
      });
    }

    // Vérifier la boussole (DeviceOrientation)
    if ('DeviceOrientationEvent' in window) {
      let orientationStatus: PermissionState | 'unavailable' = 'prompt';
      
      try {
        // Sur iOS 13+, il faut demander la permission explicitement
        if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
          // Permission disponible, vérifier le statut
          orientationStatus = 'prompt';
        } else {
          // Sur les autres appareils, considérer comme déjà accordé si l'API existe
          orientationStatus = 'granted';
        }
      } catch (error) {
        console.log('Erreur lors de la vérification de l\'orientation:', error);
        orientationStatus = 'prompt';
      }

      perms.push({
        name: 'deviceorientation',
        displayName: 'Boussole (Orientation)',
        apiName: 'gyroscope' as PermissionName,
        status: orientationStatus,
        required: false,
        requestFunction: async () => {
          try {
            if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
              const response = await (DeviceOrientationEvent as any).requestPermission();
              return response === 'granted' ? 'granted' : 'denied';
            }
            return 'granted';
          } catch (error) {
            console.error('Erreur lors de la demande de permission d\'orientation:', error);
            return 'denied';
          }
        }
      });
    } else {
      // API d'orientation non disponible
      perms.push({
        name: 'deviceorientation',
        displayName: 'Boussole (Orientation)',
        apiName: 'gyroscope' as PermissionName,
        status: 'unavailable',
        required: false,
        requestFunction: async () => 'denied'
      });
    }

    return perms;
  };

  // Vérifier les autorisations au montage et à chaque changement de route
  useEffect(() => {
    const checkAndShowAlert = async () => {
      // Ne pas vérifier sur la page d'accueil
      if (location.pathname === '/home' || location.pathname === '/') {
        return;
      }

      const perms = await checkPermissions();
      setPermissions(perms);

      // Afficher l'alerte si des permissions requises et disponibles sont manquantes
      const missingPermissions = perms.filter(
        p => p.required && 
            p.status !== 'unavailable' && 
            (p.status === 'prompt' || p.status === 'denied')
      );

      if (missingPermissions.length > 0 && !hasChecked) {
        setShowAlert(true);
        setHasChecked(true);
      }
    };

    checkAndShowAlert();
  }, [location.pathname]);

  // Demander toutes les autorisations manquantes
  const requestAllPermissions = async () => {
    const updatedPermissions = [...permissions];

    for (let i = 0; i < updatedPermissions.length; i++) {
      const perm = updatedPermissions[i];
      // Ne demander que les permissions qui ne sont pas "unavailable"
      if (perm.status !== 'unavailable' && (perm.status === 'prompt' || perm.status === 'denied')) {
        try {
          const newStatus = await perm.requestFunction();
          updatedPermissions[i].status = newStatus;
        } catch (error) {
          console.error(`Erreur lors de la demande d'autorisation ${perm.name}:`, error);
          updatedPermissions[i].status = 'denied';
        }
      }
    }

    setPermissions(updatedPermissions);

    // Vérifier si toutes les permissions requises et disponibles sont accordées
    const allGranted = updatedPermissions
      .filter(p => p.required && p.status !== 'unavailable')
      .every(p => p.status === 'granted');

    if (allGranted) {
      setShowAlert(false);
    }
  };

  // Obtenir le message de statut pour une permission
  const getStatusIcon = (status: PermissionState | 'unavailable') => {
    switch (status) {
      case 'granted':
        return <IonIcon icon={checkmark} color="success" />;
      case 'denied':
        return <IonIcon icon={close} color="danger" />;
      case 'prompt':
      case 'unavailable':
        return <IonIcon icon={warningOutline} color="warning" />;
      default:
        return <IonIcon icon={warningOutline} color="medium" />;
    }
  };

  const getStatusText = (status: PermissionState | 'unavailable') => {
    switch (status) {
      case 'granted':
        return 'Accordée';
      case 'denied':
        return 'Refusée';
      case 'prompt':
        return 'Non demandée';
      case 'unavailable':
        return 'Non disponible';
      default:
        return 'Inconnu';
    }
  };

  return (
    <IonModal
      isOpen={showAlert}
      onDidDismiss={() => setShowAlert(false)}
      cssClass="permission-modal"
      backdropDismiss={false}
    >
      <IonHeader>
        <IonToolbar>
          <IonTitle>Autorisations requises</IonTitle>
        </IonToolbar>
      </IonHeader>
      
      <IonContent className="ion-padding">
        <p style={{ marginBottom: '15px', color: 'var(--ion-color-medium)' }}>
          Cette application nécessite les autorisations suivantes pour fonctionner correctement :
        </p>

        <IonList>
          {permissions.map((perm) => (
            <IonItem 
              key={perm.name} 
              lines="none"
              style={{ 
                opacity: perm.status === 'unavailable' ? 0.6 : 1,
                background: perm.status === 'unavailable' ? 'var(--ion-color-light)' : 'transparent'
              }}
            >
              {getStatusIcon(perm.status)}
              <IonLabel style={{ marginLeft: '10px' }}>
                <h3>
                  {perm.displayName}
                  {perm.required && <span style={{ color: 'var(--ion-color-danger)', marginLeft: '5px' }}>*</span>}
                </h3>
                <p style={{ fontSize: '0.85em', color: 'var(--ion-color-medium)' }}>
                  Statut : <strong>{getStatusText(perm.status)}</strong>
                  {perm.status === 'unavailable' && (
                    <span style={{ display: 'block', fontSize: '0.9em', marginTop: '4px', color: 'var(--ion-color-warning)' }}>
                      ⚠️ Cette fonctionnalité n'est pas disponible sur votre appareil
                    </span>
                  )}
                </p>
              </IonLabel>
            </IonItem>
          ))}
        </IonList>

        {/* Légende */}
        <div style={{ 
          marginTop: '15px', 
          padding: '10px', 
          background: 'var(--ion-color-light)',
          borderRadius: '8px',
          fontSize: '0.8em'
        }}>
          <p style={{ margin: '0 0 5px 0', color: 'var(--ion-color-medium)' }}>
            <span style={{ color: 'var(--ion-color-danger)' }}>*</span> = Autorisation obligatoire pour le jeu
          </p>
        </div>

        <div style={{ marginTop: '20px' }}>
          <p style={{ fontSize: '0.9em', color: 'var(--ion-color-medium)', fontWeight: 'bold' }}>
            Pourquoi ces autorisations ?
          </p>
          <ul style={{ fontSize: '0.85em', color: 'var(--ion-color-medium)', paddingLeft: '20px', marginTop: '10px' }}>
            <li style={{ marginBottom: '8px' }}>
              <strong>Géolocalisation :</strong> Pour suivre votre position dans le jeu
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong>Caméra :</strong> Pour scanner les QR codes et prendre des photos
            </li>
            <li>
              <strong>Boussole :</strong> Pour afficher votre orientation et vous guider vers les objectifs
            </li>
          </ul>
        </div>
      </IonContent>

      <IonFooter>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => setShowAlert(false)} color="medium">
              Plus tard
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton 
              onClick={async () => {
                await requestAllPermissions();
              }} 
              color="primary"
              strong
            >
              Accorder les autorisations
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonFooter>
    </IonModal>
  );
};

export default PermissionManager;
