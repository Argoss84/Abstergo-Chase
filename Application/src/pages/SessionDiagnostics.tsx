import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonTitle,
  IonToolbar,
  IonText,
  IonBadge,
  IonIcon,
  IonButtons,
} from '@ionic/react';
import { checkmarkCircle, closeCircle, warningOutline, trashOutline, refreshOutline } from 'ionicons/icons';
import { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { useGameSession } from '../contexts/GameSessionContext';

interface StorageInfo {
  key: string;
  value: string;
  size: number;
  isValid: boolean;
  error?: string;
}

const SessionDiagnostics: React.FC = () => {
  const history = useHistory();
  const { 
    lobbyCode, 
    playerId, 
    playerName, 
    isHost, 
    connectionStatus,
    clearSession,
    leaveLobby,
    hasPersistedSession
  } = useGameSession();
  
  const [storageData, setStorageData] = useState<StorageInfo[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    loadStorageData();
  }, [refreshKey]);

  const loadStorageData = () => {
    const data: StorageInfo[] = [];
    
    // Vérifier toutes les clés du localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key) || '';
        let isValid = true;
        let error: string | undefined;
        
        // Vérifier si c'est du JSON valide
        if (key.startsWith('abstergo-')) {
          try {
            JSON.parse(value);
          } catch (e) {
            isValid = false;
            error = 'JSON invalide';
          }
          
          // Vérifier l'expiration pour la session
          if (key === 'abstergo-game-session') {
            try {
              const parsed = JSON.parse(value);
              const age = Date.now() - parsed.timestamp;
              const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;
              
              if (age > SESSION_EXPIRY_MS) {
                isValid = false;
                error = 'Session expirée';
              }
            } catch (e) {
              // Already marked as invalid
            }
          }
        }
        
        data.push({
          key,
          value: value.substring(0, 200), // Tronquer pour l'affichage
          size: new Blob([value]).size,
          isValid,
          error
        });
      }
    }
    
    setStorageData(data.filter(item => item.key.startsWith('abstergo-')));
  };

  const clearSpecificKey = (key: string) => {
    localStorage.removeItem(key);
    loadStorageData();
  };

  const clearAllAbstergoData = () => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('abstergo-')) {
        keys.push(key);
      }
    }
    
    keys.forEach(key => localStorage.removeItem(key));
    clearSession();
    loadStorageData();
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatValue = (value: string) => {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Diagnostic de Session</IonTitle>
          <IonButtons slot="start">
            <IonButton onClick={() => history.goBack()}>Retour</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {/* État actuel de la session */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              État de la session en mémoire
              <IonBadge 
                color={connectionStatus === 'connected' ? 'success' : connectionStatus === 'error' ? 'danger' : 'warning'}
                style={{ marginLeft: '10px' }}
              >
                {connectionStatus}
              </IonBadge>
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonList>
              <IonItem>
                <IonLabel>
                  <h3>Code du lobby</h3>
                  <p>{lobbyCode || 'Aucun'}</p>
                </IonLabel>
              </IonItem>
              <IonItem>
                <IonLabel>
                  <h3>ID du joueur</h3>
                  <p style={{ fontSize: '12px', wordBreak: 'break-all' }}>
                    {playerId || 'Aucun'}
                  </p>
                </IonLabel>
              </IonItem>
              <IonItem>
                <IonLabel>
                  <h3>Nom du joueur</h3>
                  <p>{playerName}</p>
                </IonLabel>
              </IonItem>
              <IonItem>
                <IonLabel>
                  <h3>Est l'hôte</h3>
                  <p>{isHost ? 'Oui 👑' : 'Non'}</p>
                </IonLabel>
              </IonItem>
              <IonItem>
                <IonLabel>
                  <h3>Session persistée</h3>
                  <p>{hasPersistedSession() ? 'Oui ✓' : 'Non'}</p>
                </IonLabel>
              </IonItem>
            </IonList>
          </IonCardContent>
        </IonCard>

        {/* Données du localStorage */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              Données stockées (localStorage)
              <IonButton 
                size="small" 
                fill="clear" 
                onClick={() => setRefreshKey(k => k + 1)}
                style={{ float: 'right' }}
              >
                <IonIcon icon={refreshOutline} />
              </IonButton>
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {storageData.length === 0 ? (
              <IonText color="medium">
                <p>Aucune donnée Abstergo stockée</p>
              </IonText>
            ) : (
              <IonList>
                {storageData.map((item, index) => (
                  <IonItem key={index}>
                    <IonIcon
                      icon={item.isValid ? checkmarkCircle : item.error === 'Session expirée' ? warningOutline : closeCircle}
                      color={item.isValid ? 'success' : item.error === 'Session expirée' ? 'warning' : 'danger'}
                      slot="start"
                    />
                    <IonLabel>
                      <h3>
                        {item.key}
                        {!item.isValid && (
                          <IonBadge color="danger" style={{ marginLeft: '8px' }}>
                            {item.error}
                          </IonBadge>
                        )}
                      </h3>
                      <p style={{ fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {item.value.length > 100 ? item.value.substring(0, 100) + '...' : item.value}
                      </p>
                      <p style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                        Taille: {formatBytes(item.size)}
                      </p>
                    </IonLabel>
                    <IonButton
                      slot="end"
                      fill="clear"
                      color="danger"
                      onClick={() => clearSpecificKey(item.key)}
                    >
                      <IonIcon icon={trashOutline} />
                    </IonButton>
                  </IonItem>
                ))}
              </IonList>
            )}
          </IonCardContent>
        </IonCard>

        {/* Actions */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Actions de nettoyage</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonButton
              expand="block"
              color="warning"
              onClick={() => {
                leaveLobby();
                setRefreshKey(k => k + 1);
              }}
              disabled={!lobbyCode}
            >
              🚪 Quitter le lobby (garder le nom)
            </IonButton>
            
            <IonButton
              expand="block"
              color="danger"
              onClick={() => {
                clearAllAbstergoData();
                setRefreshKey(k => k + 1);
              }}
              style={{ marginTop: '10px' }}
            >
              <IonIcon icon={trashOutline} slot="start" />
              Tout nettoyer (supprimer toutes les données)
            </IonButton>

            <IonText color="medium" style={{ display: 'block', marginTop: '10px', fontSize: '12px' }}>
              <p>
                <strong>⚠️ Astuce :</strong> Si vous avez des problèmes pour créer ou rejoindre des parties, 
                essayez d'abord "Quitter le lobby" ou utilisez le bouton "Tout nettoyer" pour repartir à zéro.
              </p>
            </IonText>
          </IonCardContent>
        </IonCard>

        {/* Informations supplémentaires */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>ℹ️ Informations</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonText>
              <p style={{ fontSize: '13px', lineHeight: '1.6' }}>
                <strong>Données persistées :</strong><br />
                • <code>abstergo-game-session</code> : Informations de session (expire après 24h)<br />
                • <code>abstergo-player-name</code> : Votre nom de joueur<br />
                <br />
                <strong>Problèmes courants :</strong><br />
                • Sessions expirées ou corrompues<br />
                • Anciennes connexions WebRTC actives<br />
                • Conflits entre plusieurs onglets<br />
                <br />
                <strong>Solution :</strong> Utilisez les boutons de nettoyage ci-dessus pour résoudre les problèmes.
              </p>
            </IonText>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
};

export default SessionDiagnostics;
