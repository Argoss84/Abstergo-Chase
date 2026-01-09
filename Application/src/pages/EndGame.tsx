import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonCard, IonCardHeader, IonCardTitle } from '@ionic/react';

const EndGame: React.FC = () => {

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>EndGame</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent >
        <IonCard>
            <IonCardHeader>
                <IonCardTitle>
                    EndGame
                </IonCardTitle>
            </IonCardHeader>
        </IonCard>
      </IonContent>
    </IonPage>
  );
};

export default EndGame; 