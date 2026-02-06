import { useState } from 'react';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButton,
  IonCard,
  IonCardContent,
} from '@ionic/react';

// URL de ServerBDD (sous-domaine en prod, localhost en dev)
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5175';

type TestStatus = 'idle' | 'loading' | 'success' | 'error';

const DbTest: React.FC = () => {
  const [status, setStatus] = useState<TestStatus>('idle');
  const [message, setMessage] = useState<string>('');

  const handleTest = async () => {
    setStatus('loading');
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/api/db/test`);
      const data = await res.json();
      if (data.success) {
        setStatus('success');
        setMessage(data.message || 'Connexion réussie');
      } else {
        setStatus('error');
        setMessage(data.error || 'Erreur inconnue');
      }
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Erreur réseau');
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/" />
          </IonButtons>
          <IonTitle>Test connexion MySQL</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <div className="ion-padding">
          <IonCard>
            <IonCardContent>
              <p>Testez la connexion à la base de données MySQL/MariaDB hébergée sur O2Switch.</p>
              <IonButton
                expand="block"
                onClick={handleTest}
                disabled={status === 'loading'}
              >
                {status === 'loading' ? 'Test en cours...' : 'Tester la connexion'}
              </IonButton>
            </IonCardContent>
          </IonCard>

          {status === 'success' && (
            <IonCard color="success">
              <IonCardContent>
                <strong>Succès</strong>
                <p>{message}</p>
              </IonCardContent>
            </IonCard>
          )}

          {status === 'error' && (
            <IonCard color="danger">
              <IonCardContent>
                <strong>Erreur</strong>
                <p>{message}</p>
              </IonCardContent>
            </IonCard>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default DbTest;
