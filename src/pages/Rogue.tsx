import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonCard, IonCardHeader, IonCardTitle } from '@ionic/react';
import { useHistory } from 'react-router-dom';

const Rogue: React.FC = () => {
const history = useHistory();
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Rogue</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent >
        <IonCard>
            <IonCardHeader>
                <IonCardTitle>
                    Rogue
                </IonCardTitle>
            </IonCardHeader>
        </IonCard>
        <IonButton expand="block" onClick={() => history.push('/end-game')}>
            EndGame
        </IonButton>
      </IonContent>
    </IonPage>
  );
};

export default Rogue; 