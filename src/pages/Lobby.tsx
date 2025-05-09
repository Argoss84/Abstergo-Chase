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
  } from '@ionic/react';
  
  const Lobby: React.FC = () => {
  
    return (
      <IonPage id="Lobby-page">
        <IonHeader>
          <IonToolbar>
            <IonTitle>Lobby</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent fullscreen>
  
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>
                Lobby
              </IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              This is the Lobby page
            </IonCardContent>
          </IonCard>
  
        </IonContent>
      </IonPage>
    );
  };
  
  export default Lobby;
  