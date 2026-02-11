import { 
  IonContent, 
  IonHeader, 
  IonPage, 
  IonTitle, 
  IonToolbar, 
  IonButton, 
  IonCard, 
  IonCardHeader, 
  IonCardTitle, 
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
  IonBadge
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { useGameSession } from '../contexts/GameSessionContext';
import { trophyOutline, personOutline, skullOutline, timeOutline, flagOutline } from 'ionicons/icons';
import './EndGame.css';

const EndGame: React.FC = () => {
  const history = useHistory();
  const { gameDetails, players } = useGameSession();

  // Déterminer les vainqueurs
  const winnerType = gameDetails?.winner_type?.toUpperCase();
  const agents = players.filter(p => p.role?.toUpperCase() === 'AGENT');
  const rogues = players.filter(p => p.role?.toUpperCase() === 'ROGUE');

  // Déterminer les statistiques
  const totalObjectives = gameDetails?.props?.length || 0;
  const capturedObjectives = gameDetails?.props?.filter(p => p.state === 'CAPTURED').length || 0;
  const capturedAgents = agents.filter(p => p.status === 'CAPTURED').length || 0;
  const gameDuration = gameDetails?.duration || 0;
  const remainingTime = gameDetails?.remaining_time || 0;
  const elapsedTime = gameDuration - remainingTime;

  // Formatter le temps
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Déterminer le message de victoire
  const getVictoryMessage = () => {
    if (winnerType === 'AGENT') {
      return {
        title: '🎯 VICTOIRE DES AGENTS',
        message: 'Les Agents ont réussi à protéger les objectifs !',
        color: 'primary'
      };
    } else if (winnerType === 'ROGUE') {
      return {
        title: '⚡ VICTOIRE DES ROGUES',
        message: 'Les Rogues ont capturé tous les objectifs !',
        color: 'success'
      };
    } else {
      return {
        title: '🏁 PARTIE TERMINÉE',
        message: 'La partie est terminée',
        color: 'medium'
      };
    }
  };

  const victory = getVictoryMessage();

  const handleReturnHome = () => {
    history.push('/');
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color={victory.color}>
          <IonTitle>Fin de Partie</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {/* Carte de victoire */}
        <IonCard className="victory-card" color={victory.color}>
          <IonCardHeader>
            <IonCardTitle className="victory-title">
              {victory.title}
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <p className="victory-message">{victory.message}</p>
          </IonCardContent>
        </IonCard>

        {/* Statistiques de la partie */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              <IonIcon icon={trophyOutline} /> Statistiques de la Partie
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonList>
              <IonItem>
                <IonIcon icon={timeOutline} slot="start" />
                <IonLabel>
                  <h3>Durée de la partie</h3>
                  <p>{formatTime(elapsedTime)}</p>
                </IonLabel>
              </IonItem>
              <IonItem>
                <IonIcon icon={flagOutline} slot="start" />
                <IonLabel>
                  <h3>Objectifs capturés</h3>
                  <p>{capturedObjectives} / {totalObjectives}</p>
                </IonLabel>
              </IonItem>
              <IonItem>
                <IonIcon icon={skullOutline} slot="start" />
                <IonLabel>
                  <h3>Agents capturés</h3>
                  <p>{capturedAgents} / {agents.length}</p>
                </IonLabel>
              </IonItem>
            </IonList>
          </IonCardContent>
        </IonCard>

        {/* Liste des joueurs Agents */}
        {agents.length > 0 && (
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>
                <IonIcon icon={personOutline} /> Équipe Agent
                {winnerType === 'AGENT' && <IonBadge color="primary" style={{ marginLeft: '10px' }}>Vainqueurs</IonBadge>}
              </IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonList>
                {agents.map((agent) => (
                  <IonItem key={agent.id_player}>
                    <IonLabel>
                      <h3>{agent.displayName || agent.user_id}</h3>
                      <p>
                        {agent.status === 'CAPTURED' ? (
                          <IonBadge color="danger">Capturé</IonBadge>
                        ) : (
                          <IonBadge color="success">En vie</IonBadge>
                        )}
                      </p>
                    </IonLabel>
                  </IonItem>
                ))}
              </IonList>
            </IonCardContent>
          </IonCard>
        )}

        {/* Liste des joueurs Rogues */}
        {rogues.length > 0 && (
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>
                <IonIcon icon={skullOutline} /> Équipe Rogue
                {winnerType === 'ROGUE' && <IonBadge color="success" style={{ marginLeft: '10px' }}>Vainqueurs</IonBadge>}
              </IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonList>
                {rogues.map((rogue) => (
                  <IonItem key={rogue.id_player}>
                    <IonLabel>
                      <h3>{rogue.displayName || rogue.user_id}</h3>
                      <p>
                        {rogue.status === 'CAPTURED' ? (
                          <IonBadge color="danger">Capturé</IonBadge>
                        ) : (
                          <IonBadge color="success">En liberté</IonBadge>
                        )}
                      </p>
                    </IonLabel>
                  </IonItem>
                ))}
              </IonList>
            </IonCardContent>
          </IonCard>
        )}

        {/* Bouton pour retourner à l'accueil */}
        <IonButton expand="block" onClick={handleReturnHome} style={{ marginTop: '20px' }}>
          Retour à l'accueil
        </IonButton>
      </IonContent>
    </IonPage>
  );
};

export default EndGame; 