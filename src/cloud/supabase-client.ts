/**
 * Imhotep Browser Sync - Supabase Cloud Vault Client
 *
 * Provides a resilient, type-safe interface for Supabase Auth, Row-Level-Security (RLS)
 * protected queries, and Realtime WebSocket replication tailored for Manifest V3.
 *
 * MV3 Compatible:
 * - Uses chrome.storage.local as the auth persistence adapter (since window.localStorage
 *   is undefined in Chrome MV3 Background Service Workers).
 * - Implements reconnect resiliency and active subscription cleanup.
 */

import {
  createClient,
  SupabaseClient,
  RealtimeChannel,
  User,
  Session,
  AuthChangeEvent,
} from '@supabase/supabase-js';
import {
  CloudConfig,
  DeviceRecord,
  UserProfileRecord,
  HistorySyncRecord,
  ExtensionSyncRecord,
} from '../types/sync';

// Default configuration (can be configured via extension options/storage)
export const DEFAULT_SUPABASE_URL = 'https://your-project.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY = 'your-anon-key-placeholder';

const STORAGE_KEY_CONFIG = 'imhotep_cloud_config';

/**
 * Manifest V3 Service Worker compatible auth storage adapter.
 * Replaces window.localStorage with asynchronous chrome.storage.local.
 */
const chromeStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await chrome.storage.local.get([key]);
        return result[key] ?? null;
      }
      return null;
    } catch (e) {
      console.warn('[Imhotep:Supabase] Failed to read storage key:', key, e);
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [key]: value });
      }
    } catch (e) {
      console.warn('[Imhotep:Supabase] Failed to write storage key:', key, e);
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.remove([key]);
      }
    } catch (e) {
      console.warn('[Imhotep:Supabase] Failed to remove storage key:', key, e);
    }
  },
};

class SupabaseVaultService {
  private client: SupabaseClient | null = null;
  private currentConfig: CloudConfig | null = null;
  private activeChannels: Map<string, RealtimeChannel> = new Map();

