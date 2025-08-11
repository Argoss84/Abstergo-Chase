import { supabaseClient } from '../contexts/AuthenticationContext';

export interface Log {
  id_log: number;
  created_at: string;
  created_by: string;
  source: string;
  message: string;
  details: string | null;
}

export class LogService {
  /**
   * Insère un nouveau log dans la base de données
   */
  static async insertLog(
    createdBy: string,
    source: string,
    message: string,
    details?: string
  ): Promise<Log | null> {
    try {
      const { data, error } = await supabaseClient
        .from('Logs')
        .insert({
          created_by: createdBy,
          source: source,
          message: message,
          details: details || null
        })
        .select()
        .single();

      if (error) {
        console.error('Erreur lors de l\'insertion du log:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Erreur lors de l\'insertion du log:', error);
      return null;
    }
  }

  /**
   * Récupère les logs avec pagination
   */
  static async getLogs(
    page: number = 1,
    pageSize: number = 50,
    source?: string,
    createdBy?: string
  ): Promise<{ data: Log[] | null; count: number | null; error: any }> {
    try {
      let query = supabaseClient
        .from('Logs')
        .select('*', { count: 'exact' });

      if (source) {
        query = query.eq('source', source);
      }

      if (createdBy) {
        query = query.eq('created_by', createdBy);
      }

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      return { data, count, error };
    } catch (error) {
      console.error('Erreur lors de la récupération des logs:', error);
      return { data: null, count: null, error };
    }
  }

  /**
   * Récupère les logs d'une source spécifique
   */
  static async getLogsBySource(source: string): Promise<Log[] | null> {
    try {
      const { data, error } = await supabaseClient
        .from('Logs')
        .select('*')
        .eq('source', source)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Erreur lors de la récupération des logs par source:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Erreur lors de la récupération des logs par source:', error);
      return null;
    }
  }

  /**
   * Récupère les logs d'un utilisateur spécifique
   */
  static async getLogsByUser(createdBy: string): Promise<Log[] | null> {
    try {
      const { data, error } = await supabaseClient
        .from('Logs')
        .select('*')
        .eq('created_by', createdBy)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Erreur lors de la récupération des logs par utilisateur:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Erreur lors de la récupération des logs par utilisateur:', error);
      return null;
    }
  }

  /**
   * Supprime un log par son ID
   */
  static async deleteLog(idLog: number): Promise<boolean> {
    try {
      const { error } = await supabaseClient
        .from('Logs')
        .delete()
        .eq('id_log', idLog);

      if (error) {
        console.error('Erreur lors de la suppression du log:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Erreur lors de la suppression du log:', error);
      return false;
    }
  }

  /**
   * Méthode utilitaire pour logger rapidement
   */
  static async quickLog(
    createdBy: string,
    source: string,
    message: string,
    details?: string
  ): Promise<void> {
    console.log('Logging:', createdBy, source, message, details);
    await this.insertLog(createdBy, source, message, details);
  }
} 