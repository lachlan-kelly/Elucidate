(function() {
    let _supabase = null;
    let _config = window.ELUCIDATE_CONFIG || {
        SUPABASE_URL: 'YOUR_SUPABASE_URL',
        SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY'
    };

    const init = () => {
        if (!_supabase && window.supabase) {
            _supabase = window.supabase.createClient(
                _config.SUPABASE_URL,
                _config.SUPABASE_ANON_KEY
            );
        }
        return _supabase;
    };

    const getClient = () => {
        if (!_supabase) {
            return init();
        }
        return _supabase;
    };

    const isConfigured = () => {
        return _config.SUPABASE_URL !== 'YOUR_SUPABASE_URL' && 
               _config.SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';
    };

    const signUp = async (email, password) => {
        try {
            const client = getClient();
            if (!client) throw new Error("Supabase client not initialized.");
            const { data, error } = await client.auth.signUp({ email, password });
            return { user: data?.user || null, error };
        } catch (error) {
            return { user: null, error };
        }
    };

    const signIn = async (email, password) => {
        try {
            const client = getClient();
            if (!client) throw new Error("Supabase client not initialized.");
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            return { user: data?.user || null, session: data?.session || null, error };
        } catch (error) {
            return { user: null, session: null, error };
        }
    };

    const signOut = async () => {
        try {
            const client = getClient();
            if (!client) throw new Error("Supabase client not initialized.");
            const { error } = await client.auth.signOut();
            return { error };
        } catch (error) {
            return { error };
        }
    };

    const getSession = async () => {
        try {
            const client = getClient();
            if (!client) throw new Error("Supabase client not initialized.");
            const { data, error } = await client.auth.getSession();
            return { session: data?.session || null, error };
        } catch (error) {
            return { session: null, error };
        }
    };

    const getUser = async () => {
        try {
            const client = getClient();
            if (!client) throw new Error("Supabase client not initialized.");
            const { data, error } = await client.auth.getUser();
            return { user: data?.user || null, error };
        } catch (error) {
            return { user: null, error };
        }
    };

    const onAuthStateChange = (callback) => {
        const client = getClient();
        if (!client) return null;
        const { data } = client.auth.onAuthStateChange(callback);
        return data?.subscription || null;
    };

    const saveSettings = async (settings) => {
        try {
            const client = getClient();
            if (!client) throw new Error("Supabase client not initialized.");
            
            const { user, error: userError } = await getUser();
            if (userError || !user) throw new Error("User not found.");

            const dataToSave = {
                user_id: user.id,
                ...settings,
                updated_at: new Date().toISOString()
            };

            const { data, error } = await client
                .from('user_settings')
                .upsert(dataToSave, { onConflict: 'user_id' })
                .select();
                
            return { data: data ? data[0] : null, error };
        } catch (error) {
            return { data: null, error };
        }
    };

    const loadSettings = async () => {
        try {
            const client = getClient();
            if (!client) throw new Error("Supabase client not initialized.");
            
            const { user, error: userError } = await getUser();
            if (userError || !user) throw new Error("User not found.");

            const { data, error } = await client
                .from('user_settings')
                .select('*')
                .eq('user_id', user.id)
                .single();
                
            return { data, error };
        } catch (error) {
            return { data: null, error };
        }
    };

    const saveChatSession = async (sessionData) => {
        try {
            const client = getClient();
            if (!client) throw new Error("Supabase client not initialized.");
            
            const { user, error: userError } = await getUser();
            if (userError || !user) throw new Error("User not found.");

            const dataToSave = {
                user_id: user.id,
                ...sessionData
            };

            const { data, error } = await client
                .from('chat_sessions')
                .insert([dataToSave])
                .select();
                
            return { data: data ? data[0] : null, error };
        } catch (error) {
            return { data: null, error };
        }
    };

    const saveChatMessage = async (messageData) => {
        try {
            const client = getClient();
            if (!client) throw new Error("Supabase client not initialized.");

            const { data, error } = await client
                .from('chat_messages')
                .insert([messageData])
                .select();
                
            return { data: data ? data[0] : null, error };
        } catch (error) {
            return { data: null, error };
        }
    };

    const loadChatSessions = async () => {
        try {
            const client = getClient();
            if (!client) throw new Error("Supabase client not initialized.");
            
            const { user, error: userError } = await getUser();
            if (userError || !user) throw new Error("User not found.");

            const { data, error } = await client
                .from('chat_sessions')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });
                
            return { data: data || [], error };
        } catch (error) {
            return { data: [], error };
        }
    };

    const loadChatMessages = async (sessionId) => {
        try {
            const client = getClient();
            if (!client) throw new Error("Supabase client not initialized.");

            const { data, error } = await client
                .from('chat_messages')
                .select('*')
                .eq('session_id', sessionId)
                .order('created_at', { ascending: true });
                
            return { data: data || [], error };
        } catch (error) {
            return { data: [], error };
        }
    };

    const findChatSessionForCourse = async (courseId) => {
        try {
            const client = getClient();
            if (!client) throw new Error("Supabase client not initialized.");
            const { user, error: userError } = await getUser();
            if (userError || !user) throw new Error("User not found.");

            const { data, error } = await client
                .from('chat_sessions')
                .select('*')
                .eq('user_id', user.id)
                .eq('course_id', courseId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            return { data, error };
        } catch (error) {
            return { data: null, error };
        }
    };

    const deleteChatSession = async (sessionId) => {
        try {
            const client = getClient();
            if (!client) throw new Error("Supabase client not initialized.");
            const { error } = await client
                .from('chat_sessions')
                .delete()
                .eq('id', sessionId);
            return { error };
        } catch (error) {
            return { error };
        }
    };

    window.SupabaseClient = {
        init,
        getClient,
        isConfigured,
        signUp,
        signIn,
        signOut,
        getSession,
        getUser,
        onAuthStateChange,
        saveSettings,
        loadSettings,
        saveChatSession,
        saveChatMessage,
        loadChatSessions,
        loadChatMessages,
        findChatSessionForCourse,
        deleteChatSession
    };
})();
