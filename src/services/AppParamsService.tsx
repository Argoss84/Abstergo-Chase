import { supabaseClient } from '../contexts/AuthenticationContext';

export interface AppParam {
  id: number;
  created_at: string;
  param_name: string | null;
  param_value: string | null;
  param_value_type: string | null;
}

export class AppParamsService {
  /**
   * Insère un nouveau paramètre dans la base de données
   */
  static async insertParam(
    paramName: string,
    paramValue: string,
    paramValueType: string = 'text'
  ): Promise<AppParam | null> {
    try {
      const { data, error } = await supabaseClient
        .from('AppParams')
        .insert({
          param_name: paramName,
          param_value: paramValue,
          param_value_type: paramValueType
        })
        .select()
        .single();

      if (error) {
        console.error('Erreur lors de l\'insertion du paramètre:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Erreur lors de l\'insertion du paramètre:', error);
      return null;
    }
  }

  /**
   * Récupère un paramètre par son nom
   */
  static async getParamByName(paramName: string): Promise<AppParam | null> {
    try {
      const { data, error } = await supabaseClient
        .from('AppParams')
        .select('*')
        .eq('param_name', paramName)
        .single();

      if (error) {
        console.error('Erreur lors de la récupération du paramètre:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Erreur lors de la récupération du paramètre:', error);
      return null;
    }
  }

  /**
   * Récupère la valeur d'un paramètre par son nom
   */
  static async getParamValue(paramName: string): Promise<string | null> {
    try {
      const param = await this.getParamByName(paramName);
      return param?.param_value || null;
    } catch (error) {
      console.error('Erreur lors de la récupération de la valeur du paramètre:', error);
      return null;
    }
  }

  /**
   * Récupère tous les paramètres
   */
  static async getAllParams(): Promise<AppParam[] | null> {
    try {
      const { data, error } = await supabaseClient
        .from('AppParams')
        .select('*')
        .order('param_name', { ascending: true });

      if (error) {
        console.error('Erreur lors de la récupération des paramètres:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Erreur lors de la récupération des paramètres:', error);
      return null;
    }
  }

  /**
   * Met à jour un paramètre existant
   */
  static async updateParam(
    paramName: string,
    paramValue: string,
    paramValueType?: string
  ): Promise<AppParam | null> {
    try {
      const updateData: any = {
        param_value: paramValue
      };

      if (paramValueType) {
        updateData.param_value_type = paramValueType;
      }

      const { data, error } = await supabaseClient
        .from('AppParams')
        .update(updateData)
        .eq('param_name', paramName)
        .select()
        .single();

      if (error) {
        console.error('Erreur lors de la mise à jour du paramètre:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Erreur lors de la mise à jour du paramètre:', error);
      return null;
    }
  }

  /**
   * Insère ou met à jour un paramètre (upsert)
   */
  static async upsertParam(
    paramName: string,
    paramValue: string,
    paramValueType: string = 'text'
  ): Promise<AppParam | null> {
    try {
      const existingParam = await this.getParamByName(paramName);
      
      if (existingParam) {
        return await this.updateParam(paramName, paramValue, paramValueType);
      } else {
        return await this.insertParam(paramName, paramValue, paramValueType);
      }
    } catch (error) {
      console.error('Erreur lors de l\'upsert du paramètre:', error);
      return null;
    }
  }

  /**
   * Supprime un paramètre par son nom
   */
  static async deleteParam(paramName: string): Promise<boolean> {
    try {
      const { error } = await supabaseClient
        .from('AppParams')
        .delete()
        .eq('param_name', paramName);

      if (error) {
        console.error('Erreur lors de la suppression du paramètre:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Erreur lors de la suppression du paramètre:', error);
      return false;
    }
  }

  /**
   * Supprime un paramètre par son ID
   */
  static async deleteParamById(id: number): Promise<boolean> {
    try {
      const { error } = await supabaseClient
        .from('AppParams')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Erreur lors de la suppression du paramètre:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Erreur lors de la suppression du paramètre:', error);
      return false;
    }
  }

  /**
   * Récupère les paramètres par type de valeur
   */
  static async getParamsByType(paramValueType: string): Promise<AppParam[] | null> {
    try {
      const { data, error } = await supabaseClient
        .from('AppParams')
        .select('*')
        .eq('param_value_type', paramValueType)
        .order('param_name', { ascending: true });

      if (error) {
        console.error('Erreur lors de la récupération des paramètres par type:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Erreur lors de la récupération des paramètres par type:', error);
      return null;
    }
  }

  /**
   * Méthode utilitaire pour définir rapidement un paramètre
   */
  static async setParam(
    paramName: string,
    paramValue: string,
    paramValueType: string = 'text'
  ): Promise<void> {
    await this.upsertParam(paramName, paramValue, paramValueType);
  }

  /**
   * Méthode utilitaire pour récupérer rapidement la valeur d'un paramètre
   */
  static async getParam(paramName: string): Promise<string | null> {
    return await this.getParamValue(paramName);
  }

  /**
   * Récupère la valeur d'un paramètre avec le bon type
   */
  static async getTypedParam(paramName: string): Promise<string | number | boolean | null> {
    try {
      const param = await this.getParamByName(paramName);
      if (!param) return null;

      const value = param.param_value;
      const type = param.param_value_type;

      if (value === null) return null;

      switch (type) {
        case 'number':
          const numValue = parseFloat(value);
          return isNaN(numValue) ? null : numValue;
        case 'bool':
        case 'boolean':
          return value.toLowerCase() === 'true';
        case 'text':
        default:
          return value;
      }
    } catch (error) {
      console.error('Erreur lors de la récupération du paramètre typé:', error);
      return null;
    }
  }

  /**
   * Récupère la valeur d'un paramètre comme nombre
   */
  static async getNumberParam(paramName: string): Promise<number | null> {
    try {
      const value = await this.getTypedParam(paramName);
      return typeof value === 'number' ? value : null;
    } catch (error) {
      console.error('Erreur lors de la récupération du paramètre numérique:', error);
      return null;
    }
  }

  /**
   * Récupère la valeur d'un paramètre comme booléen
   */
  static async getBooleanParam(paramName: string): Promise<boolean | null> {
    try {
      const value = await this.getTypedParam(paramName);
      return typeof value === 'boolean' ? value : null;
    } catch (error) {
      console.error('Erreur lors de la récupération du paramètre booléen:', error);
      return null;
    }
  }

  /**
   * Récupère la valeur d'un paramètre comme texte
   */
  static async getTextParam(paramName: string): Promise<string | null> {
    try {
      const value = await this.getTypedParam(paramName);
      return typeof value === 'string' ? value : null;
    } catch (error) {
      console.error('Erreur lors de la récupération du paramètre texte:', error);
      return null;
    }
  }

  /**
   * Définit un paramètre avec le bon type automatiquement détecté
   */
  static async setTypedParam(
    paramName: string,
    value: string | number | boolean
  ): Promise<void> {
    let paramValue: string;
    let paramType: string;

    if (typeof value === 'number') {
      paramValue = value.toString();
      paramType = 'number';
    } else if (typeof value === 'boolean') {
      paramValue = value.toString();
      paramType = 'bool';
    } else {
      paramValue = value;
      paramType = 'text';
    }

    await this.setParam(paramName, paramValue, paramType);
  }

  /**
   * Définit un paramètre numérique
   */
  static async setNumberParam(paramName: string, value: number): Promise<void> {
    await this.setParam(paramName, value.toString(), 'number');
  }

  /**
   * Définit un paramètre booléen
   */
  static async setBooleanParam(paramName: string, value: boolean): Promise<void> {
    await this.setParam(paramName, value.toString(), 'bool');
  }

  /**
   * Définit un paramètre texte
   */
  static async setTextParam(paramName: string, value: string): Promise<void> {
    await this.setParam(paramName, value, 'text');
  }
} 