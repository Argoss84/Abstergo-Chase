import { supabaseClient } from '../contexts/AuthenticationContext';

//#region  Logs
export const insertLog = async (
  log_level: string,
  message: string,
  context: object,
  source: string,
  user_id: number
) => {
  const logEntry = {
    log_level,
    message,
    context,
    source,
    user_id
  };

  console.log('Inserting log entry:', logEntry);

  const { data, error } = await supabaseClient
    .from('logs')
    .insert([logEntry]);

  if (error) {
    console.error('Error inserting log:', error);
    throw error;
  }

  return data;
};

  //#endregion

//#region  Parameters

  export const listParameters = async () => {
    const { data, error } = await supabaseClient
      .from('global_parameters')
      .select('*');
  
    if (error) {
      console.error('Error fetching parameters:', error);
      throw error;
    }
  
    return data;
  };

  export const updateParameters = async (parameters: { parameter_name: string, parameter_value: string }[]) => {
    const parametersWithoutId = parameters.map(({ parameter_name, parameter_value }) => ({ parameter_name, parameter_value }));
  
    const { data, error } = await supabaseClient
      .from('global_parameters')
      //onConflict indique que l'upsert se base sur parameter_name
      .upsert(parametersWithoutId, { onConflict: 'parameter_name' });
  
    if (error) {
      console.error('Error updating parameters:', error);
      throw error;
    }
  
    return data;
  };
//#endregion