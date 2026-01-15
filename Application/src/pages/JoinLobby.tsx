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
  import { useHistory, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { handleError, ERROR_CONTEXTS } from '../utils/ErrorUtils';
import { useGameSession } from '../contexts/GameSessionContext';
import { authService } from '../services/AuthService';
  
  const JoinLobby: React.FC = () => {
    const history = useHistory();
    const location = useLocation();
    const { playerName, setPlayerName, lobbyCode, clearSession } = useGameSession();
    const [gameCode, setGameCode] = useState('');
    const [displayName, setDisplayName] = useState(playerName);

    // Vérifier l'authentification
    useEffect(() => {
      if (!authService.isAuthenticated()) {
        history.replace('/home');
      }
    }, [history]);

    // Pré-remplir le code depuis l'URL si présent
    useEffect(() => {
      const params = new URLSearchParams(location.search);
      const codeFromUrl = params.get('code');
      if (codeFromUrl) {
        setGameCode(codeFromUrl.toUpperCase());
      }
    }, [location.search]);

    useEffect(() => {
      console.log('JoinLobby: playerName from context:', playerName);
      setDisplayName(playerName);
    }, [playerName]);

    const handleInputChange = (e: CustomEvent) => {
      const value = e.detail.value || '';
      setGameCode(value.toUpperCase());
    };

    const handleNameChange = (e: CustomEvent) => {
      const value = e.detail.value || '';
      setDisplayName(value);
    };
  
      const handleJoinGame = async () => {
    const normalizedCode = gameCode.trim().toUpperCase();

    if (!normalizedCode) {
      await handleError('Veuillez entrer un code de partie', null, {
        context: ERROR_CONTEXTS.VALIDATION,
        shouldShowError: false
      });
      return;
    }
    
    if (normalizedCode.length !== 6) {
      await handleError('Le code de partie doit contenir exactement 6 caractères', null, {
        context: ERROR_CONTEXTS.VALIDATION,
        shouldShowError: false
      });
      return;
    }

    if (!displayName.trim()) {
      await handleError('Veuillez entrer un nom de joueur', null, {
        context: ERROR_CONTEXTS.VALIDATION,
        shouldShowError: false
      });
      return;
    }
    
    // Mettre à jour le nom du joueur avant de rejoindre
    if (displayName.trim() !== playerName) {
      setPlayerName(displayName.trim());
    }
    
    if (lobbyCode && lobbyCode.toUpperCase() !== normalizedCode) {
      clearSession();
    }

    history.push(`/lobby?code=${normalizedCode}`);
  };
  
    return (
      <IonPage id="JoinLobby-page">
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonBackButton defaultHref="/home" />
            </IonButtons>
            <IonTitle>Rejoindre une partie</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent fullscreen>
  
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>
                Rejoindre une partie
              </IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonItem>
                <IonLabel position="stacked">Votre nom</IonLabel>
                <IonInput
                  value={displayName}
                  onIonInput={handleNameChange}
                  placeholder="Entrez votre nom"
                  maxlength={20}
                />
              </IonItem>

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
                disabled={gameCode.length !== 6 || !displayName.trim()}
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
  