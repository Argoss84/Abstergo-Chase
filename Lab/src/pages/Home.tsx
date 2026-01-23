import { IonContent, IonPage } from '@ionic/react';

const Home: React.FC = () => {
  return (
    <IonPage>
      <IonContent fullscreen>
        <div className="ion-padding">Hello World</div>
      </IonContent>
    </IonPage>
  );
};

export default Home;
