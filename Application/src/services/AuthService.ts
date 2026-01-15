// Service simple pour gérer l'authentification par mot de passe
class AuthService {
  private password: string | null = null;
  private readonly STORAGE_KEY = 'abstergo-auth-password';
  private readonly SERVER_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:5174'
    : 'https://ws.abstergochase.fr';
  private readonly IS_LOCALHOST = window.location.hostname === 'localhost';
  private readonly ENV_PASSWORD = this.IS_LOCALHOST
    ? (import.meta.env?.VITE_SERVER_PASSWORD ||
      import.meta.env?.VITE_AUTH_PASSWORD ||
      import.meta.env?.VITE_MDP ||
      null)
    : null;

  constructor() {
    // Restaurer le mot de passe depuis sessionStorage au démarrage
    this.restorePassword();
    if (this.IS_LOCALHOST) {
      this.password = 'test123'|| 'local';
      this.persistPassword();
      return;
    }
  }

  // Vérifier le mot de passe auprès du serveur
  async verifyPassword(password: string): Promise<boolean> {
    try {
      if (this.IS_LOCALHOST) {
        this.password = "test123" || 'local';
        this.persistPassword();
        return true;
      }
      const response = await fetch(`${this.SERVER_URL}/api/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();
      
      if (data.valid) {
        this.password = password;
        this.persistPassword();
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Erreur lors de la vérification du mot de passe:', error);
      return false;
    }
  }

  // Récupérer le mot de passe actuel
  getPassword(): string | null {
    return this.password;
  }

  // Vérifier si l'utilisateur est authentifié
  isAuthenticated(): boolean {
    if (this.IS_LOCALHOST) {
      return true;
    }
    return this.password !== null;
  }

  // Déconnecter l'utilisateur
  logout() {
    this.password = null;
    sessionStorage.removeItem(this.STORAGE_KEY);
  }

  // Persister le mot de passe dans sessionStorage
  private persistPassword() {
    if (this.password) {
      sessionStorage.setItem(this.STORAGE_KEY, this.password);
    }
  }

  // Restaurer le mot de passe depuis sessionStorage
  private restorePassword() {
    const stored = sessionStorage.getItem(this.STORAGE_KEY);
    if (stored) {
      this.password = stored;
    }
  }
}

export const authService = new AuthService();
