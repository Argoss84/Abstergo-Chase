import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { GameProp } from './Interfaces';

interface PopUpMarkerProps {
  position: [number, number];
  type: 'objective' | 'start-zone' | 'start-zone-rogue' | 'player';
  data?: GameProp;
  playerLogo?: string;
  id?: string | number;
}

const PopUpMarker: React.FC<PopUpMarkerProps> = ({ 
  position, 
  type, 
  data, 
  playerLogo = 'joueur_1.png',
  id 
}) => {
  // Configuration des icônes selon le type
  const getIconConfig = () => {
    switch (type) {
      case 'objective':
        return {
          html: `<div style="background-color: purple; width: 15px; height: 15px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
          size: [15, 15],
          anchor: [7.5, 7.5],
        };
      case 'start-zone':
        return {
          html: `<div style="background-color: blue; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white;"></div>`,
          size: [20, 20],
          anchor: [10, 10],
        };
      case 'start-zone-rogue':
        return {
          html: `<div style="background-color: green; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white;"></div>`,
          size: [20, 20],
          anchor: [10, 10],
        };
      case 'player':
        return {
          html: `<img src="/src/ressources/logo/${playerLogo}" style="width: 30px; height: 30px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);" />`,
          size: [30, 30],
          anchor: [15, 15],
        };
      default:
        return {
          html: `<div style="background-color: gray; width: 15px; height: 15px; border-radius: 50%; border: 2px solid white;"></div>`,
          size: [15, 15],
          anchor: [7.5, 7.5],
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
            <h3>👤 Votre Position</h3>
            <p><strong>Type:</strong> Position actuelle du joueur</p>
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
        <Popup>
          {popupContent}
        </Popup>
      )}
    </Marker>
  );
};

export default PopUpMarker; 