  /**
   * Initializes or reconfigures the Supabase client.
   */
  public async initClient(customConfig?: Partial<CloudConfig>): Promise<SupabaseClient> {
    const storedConfig = await this.loadCloudConfig();
    const config: CloudConfig = {
      supabaseUrl: customConfig?.supabaseUrl || storedConfig.supabaseUrl || DEFAULT_SUPABASE_URL,
      supabaseAnonKey:
        customConfig?.supabaseAnonKey || storedConfig.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY,
      enabled: customConfig?.enabled ?? storedConfig.enabled ?? true,
    };

    this.currentConfig = config;

    this.client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        storage: chromeStorageAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });

    return this.client;
  }

  /**
   * Returns active Supabase client or initializes a default instance.
   */
  public async getClient(): Promise<SupabaseClient> {
    if (!this.client) {
      await this.initClient();
    }
    return this.client!;
  }

  // ==========================================================================
  // Configuration Storage
  // ==========================================================================

  public async loadCloudConfig(): Promise<CloudConfig> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const data = await chrome.storage.local.get([STORAGE_KEY_CONFIG]);
        if (data[STORAGE_KEY_CONFIG]) {
          return data[STORAGE_KEY_CONFIG] as CloudConfig;
        }
      }
    } catch (e) {
      console.error('[Imhotep:Supabase] Error loading cloud config:', e);
    }

    return {
      supabaseUrl: DEFAULT_SUPABASE_URL,
      supabaseAnonKey: DEFAULT_SUPABASE_ANON_KEY,
      enabled: true,
    };
  }

  public async saveCloudConfig(config: CloudConfig): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY_CONFIG]: config });
    }
    await this.initClient(config);
  }

  // ==========================================================================
  // Authentication
  // ==========================================================================

  public async signUp(email: string, password: string):Promise<{ user: User | null; session: Session | null; error: Error | null }> {
    const client = await this.getClient();
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) {
      return { user: null, session: null, error };
    }
    return { user: data.user, session: data.session, error: null };
  }

  public async signIn(email: string, password: string): Promise<{ user: User | null; session: Session | null; error: Error | null }> {
    const client = await this.getClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      return { user: null, session: null, error };
    }
    return { user: data.user, session: data.session, error: null };
  }

  public async signOut(): Promise<{ error: Error | null }> {
    const client = await this.getClient();
    await this.unsubscribeAll();
    const { error } = await client.auth.signOut();
    return { error };
  }

  public async getCurrentSession(): Promise<Session | null> {
    const client = await this.getClient();
    const { data } = await client.auth.getSession();
    return data.session;
  }

  public async getCurrentUser(): Promise<User | null> {
    const client = await this.getClient();
    const { data } = await client.auth.getUser();
    return data.user;
  }

  public async onAuthStateChange(
    callback: (event: AuthChangeEvent, session: Session | null) => void
  ): Promise<{ unsubscribe: () => void }> {
    const client = await this.getClient();
    const { data } = client.auth.onAuthStateChange(callback);
    return { unsubscribe: () => data.subscription.unsubscribe() };
  }

  // ==========================================================================
  // Profiles (E2EE Salt & Metadata)
  // ==========================================================================

  public async getProfile(userId: string): Promise<UserProfileRecord | null> {
    const client = await this.getClient();
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[Imhotep:Supabase] getProfile error:', error);
      throw error;
    }
    return data as UserProfileRecord | null;
  }

  public async upsertProfile(
    profile: Partial<UserProfileRecord> & { user_id: string; salt: string }
  ): Promise<UserProfileRecord> {
    const client = await this.getClient();
    const { data, error } = await client
      .from('profiles')
      .upsert(
        {
          user_id: profile.user_id,
          salt: profile.salt,
          device_count: profile.device_count ?? 1,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('[Imhotep:Supabase] upsertProfile error:', error);
      throw error;
    }
    return data as UserProfileRecord;
  }

  // ==========================================================================
  // Devices Management
  // ==========================================================================

  public async registerDevice(device: DeviceRecord): Promise<DeviceRecord> {
    const client = await this.getClient();
    const { data, error } = await client
      .from('devices')
      .upsert(
        {
          id: device.id,
          user_id: device.user_id,
          device_name: device.device_name,
          device_type: device.device_type,
          last_seen: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .select()
      .single();

    if (error) {
      console.error('[Imhotep:Supabase] registerDevice error:', error);
      throw error;
    }
    return data as DeviceRecord;
  }

  public async updateDeviceHeartbeat(deviceId: string): Promise<void> {
    const client = await this.getClient();
    const { error } = await client
      .from('devices')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', deviceId);

    if (error) {
      console.warn('[Imhotep:Supabase] updateDeviceHeartbeat warning:', error);
    }
  }

  public async getDevices(userId: string): Promise<DeviceRecord[]> {
    const client = await this.getClient();
    const { data, error } = await client
      .from('devices')
      .select('*')
      .eq('user_id', userId)
      .order('last_seen', { ascending: false });

    if (error) {
      console.error('[Imhotep:Supabase] getDevices error:', error);
      throw error;
    }
    return (data || []) as DeviceRecord[];
  }

  public async deleteDevice(deviceId: string): Promise<void> {
    const client = await this.getClient();
    const { error } = await client.from('devices').delete().eq('id', deviceId);
    if (error) {
      console.error('[Imhotep:Supabase] deleteDevice error:', error);
      throw error;
    }
  }

  // ==========================================================================
  // History Sync Operations
  // ==========================================================================

  public async uploadHistoryBatch(records: HistorySyncRecord[]): Promise<HistorySyncRecord[]> {
    if (records.length === 0) return [];

    const client = await this.getClient();
    const payload = records.map((r) => ({
      user_id: r.user_id,
      device_id: r.device_id,
      encrypted_payload: r.encrypted_payload,
      payload_iv: r.payload_iv,
      visit_timestamp: r.visit_timestamp,
    }));

    const { data, error } = await client
      .from('history_sync')
      .insert(payload)
      .select();

    if (error) {
      console.error('[Imhotep:Supabase] uploadHistoryBatch error:', error);
      throw error;
    }
    return (data || []) as HistorySyncRecord[];
  }

  public async fetchRemoteHistory(
    userId: string,
    sinceIsoTimestamp?: string,
    limit: number = 200
  ): Promise<HistorySyncRecord[]> {
    const client = await this.getClient();
    let query = client
      .from('history_sync')
      .select('*')
      .eq('user_id', userId)
      .order('visit_timestamp', { ascending: false })
      .limit(limit);

    if (sinceIsoTimestamp) {
      query = query.gt('visit_timestamp', sinceIsoTimestamp);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[Imhotep:Supabase] fetchRemoteHistory error:', error);
      throw error;
    }
    return (data || []) as HistorySyncRecord[];
  }

  // ==========================================================================
  // Extension Sync Operations
  // ==========================================================================

  public async uploadExtensionSync(record: ExtensionSyncRecord): Promise<ExtensionSyncRecord> {
    const client = await this.getClient();
    const { data, error } = await client
      .from('extension_sync')
      .upsert(
        {
          user_id: record.user_id,
          device_id: record.device_id,
          encrypted_payload: record.encrypted_payload,
          payload_iv: record.payload_iv,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,device_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('[Imhotep:Supabase] uploadExtensionSync error:', error);
      throw error;
    }
    return data as ExtensionSyncRecord;
  }

  public async fetchExtensionSync(userId: string): Promise<ExtensionSyncRecord[]> {
    const client = await this.getClient();
    const { data, error } = await client
      .from('extension_sync')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      console.error('[Imhotep:Supabase] fetchExtensionSync error:', error);
      throw error;
    }
    return (data || []) as ExtensionSyncRecord[];
  }

  // ==========================================================================
  // Realtime Subscriptions
  // ==========================================================================

  public async subscribeToHistorySync(
    userId: string,
    onInsert: (record: HistorySyncRecord) => void
  ): Promise<RealtimeChannel> {
    const client = await this.getClient();
    const channelName = `realtime:history_sync:${userId}`;

    // Remove existing if any
    await this.unsubscribeChannel(channelName);

    const channel = client
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'history_sync',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.new) {
            onInsert(payload.new as HistorySyncRecord);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Imhotep:Realtime] Subscribed to history_sync for user ${userId}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.warn(`[Imhotep:Realtime] Channel error on history_sync for user ${userId}`);
        }
      });

    this.activeChannels.set(channelName, channel);
    return channel;
  }

  public async subscribeToExtensionSync(
    userId: string,
    onUpdate: (record: ExtensionSyncRecord) => void
  ): Promise<RealtimeChannel> {
    const client = await this.getClient();
    const channelName = `realtime:extension_sync:${userId}`;

    await this.unsubscribeChannel(channelName);

    const channel = client
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'extension_sync',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.new) {
            onUpdate(payload.new as ExtensionSyncRecord);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Imhotep:Realtime] Subscribed to extension_sync for user ${userId}`);
        }
      });

    this.activeChannels.set(channelName, channel);
    return channel;
  }

  public async unsubscribeChannel(channelName: string): Promise<void> {
    const channel = this.activeChannels.get(channelName);
    if (channel && this.client) {
      await this.client.removeChannel(channel);
      this.activeChannels.delete(channelName);
    }
  }

  public async unsubscribeAll(): Promise<void> {
    if (this.client) {
      for (const [name, channel] of this.activeChannels.entries()) {
        try {
          await this.client.removeChannel(channel);
        } catch {}
      }
      this.activeChannels.clear();
    }
  }
}

export const supabaseVault = new SupabaseVaultService();
export default supabaseVault;
