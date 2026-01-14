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
} from '@ionic/react';
import { useHistory } from 'react-router-dom';

const Home: React.FC = () => {
  const history = useHistory();

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
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              Home
            </IonCardTitle>
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
      </IonContent>
    </IonPage>
  );
};

export default Home;
