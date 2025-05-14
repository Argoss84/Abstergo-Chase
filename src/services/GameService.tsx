import { supabase } from '@supabase/auth-ui-shared';
import { supabaseClient } from '../contexts/AuthenticationContext';

class GameService {
    async createGame(gameData: Record<string, any>) {
        const { data, error } = await supabaseClient
          .from('game')
          .insert([gameData])
          .select();
        if (error) throw error;
        return data;
      }

      async getGames() {
        const { data, error } = await supabaseClient
          .from('game')
          .select('*');
        if (error) throw error;
        return data;
      }

      async getGameWithProps(id_game: string) {
        const { data, error } = await supabaseClient
          .from('game')
          .select(`
            *,
            game_props (
              *
            )
          `)
          .eq('id_game', id_game);
        if (error) throw error;
        return data;
      }

      async getGameWithPropsByCode(code: string) {
        const { data, error } = await supabaseClient
          .from('game')
          .select(`
            *,
            game_props (
              *
            )
          `)
          .eq('code', code);
        if (error) throw error;
        return data;
      }

      async getGameByCode(code: string) {
        const { data, error } = await supabaseClient
          .from('game')
          .select(`*`)
          .eq('code', code);
        if (error) throw error;
        return data;
      }

      async updateGameByCode(code: string, gameData: Record<string, any>) {
        const { data, error } = await supabaseClient
          .from('game')
          .update(gameData)
          .eq('code', code)
          .select();
        if (error) throw error;
        return data;
      }

      async createProps(propsData: Record<string, any>[]) {
        const { data, error } = await supabaseClient
          .from('props')
          .insert(propsData)
          .select();
        if (error) throw error;
        return data;
      }

      async getProps() {
        const { data, error } = await supabaseClient
          .from('props')
          .select('*');
        if (error) throw error;
        return data;
      }

      async updateProp(id_prop: string, propData: Record<string, any>) {
        const { data, error } = await supabaseClient
          .from('props')
          .update(propData)
          .eq('id_prop', id_prop)
          .select();
        if (error) throw error;
        return data;
      }

      async deleteProp(id_prop: string) {
        const { error } = await supabaseClient
          .from('props')
          .delete()
          .eq('id_prop', id_prop);
        if (error) throw error;
      }

      // CRUD pour les joueurs
    async createPlayer(playerData: Record<string, any>) {
        const { data, error } = await supabaseClient
          .from('players')
          .insert([playerData])
          .select();
        if (error) throw error;
        return data;
      }
    
      async getPlayers() {
        const { data, error } = await supabaseClient
          .from('players')
          .select('*');
        if (error) throw error;
        return data;
      }
    
      async getPlayerById(id_player: string) {
        const { data, error } = await supabaseClient
          .from('players')
          .select('*')
          .eq('id_player', id_player);
        if (error) throw error;
        return data;
      }
  
  
      async getPlayersByGameId(id_game: string) {
        let { data: players, error } = await supabaseClient
          .from('players')
          .select(`
            *,
            users (
              *
            )
          `)
          .eq('id_game', id_game);
        if (error) throw error;
        return players;
      }
  
      async getPlayerByGameIdAnduserID(id_game: string, user_id : string) {
        const { data, error } = await supabaseClient
          .from('players')
          .select(`
            *,
            users (
              *
            )
          `)
          .eq('user_id',user_id)
          .eq('id_game', id_game);
        if (error) throw error;
        return data;
      }
    
      async updatePlayer(id_player: string, playerData: Record<string, any>) {
        const { data, error } = await supabaseClient
          .from('players')
          .update(playerData)
          .eq('id_player', id_player)
          .select();
        if (error) throw error;
        return data;
      }
    
      async deletePlayer(id_player: string) {
        const { error } = await supabaseClient
          .from('players')
          .delete()
          .eq('id_player', id_player);
        if (error) throw error;
      } 

      // méthodes temps réel 
      subscribeToPlayerChanges(id_game : string, callback:(payload : any) => void){
        const channel = supabaseClient.channel(`player-changes-${id_game}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'players', filter: `id_game=eq.${id_game}` },
          callback
        )
        .subscribe();
      return channel;
      }
    
      subscribeToPlayerDelete(id_game : string, callback:(payload : any) => void){
        const channel = supabaseClient.channel(`player-delete-${id_game}`)
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'players' },
          callback
        )
        .subscribe();
      return channel;
      }
}

export default GameService;
