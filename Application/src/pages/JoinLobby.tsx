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
import { handleError, ERROR_CONTEXTS } from '../utils/ErrorUtils';
  
  const JoinLobby: React.FC = () => {
    const history = useHistory();
    const [gameCode, setGameCode] = useState('');

    const handleInputChange = (e: CustomEvent) => {
      const value = e.detail.value || '';
      setGameCode(value.toUpperCase());
    };
  
      const handleJoinGame = async () => {
    if (!gameCode.trim()) {
      await handleError('Veuillez entrer un code de partie', null, {
        context: ERROR_CONTEXTS.VALIDATION,
        shouldShowError: false
      });
      return;
    }
    
    if (gameCode.trim().length !== 6) {
      await handleError('Le code de partie doit contenir exactement 6 caractères', null, {
        context: ERROR_CONTEXTS.VALIDATION,
        shouldShowError: false
      });
      return;
    }
    
    history.push(`/lobby?code=${gameCode}`);
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
                  onIonInput={handleInputChange}
                  placeholder="Entrez le code de la partie"
                  maxlength={6}
                />
              </IonItem>
              
              <IonButton 
                expand="block" 
                onClick={handleJoinGame}
                disabled={gameCode.length !== 6}
                className="ion-margin-top"
              >
                Rejoindre la partie
              </IonButton>
            </IonCardContent>
          </IonCard>
  
        </IonContent>
      </IonPage>
    );
  };
  
  export default JoinLobby;
  