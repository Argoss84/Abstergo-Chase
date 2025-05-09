import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton } from '@ionic/react';
import { useHistory } from 'react-router-dom';

const NotFound: React.FC = () => {
  const history = useHistory();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Page non trouvée</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding ion-text-center">
        <div style={{ padding: '2rem' }}>
          <h1>404</h1>
          <h2>Page non trouvée</h2>
          <p>La page que vous recherchez n'existe pas ou a été déplacée.</p>
          <IonButton onClick={() => history.push('/home')}>
            Retour à l'accueil
          </IonButton>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default NotFound; 