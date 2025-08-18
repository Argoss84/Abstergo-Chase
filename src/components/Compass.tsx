import React, { useState, useEffect, useRef, useMemo } from 'react';
import './Compass.css';
import { calculateDistance } from '../utils/utils';

interface CompassProps {
  targetPoints?: Array<{
    latitude: number;
    longitude: number;
    label?: string;
    color?: string;
  }>;
  currentPosition?: {
    latitude: number;
    longitude: number;
  };
  size?: 'small' | 'medium' | 'large';
  width?: number; // Largeur personnalisée en pixels
  showTargetArrows?: boolean;
  className?: string;
}

interface DeviceOrientationEvent extends Event {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}

interface DeviceOrientationData {
  alpha: number;
  beta: number;
  gamma: number;
}

const Compass: React.FC<CompassProps> = ({
  targetPoints = [],
  currentPosition,
  size = 'medium',
  width,
  showTargetArrows = true,
  className = ''
}) => {
  const [deviceOrientation, setDeviceOrientation] = useState<DeviceOrientationData | null>(null);
  const [compassHeading, setCompassHeading] = useState<number>(0);
  const requestRef = useRef<number | undefined>(undefined);

  // Calculer le bearing vers la cible
  const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const toRad = (deg: number) => deg * Math.PI / 180;
    const toDeg = (rad: number) => rad * 180 / Math.PI;
    
    const dLon = toRad(lon2 - lon1);
    const lat1Rad = toRad(lat1);
    const lat2Rad = toRad(lat2);
    
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    
    let bearing = toDeg(Math.atan2(y, x));
    bearing = (bearing + 360) % 360;
    
    return bearing;
  };

  // Calculer l'orientation de la boussole
  const calculateCompassHeading = (alpha: number, beta: number, gamma: number): number => {
    let heading = alpha;
    
    if (typeof heading === 'number' && !isNaN(heading)) {
      heading = 360 - heading;
      if (heading >= 360) heading -= 360;
      if (heading < 0) heading += 360;
    }
    
    return heading;
  };

  // Mémoriser les bearings vers les cibles pour éviter les recalculs inutiles
  const targetBearings = useMemo(() => {
    if (targetPoints.length > 0 && currentPosition) {
      return targetPoints.map(point => ({
        bearing: calculateBearing(
          currentPosition.latitude,
          currentPosition.longitude,
          point.latitude,
          point.longitude
        ),
        label: point.label,
        color: point.color
      }));
    }
    return [];
  }, [targetPoints, currentPosition]);

  // Écouter l'orientation de l'appareil
  useEffect(() => {
    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha !== null && event.beta !== null && event.gamma !== null) {
        const orientationData: DeviceOrientationData = {
          alpha: event.alpha,
          beta: event.beta,
          gamma: event.gamma
        };
        setDeviceOrientation(orientationData);
        
        const heading = calculateCompassHeading(
          orientationData.alpha,
          orientationData.beta,
          orientationData.gamma
        );
        setCompassHeading(heading);
      }
    };

    window.addEventListener('deviceorientation', handleOrientation as EventListener);
    
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation as EventListener);
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, []);

  // Obtenir la classe de taille
  const getSizeClass = () => `compass-${size}`;

  // Calculer la rotation de la flèche de la boussole
  const getCompassRotation = () => {
    return `rotate(${compassHeading}deg)`;
  };

  // Calculer la largeur effective de la boussole
  const getCompassWidth = () => {
    if (width) return width;
    
    switch (size) {
      case 'small': return 80;
      case 'medium': return 120;
      case 'large': return 160;
      default: return 120;
    }
  };

  // Calculer le rayon de la boussole (moins la moitié de la largeur du point)
  const getCompassRadius = () => {
    const compassWidth = getCompassWidth();
    return (compassWidth / 2) - 4; // 4px pour la moitié de la largeur du point (8px)
  };

  // Calculer la position d'un point sur le cercle
  const getTargetPosition = (bearing: number) => {
    const radius = getCompassRadius();
    // Utiliser seulement le bearing absolu, pas la différence avec compassHeading
    const angleInRadians = bearing * (Math.PI / 180);
    
    // Calculer les coordonnées x et y sur le cercle
    const x = Math.sin(angleInRadians) * radius;
    const y = -Math.cos(angleInRadians) * radius; // Négatif car l'axe Y pointe vers le bas en CSS
    
    return {
      left: `calc(50% + ${x}px)`,
      top: `calc(50% + ${y}px)`
    };
  };

  return (
    <div className={`compass ${getSizeClass()} ${className}`}>
      <div className="compass-circle">
        {/* Flèche de la boussole - FIXE au centre */}
        <div className="compass-arrow">
          <div className="arrow-head">▲</div>
        </div>
        
        {/* Points cardinaux - TOURNENT avec la boussole */}
        <div 
          className="compass-cardinals"
          style={{ transform: `rotate(${-compassHeading}deg)` }}
        >
          <div className="cardinal north">N</div>
          <div className="cardinal east">E</div>
          <div className="cardinal south">S</div>
          <div className="cardinal west">W</div>
        </div>

        {/* Points de cible sur le cercle - TOURNENT avec les points cardinaux */}
        <div 
          className="compass-targets"
          style={{ transform: `rotate(${-compassHeading}deg)` }}
        >
          {showTargetArrows && targetBearings.map((target, index) => {
            const position = getTargetPosition(target.bearing);
            // Calculer la distance si on a la position actuelle
            const distance = currentPosition ? 
              calculateDistance(
                currentPosition.latitude,
                currentPosition.longitude,
                targetPoints[index].latitude,
                targetPoints[index].longitude
              ) : null;
            
            return (
              <div
                key={index}
                className="target-point"
                style={{
                  left: position.left,
                  top: position.top,
                  color: target.color || '#ff6b6b'
                }}
              >
                <div className="target-dot"></div>
                {target.label && (
                  <div 
                    className="target-label" 
                    style={{ 
                      color: target.color || '#ff6b6b',
                      transform: `rotate(${compassHeading}deg)` // Rotation inverse pour garder le label horizontal
                    }}
                  >
                    <div className="target-name">{target.label}</div>
                    {distance !== null && (
                      <div className="target-distance">
                        {distance < 1000 ? 
                          `${Math.round(distance)}m` : 
                          `${(distance / 1000).toFixed(1)}km`
                        }
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Compass;
