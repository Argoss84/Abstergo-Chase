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
    IonBackButton,
    IonButtons,
    IonButton,
    IonItem,
    IonInput,
    IonLabel,
  } from '@ionic/react';
  import { useHistory } from 'react-router-dom';
  import { useState } from 'react';
  
  const JoinLobby: React.FC = () => {
    const history = useHistory();
    const [gameCode, setGameCode] = useState('');
  
    const handleJoinGame = () => {
      if (gameCode.trim()) {
        history.push(`/lobby?code=${gameCode}`);
      }
    };
  
    return (
      <IonPage id="JoinLobby-page">
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonBackButton defaultHref="/home" />
            </IonButtons>
            <IonTitle>JoinLobby</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent fullscreen>
  
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>
                JoinLobby
              </IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonItem>
                <IonLabel position="stacked">Code de la partie</IonLabel>
                <IonInput
                  value={gameCode}
                  onIonChange={e => setGameCode(e.detail.value!)}
                  placeholder="Entrez le code de la partie"
                />
              </IonItem>
              
              <IonButton 
                expand="block" 
                onClick={handleJoinGame}
                disabled={!gameCode.trim()}
                className="ion-margin-top"
              >
                Rejoindre la partie
              </IonButton>

              <div className="ion-margin-top">
                <IonButton expand="block" onClick={() => history.push('/rogue')}>
                  Rogue
                </IonButton>
                <IonButton expand="block" onClick={() => history.push('/agent')}>
                  Agent
                </IonButton>
              </div>
            </IonCardContent>
          </IonCard>
  
        </IonContent>
      </IonPage>
    );
  };
  
  export default JoinLobby;
  