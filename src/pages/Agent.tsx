import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonCard, IonCardHeader, IonCardTitle } from '@ionic/react';
import { useHistory } from 'react-router-dom';

const Agent: React.FC = () => {
const history = useHistory();
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Agent</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent >
        <IonCard>
            <IonCardHeader>
                <IonCardTitle>
                    Agent
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

export default Agent; 