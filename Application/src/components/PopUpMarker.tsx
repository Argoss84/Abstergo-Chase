import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { GameProp } from './Interfaces';

const logoAssets = import.meta.glob('../ressources/logo/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const getLogoUrl = (filename: string) =>
  logoAssets[`../ressources/logo/${filename}`] ||
  logoAssets['../ressources/logo/joueur_1.png'];

interface PopUpMarkerProps {
  position: [number, number];
  type: 'objective' | 'start-zone' | 'start-zone-rogue' | 'player';
  data?: GameProp;
  playerLogo?: string;
  id?: string | number;
  label?: string;
  role?: string | null;
  status?: string | null;
  isSelf?: boolean;
  /** Halo rouge autour des agents (visible uniquement pour les rogues) */
  showAgentHalo?: boolean;
}

const PopUpMarker: React.FC<PopUpMarkerProps> = ({ 
  position, 
  type, 
  data, 
  playerLogo = 'joueur_1.png',
  id,
  label,
  role,
  status,
  isSelf = false,
  showAgentHalo = false
}) => {
  // Configuration des icônes selon le type
  const getIconConfig = () => {
    switch (type) {
      case 'objective':
        return {
          html: `
            <div class="cyber-marker cyber-marker-objective">
              <span class="cyber-marker-core"></span>
              <span class="cyber-marker-glow"></span>
              <span class="cyber-marker-pulse"></span>
            </div>
          `,
          size: [26, 26],
          anchor: [13, 13],
        };
      case 'start-zone':
        return {
          html: `
            <div class="cyber-marker cyber-marker-start">
              <span class="cyber-marker-core"></span>
              <span class="cyber-marker-glow"></span>
              <span class="cyber-marker-pulse"></span>
            </div>
          `,
          size: [28, 28],
          anchor: [14, 14],
        };
      case 'start-zone-rogue':
        return {
          html: `
            <div class="cyber-marker cyber-marker-rogue">
              <span class="cyber-marker-core"></span>
              <span class="cyber-marker-glow"></span>
              <span class="cyber-marker-pulse"></span>
            </div>
          `,
          size: [28, 28],
          anchor: [14, 14],
        };
      case 'player': {
        const logoUrl = getLogoUrl(playerLogo);
        const haloClass = showAgentHalo ? ' cyber-marker-agent-halo' : '';
        return {
          html: `
            <div class="cyber-marker cyber-marker-player${haloClass}">
              <img src="${logoUrl}" class="cyber-marker-avatar" />
              <span class="cyber-marker-ring"></span>
              <span class="cyber-marker-pulse"></span>
            </div>
          `,
          size: [34, 34],
          anchor: [17, 17],
        };
      }
      default:
        return {
          html: `
            <div class="cyber-marker cyber-marker-default">
              <span class="cyber-marker-core"></span>
              <span class="cyber-marker-glow"></span>
            </div>
          `,
          size: [24, 24],
          anchor: [12, 12],
        };
    }
  };

  // Contenu du popup selon le type
  const getPopupContent = () => {
    switch (type) {
      case 'objective':
        if (!data) return null;
        return (
          <div className="objective-popup">
            <h3>🎯 Objectif #{data.id_prop}</h3>
            <p><strong>Nom:</strong> {data.name || 'Sans nom'}</p>
            <p><strong>Description:</strong> {data.description || 'Aucune description'}</p>
            <p><strong>Rayon de détection:</strong> {data.detection_radius || 0}m</p>
            <p><strong>Coordonnées:</strong></p>
            <p>Lat: {parseFloat(data.latitude || '0').toFixed(6)}</p>
            <p>Lng: {parseFloat(data.longitude || '0').toFixed(6)}</p>
          </div>
        );
      
      case 'start-zone':
        return (
          <div className="start-zone-popup">
            <h3>🏁 Zone de Départ Agent</h3>
            <p><strong>Type:</strong> Zone de départ pour les Agents</p>
            <p><strong>Coordonnées:</strong></p>
            <p>Lat: {position[0].toFixed(6)}</p>
            <p>Lng: {position[1].toFixed(6)}</p>
            <p><strong>Rayon:</strong> 50m</p>
          </div>
        );
      
      case 'start-zone-rogue':
        return (
          <div className="start-zone-rogue-popup">
            <h3>🏁 Zone de Départ Rogue</h3>
            <p><strong>Type:</strong> Zone de départ pour les Rogues</p>
            <p><strong>Coordonnées:</strong></p>
            <p>Lat: {position[0].toFixed(6)}</p>
            <p>Lng: {position[1].toFixed(6)}</p>
            <p><strong>Rayon:</strong> 50m</p>
          </div>
        );
      
      case 'player':
        return (
          <div className="player-popup">
            <h3>👤 {isSelf ? 'Votre position' : (label || 'Joueur')}</h3>
            <p><strong>Type:</strong> {isSelf ? 'Position actuelle du joueur' : 'Position du joueur'}</p>
            {!isSelf && role && <p><strong>Rôle:</strong> {role}</p>}
            {status && <p><strong>Statut:</strong> {status}</p>}
            <p><strong>Coordonnées:</strong></p>
            <p>Lat: {position[0].toFixed(6)}</p>
            <p>Lng: {position[1].toFixed(6)}</p>
            <p><strong>Logo:</strong> {playerLogo}</p>
          </div>
        );
      
      default:
        return (
          <div className="default-popup">
            <h3>📍 Marqueur</h3>
            <p><strong>Coordonnées:</strong></p>
            <p>Lat: {position[0].toFixed(6)}</p>
            <p>Lng: {position[1].toFixed(6)}</p>
          </div>
        );
    }
  };

  const iconConfig = getIconConfig();
  const popupContent = getPopupContent();

  return (
    <Marker
      key={id || `${type}-${position[0]}-${position[1]}`}
      position={position}
      icon={L.divIcon({
        className: 'custom-div-icon',
        html: iconConfig.html,
        iconSize: iconConfig.size as [number, number],
        iconAnchor: iconConfig.anchor as [number, number],
      })}
    >
      {popupContent && (
        <Popup className={`cyber-popup cyber-popup-${type}`}>
          {popupContent}
        </Popup>
      )}
    </Marker>
  );
};

const arePlayerMarkersEqual = (
  prev: PopUpMarkerProps,
  next: PopUpMarkerProps,
) => {
  if (prev.type !== 'player' || next.type !== 'player') {
    return false;
  }

  return (
    prev.position[0] === next.position[0] &&
    prev.position[1] === next.position[1] &&
    prev.playerLogo === next.playerLogo &&
    prev.id === next.id &&
    prev.label === next.label &&
    prev.role === next.role &&
    prev.status === next.status &&
    prev.isSelf === next.isSelf &&
    prev.showAgentHalo === next.showAgentHalo
  );
};

export default React.memo(PopUpMarker, arePlayerMarkersEqual); 