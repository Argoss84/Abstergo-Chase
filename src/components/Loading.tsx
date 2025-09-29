import React from 'react';
import {
  IonCard,
  IonCardContent,
  IonProgressBar,
  IonText,
  IonSpinner
} from '@ionic/react';
import './Loading.css';

interface LoadingProps {
  message?: string;
  progress?: number;
  showSpinner?: boolean;
}

const Loading: React.FC<LoadingProps> = ({ 
  message = "Chargement en cours...", 
  progress,
  showSpinner = true 
}) => {
  return (
    <div className="loading-container">
      <IonCard className="loading-card">
        <IonCardContent className="loading-content">
          {/* Gif ou animation de chargement */}
          <div className="loading-animation">
            {showSpinner ? (
              <IonSpinner name="crescent" className="loading-spinner" />
            ) : (
              <div className="loading-gif">
                <div className="loading-dots">
                  <div className="dot"></div>
                  <div className="dot"></div>
                  <div className="dot"></div>
                </div>
              </div>
            )}
          </div>
          
          {/* Message de chargement */}
          <IonText className="loading-message">
            <h3>{message}</h3>
          </IonText>
          
          {/* Barre de progression */}
          {progress !== undefined && (
            <div className="loading-progress">
              <IonProgressBar 
                value={progress / 100} 
                className="loading-progress-bar"
              />
              <IonText className="progress-text">
                <p>{Math.round(progress)}%</p>
              </IonText>
            </div>
          )}
        </IonCardContent>
      </IonCard>
    </div>
  );
};

export default Loading;
