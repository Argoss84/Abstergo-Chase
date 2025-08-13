import React, { useState, useEffect, useRef } from 'react';
import './Compass.css';

interface CompassProps {
  targetPoint?: {
    latitude: number;
    longitude: number;
  };
  currentPosition?: {
    latitude: number;
    longitude: number;
  };
  size?: 'small' | 'medium' | 'large';
  showTargetArrow?: boolean;
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
  targetPoint,
  currentPosition,
  size = 'medium',
  showTargetArrow = true,
  className = ''
}) => {
  const [deviceOrientation, setDeviceOrientation] = useState<DeviceOrientationData | null>(null);
  const [compassHeading, setCompassHeading] = useState<number>(0);
  const [targetBearing, setTargetBearing] = useState<number | null>(null);
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

  // Mettre à jour le bearing vers la cible
  useEffect(() => {
    if (targetPoint && currentPosition) {
      const bearing = calculateBearing(
        currentPosition.latitude,
        currentPosition.longitude,
        targetPoint.latitude,
        targetPoint.longitude
      );
      setTargetBearing(bearing);
    }
  }, [targetPoint, currentPosition]);

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

  // Calculer la rotation de la flèche de la cible
  const getTargetRotation = () => {
    if (targetBearing === null) return 'rotate(0deg)';
    const relativeBearing = (targetBearing - compassHeading + 360) % 360;
    return `rotate(${relativeBearing}deg)`;
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
      </div>
    </div>
  );
};

export default Compass;
