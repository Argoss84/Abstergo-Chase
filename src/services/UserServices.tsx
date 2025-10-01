import { supabaseClient } from '../contexts/AuthenticationContext';

export async function getUserWithAccessRights(authUserId: any) {
    const { data, error } = await supabaseClient
        .from('users')
        .select(`
            *,
            user_access_rights (
                access_rights (
                    id,
                    name,
                    description
                )
            )
        `)
        .eq('auth_user_id', authUserId);

    if (error) {
        console.error('Erreur lors de la récupération de l\'utilisateur :', error);
        return null;
    }

    return data;
}

export async function getUserByAuthId(authUserId: any) {
    const { data, error } = await supabaseClient
        .from('users')
        .select('*')
        .eq('auth_user_id', authUserId)
        .single();

    if (error) {
        console.error('Erreur lors de la récupération de l\'utilisateur :', error);
        return null;
    }

    return data;
}

export async function getUserByEmail(email: string) {
    const { data, error } = await supabaseClient
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

    if (error) {
        console.error('Erreur lors de la récupération de l\'utilisateur par email :', error);
        return null;
    }

    return data;
}

// Create a new user
export const createUser = async (userData: any) => {
  const { data, error } = await supabaseClient
    .from('users')
    .insert([userData]);
  return { data, error };
};

// Read users
export const getUsers = async () => {
  const { data, error } = await supabaseClient
    .from('users')
    .select('*');
  return { data, error };
};

// Get user by ID
export const getUserById = async (id: any) => {
  const { data, error } = await supabaseClient
    .from('users')
    .select('*')
    .eq('id', id)
    .single();
  return { data, error };
};

// Update a user
export const updateUser = async (id: any, userData: any) => {
  const userWithoutId = { ...userData };
  delete userWithoutId.id;

  const { data, error } = await supabaseClient
    .from('users')
    .update(userWithoutId)
    .eq('id', id);
  return { data, error };
};

// Delete a user
export const deleteUser = async (id: any) => {
  const { data, error } = await supabaseClient
    .from('users')
    .delete()
    .eq('id', id);
  return { data, error };
};