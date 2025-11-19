import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { toast } from 'react-toastify';

import { GameDetails, ObjectiveCircle } from '../components/Interfaces';
import { AppParam } from '../services/AppParamsService';
import { useWakeLock } from '../utils/useWakeLock';
import { useVibration } from './useVibration';
import { handleError, ERROR_CONTEXTS } from '../utils/ErrorUtils';

interface UseGamePageCommonOptions {
  userEmail?: string | null;
  appParams?: AppParam[] | null;
}

const useGamePageCommon = ({ userEmail, appParams }: UseGamePageCommonOptions) => {
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [currentPosition, setCurrentPosition] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routePath, setRoutePath] = useState<[number, number][]>([]);
  const [distanceToStartZone, setDistanceToStartZone] = useState<number | null>(null);

  const [routineInterval, setRoutineInterval] = useState<number>(2000);
  const [isRoutineActive, setIsRoutineActive] = useState<boolean>(true);
  const [routineExecutionCount, setRoutineExecutionCount] = useState<number>(0);
  const routineIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [currentPlayerId, setCurrentPlayerId] = useState<number | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentUserIsAdmin, setCurrentUserIsAdmin] = useState<boolean>(false);
  const [gameCode, setGameCode] = useState<string | null>(null);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [isCountdownActive, setIsCountdownActive] = useState<boolean>(false);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const mapRef = useRef<L.Map | null>(null);
  const [playerLogo, setPlayerLogo] = useState<string>('joueur_1.png');
  const [isFabOpen, setIsFabOpen] = useState(false);

  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [qrCodeText, setQrCodeText] = useState<string>('');
  const [objectiveCircles, setObjectiveCircles] = useState<ObjectiveCircle[]>([]);
  const [objectiveCirclesInitialized, setObjectiveCirclesInitialized] = useState<boolean>(false);

  const { releaseWakeLock } = useWakeLock(true);
  const { vibrate, patterns } = useVibration();

  const userEmailRef = useRef<string | undefined>(userEmail ?? undefined);

  useEffect(() => {
    userEmailRef.current = userEmail ?? currentUser?.email ?? undefined;
  }, [userEmail, currentUser?.email]);

  useEffect(() => {
    if (appParams) {
      const gameRefreshParam = appParams.find(param => param.param_name === 'game_refresh_ms');
      if (gameRefreshParam && gameRefreshParam.param_value) {
        const refreshMs = parseInt(gameRefreshParam.param_value);
        if (!isNaN(refreshMs) && refreshMs > 0) {
          setRoutineInterval(refreshMs);
          console.log(`🔄 Intervalle de routine configuré: ${refreshMs}ms`);
        }
      }
    }
  }, [appParams]);

  useEffect(() => {
    const logoNumber = Math.floor(Math.random() * 6) + 1;
    setPlayerLogo(`joueur_${logoNumber}.png`);
  }, []);

  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        position => {
          setCurrentPosition([position.coords.latitude, position.coords.longitude]);
        },
        error => {
          handleError('Erreur lors de la récupération de la position', error, {
            context: ERROR_CONTEXTS.NETWORK,
            userEmail: userEmailRef.current,
            shouldShowError: false
          });
        }
      );

      const watchId = navigator.geolocation.watchPosition(
        position => {
          setCurrentPosition([position.coords.latitude, position.coords.longitude]);
        },
        error => {
          handleError('Erreur lors de la surveillance de la position', error, {
            context: ERROR_CONTEXTS.NETWORK,
            userEmail: userEmailRef.current,
            shouldShowError: false
          });
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 5000
        }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, []);

  const handleErrorWithUser = useCallback(async (errorMessage: string, error?: any, context?: string) => {
    const errorResult = await handleError(errorMessage, error, {
      context: context || ERROR_CONTEXTS.GENERAL,
      userEmail: userEmailRef.current
    });
    setError(errorResult.message);
    return errorResult;
  }, []);

  const handleNetworkScan = useCallback(() => {
    console.log('Scan réseau activé');
    toast.info('🔍 Scan réseau en cours...');
    vibrate(patterns.short);
  }, [patterns, vibrate]);

  const handleVisionMode = useCallback(() => {
    console.log('Mode vision activé');
    toast.success('👁️ Mode vision activé');
    vibrate(patterns.short);
  }, [patterns, vibrate]);

  const handleHealthCheck = useCallback(() => {
    console.log('Ouverture de la modal QR code');
    setIsQRModalOpen(true);
    vibrate(patterns.short);
  }, [patterns, vibrate]);

  const handleLocationTracker = useCallback(() => {
    console.log('Traceur de localisation activé');
    if (currentPosition && mapRef.current) {
      mapRef.current.setView(currentPosition, 15);
      toast.success('📍 Carte recentrée sur votre position');
    } else if (currentPosition) {
      toast.info(`📍 Position actuelle: ${currentPosition[0].toFixed(6)}, ${currentPosition[1].toFixed(6)}`);
    } else {
      toast.error('❌ Position non disponible');
    }
    vibrate(patterns.short);
  }, [currentPosition, patterns, vibrate]);

  return {
    gameDetails,
    setGameDetails,
    currentPosition,
    setCurrentPosition,
    error,
    setError,
    routePath,
    setRoutePath,
    distanceToStartZone,
    setDistanceToStartZone,
    routineInterval,
    setRoutineInterval,
    isRoutineActive,
    setIsRoutineActive,
    routineExecutionCount,
    setRoutineExecutionCount,
    routineIntervalRef,
    currentPlayerId,
    setCurrentPlayerId,
    currentUser,
    setCurrentUser,
    currentUserIsAdmin,
    setCurrentUserIsAdmin,
    gameCode,
    setGameCode,
    countdown,
    setCountdown,
    isCountdownActive,
    setIsCountdownActive,
    countdownIntervalRef,
    mapRef,
    playerLogo,
    setPlayerLogo,
    isFabOpen,
    setIsFabOpen,
    releaseWakeLock,
    vibrate,
    patterns,
    isQRModalOpen,
    setIsQRModalOpen,
    qrCodeText,
    setQrCodeText,
    objectiveCircles,
    setObjectiveCircles,
    objectiveCirclesInitialized,
    setObjectiveCirclesInitialized,
    handleErrorWithUser,
    handleNetworkScan,
    handleVisionMode,
    handleHealthCheck,
    handleLocationTracker
  };
};

export default useGamePageCommon;
