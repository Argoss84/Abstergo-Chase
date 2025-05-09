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
  
  const CreateLobby: React.FC = () => {
  
    return (
      <IonPage id="CreateLobby-page">
        <IonHeader>
          <IonToolbar>
            <IonTitle> CreateLobby </IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent fullscreen>
  
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>
                CreateLobby
              </IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              This is the CreateLobby page
            </IonCardContent>
          </IonCard>
  
        </IonContent>
      </IonPage>
    );
  };
  
  export default CreateLobby;
  