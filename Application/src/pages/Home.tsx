import {
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonList,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonText,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { authService } from '../services/AuthService';

const Home: React.FC = () => {
  const history = useHistory();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    // Vérifier si l'utilisateur est déjà authentifié
    setIsAuthenticated(authService.isAuthenticated());
  }, []);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsVerifying(true);

    try {
      const isValid = await authService.verifyPassword(password);
      
      if (isValid) {
        setIsAuthenticated(true);
        setPassword('');
      } else {
        setError('Mot de passe incorrect');
      }
    } catch (err) {
      setError('Erreur lors de la vérification du mot de passe');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLogout = () => {
    authService.logout();
    setIsAuthenticated(false);
    setPassword('');
    setError('');
  };

  const navigateTo = (path: string) => {
    history.push(path);
  };

  return (
    <IonPage id="home-page">
      <IonHeader>
        <IonToolbar>
          <IonTitle>Home</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        {!isAuthenticated ? (
          <IonCard style={{ margin: '1rem' }}>
            <IonCardHeader>
              <IonCardTitle>🔒 Authentification requise</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <form onSubmit={handlePasswordSubmit}>
                <IonText color="medium">
                  <p style={{ marginBottom: '1rem' }}>
                    Veuillez entrer le mot de passe pour accéder à l'application.
                  </p>
                </IonText>
                
                <IonInput
                  type="password"
                  placeholder="Mot de passe"
                  value={password}
                  onIonChange={(e) => setPassword(e.detail.value || '')}
                  disabled={isVerifying}
                  style={{
                    border: '1px solid var(--ion-color-medium)',
                    borderRadius: '8px',
                    padding: '8px',
                    marginBottom: '1rem'
                  }}
                />
                
                {error && (
                  <IonText color="danger">
                    <p style={{ marginBottom: '1rem', fontSize: '0.9em' }}>
                      ❌ {error}
                    </p>
                  </IonText>
                )}
                
                <IonButton
                  expand="block"
                  type="submit"
                  disabled={!password || isVerifying}
                  style={{ marginTop: '0.5rem' }}
                >
                  {isVerifying ? 'Vérification...' : '🔓 Se connecter'}
                </IonButton>
              </form>
            </IonCardContent>
          </IonCard>
        ) : (
          <IonCard>
            <IonCardHeader>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <IonCardTitle>
                  Home
                </IonCardTitle>
                <IonButton 
                  size="small" 
                  color="medium" 
                  onClick={handleLogout}
                  style={{ fontSize: '0.8em' }}
                >
                  🔒 Déconnexion
                </IonButton>
              </div>
            </IonCardHeader>
            <IonCardContent>
              <IonList>
                <IonItem button onClick={() => navigateTo('/create-lobby')}>
                  <IonLabel>Créer une partie</IonLabel>
                </IonItem>
                <IonItem button onClick={() => navigateTo('/join-lobby')}>
                  <IonLabel>Rejoindre une partie</IonLabel>
                </IonItem>
                <IonItem button onClick={() => navigateTo('/session-diagnostics')} lines="none">
                  <IonLabel color="medium">
                    <p style={{ fontSize: '0.9em' }}>🔧 Diagnostic de session</p>
                  </IonLabel>
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Home;
