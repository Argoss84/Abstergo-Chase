import React, { useState, useEffect } from 'react';
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
  message = "INITIALISATION DU SYSTÈME...", 
  progress,
  showSpinner = true 
}) => {
  const [terminalText, setTerminalText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  
  const hackerMessages = [
    "> CONNEXION AU SERVEUR...",
    "> CRYPTAGE DES DONNÉES...",
    "> BYPASS DES FIREWALLS...",
    "> INJECTION DU CODE...",
    "> ACCÈS AUTORISÉ...",
    "> SYSTÈME COMPROMIS...",
    "> TÉLÉCHARGEMENT EN COURS..."
  ];

  useEffect(() => {
    if (!message || message === "INITIALISATION DU SYSTÈME...") {
      const interval = setInterval(() => {
        if (currentIndex < hackerMessages.length) {
          setTerminalText(hackerMessages[currentIndex]);
          setCurrentIndex(prev => prev + 1);
        } else {
          setCurrentIndex(0);
          setTerminalText(hackerMessages[0]);
        }
      }, 1500);

      return () => clearInterval(interval);
    } else {
      setTerminalText(message);
    }
  }, [currentIndex, message]);

  return (
    <div className="loading-container">
      <IonCard className="loading-card">
        <IonCardContent className="loading-content">
          {/* Terminal Header */}
          <div className="terminal-header">
            <div className="terminal-title">
              <span className="terminal-prompt">root@abstergo:~$</span>
            </div>
            <div className="terminal-controls">
              <span className="control-btn">_</span>
              <span className="control-btn">□</span>
              <span className="control-btn">×</span>
            </div>
          </div>
          
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
          
          {/* Message de chargement style terminal */}
          <IonText className="loading-message">
            <h3>{terminalText}</h3>
            <div className="terminal-cursor">█</div>
          </IonText>
          
          {/* Barre de progression style hacker */}
          {progress !== undefined && (
            <div className="loading-progress">
              <div className="progress-label">
                <span className="progress-prompt">[PROGRESS]</span>
              </div>
              <IonProgressBar 
                value={progress / 100} 
                className="loading-progress-bar"
              />
              <IonText className="progress-text">
                <p>STATUS: {Math.round(progress)}% COMPLETE</p>
              </IonText>
            </div>
          )}
          
          {/* Footer terminal */}
          <div className="terminal-footer">
            <span className="terminal-info">SYSTEM: ACTIVE | USER: ROOT | TIME: {new Date().toLocaleTimeString()}</span>
          </div>
        </IonCardContent>
      </IonCard>
    </div>
  );
};

export default Loading;
