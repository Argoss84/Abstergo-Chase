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
            props (
              *
            )
          `)
          .eq('id_game', id_game);
        if (error) throw error;
        return data;
      }

      async getGameDatasByCode(code: string) {
        const { data, error } = await supabaseClient
          .from('game')
          .select(`
            *,
            props (
              *
            ),
            players (
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

      async getPlayerByIdWithUser(id_player: string) {
        const { data, error } = await supabaseClient
          .from('players')
          .select(`
            *,
            users (
              *
            )
          `)
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
        console.log('🔗 Creating subscription to player changes for game:', id_game);
        const channel = supabaseClient.channel(`player-changes-${id_game}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'players', filter: `id_game=eq.${id_game}` },
          (payload) => {
            console.log('📡 Supabase player change event received:', {
              channel: `player-changes-${id_game}`,
              event: payload.eventType,
              table: payload.table,
              schema: payload.schema,
              filter: `id_game=eq.${id_game}`,
              payload: payload
            });
            callback(payload);
          }
        )
        .subscribe((status) => {
          console.log('📡 Player changes subscription status:', {
            channel: `player-changes-${id_game}`,
            status: status,
            gameId: id_game
          });
        });
      return channel;
      }
    
      subscribeToPlayerDelete(id_game : string, callback:(payload : any) => void){
        console.log('🔗 Creating subscription to player deletions for game:', id_game);
        const channel = supabaseClient.channel(`player-delete-${id_game}`)
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'players' },
          (payload) => {
            console.log('📡 Supabase player DELETE event received:', {
              channel: `player-delete-${id_game}`,
              event: payload.eventType,
              table: payload.table,
              schema: payload.schema,
              payload: payload
            });
            callback(payload);
          }
        )
        .subscribe((status) => {
          console.log('📡 Player delete subscription status:', {
            channel: `player-delete-${id_game}`,
            status: status,
            gameId: id_game
          });
        });
      return channel;
      }
      
      subscribeToGameChanges(code: string, callback: (payload: any) => void) {
        const channel = supabaseClient.channel(`game-changes-${code}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'game', filter: `code=eq.${code}` },
            callback
          )
          .subscribe();
        return channel;
      }

      // Méthode d'abonnement complète pour les changements de game
      subscribeToGameDataChanges(code: string, callback: (payload: any) => void) {
        const channel = supabaseClient.channel(`game-data-changes-${code}`)
          .on(
            'postgres_changes',
            { 
              event: '*', 
              schema: 'public', 
              table: 'game', 
              filter: `code=eq.${code}` 
            },
            (payload) => {
              console.log('Game data change event:', payload);
              callback(payload);
            }
          )
          .subscribe();
        return channel;
      }

      // Méthode d'abonnement pour les changements des props (objectifs)
      subscribeToPropsChanges(id_game: string, callback: (payload: any) => void) {
        const channel = supabaseClient.channel(`props-changes-${id_game}`)
          .on(
            'postgres_changes',
            { 
              event: '*', 
              schema: 'public', 
              table: 'props', 
              filter: `id_game=eq.${id_game}` 
            },
            (payload) => {
              console.log('Props change event:', payload);
              callback(payload);
            }
          )
          .subscribe();
        return channel;
      }

      async createPlayerWithEmail(playerData: { id_game: number; email: string; role: string; created_at: string }) {
        // Create the player directly with the email as user_id
        const { data, error } = await supabaseClient
          .from('players')
          .insert([{
            id_game: playerData.id_game,
            user_id: playerData.email, // Use email as user_id
            role: playerData.role,
            created_at: playerData.created_at
          }])
          .select();
        
        if (error) throw error;
        return data;
      }
}

export default GameService;
