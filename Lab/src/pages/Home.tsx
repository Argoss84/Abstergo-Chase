import { IonButton, IonContent, IonPage } from '@ionic/react';

const Home: React.FC = () => {
  return (
    <IonPage>
      <IonContent fullscreen>
        <div className="ion-padding">
          <div>Hello World</div>
          <IonButton routerLink="/ar" expand="block">
            AR GPS
          </IonButton>
          <IonButton routerLink="/ar-hands" expand="block">
            Détection des mains
          </IonButton>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Home;
