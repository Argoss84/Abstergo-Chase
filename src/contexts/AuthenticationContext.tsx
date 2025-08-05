import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { getUserByAuthId, createUser } from '../services/UserServices';
import { listParameters } from '../services/AdminService'; // Importer la fonction listParameters
import { AppParamsService, AppParam } from '../services/AppParamsService';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY || "";

const supabase = createClient(supabaseUrl, supabaseKey);

interface AuthContextType {
  session: any;
  userEmail: string | null;
  loading: boolean;
  appParams: AppParam[] | null;
  appParamsLoading: boolean;
  refreshAppParams: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const supabaseClient = supabase;

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<any>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [appParams, setAppParams] = useState<AppParam[] | null>(null);
  const [appParamsLoading, setAppParamsLoading] = useState(false);

  // Fonction pour charger les paramètres de l'application
  const loadAppParams = async () => {
    setAppParamsLoading(true);
    try {
      const params = await AppParamsService.getAllParams();
      setAppParams(params);
    } catch (error) {
      console.error('Erreur lors du chargement des paramètres:', error);
      setAppParams(null);
    } finally {
      setAppParamsLoading(false);
    }
  };

  // Fonction pour rafraîchir les paramètres
  const refreshAppParams = async () => {
    await loadAppParams();
  };

  const handleUserAuth = async (session: any) => {
    if (session?.user) {
      // Vérifier si l'utilisateur existe déjà
      const existingUser = await getUserByAuthId(session.user.id);
      
      if (!existingUser) {
        // Créer un nouvel utilisateur s'il n'existe pas
        await createUser({
          auth_user_id: session.user.id,
          email: session.user.email
        });
      }
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUserEmail(session?.user?.email || null);
      setLoading(false);

      if (session?.user) {
        handleUserAuth(session);
        // Charger les paramètres après authentification
        loadAppParams();
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUserEmail(session?.user?.email || null);

      if (session?.user) {
        handleUserAuth(session);
        // Charger les paramètres après authentification
        loadAppParams();
      } else {
        // Réinitialiser les paramètres lors de la déconnexion
        setAppParams(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw new Error(error.message);
    }
    setSession(null);
    setUserEmail(null);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!session) {
    return <Auth supabaseClient={supabase}
      appearance={{
        theme: ThemeSupa,
        style: {
          input: { background: 'grey', color: 'white' },
          button: { background: 'grey', color: 'white'}
        },
      }} />;
  }

  return (
    <AuthContext.Provider value={{ 
      session, 
      userEmail, 
      loading, 
      appParams, 
      appParamsLoading, 
      refreshAppParams, 
      logout 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};