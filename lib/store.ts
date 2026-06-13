import { promises as fs } from "fs";
import path from "path";

/**
 * Thin key-value storage adapter. Supabase when SUPABASE_URL/SUPABASE_ANON_KEY
 * are set (expects a `kv` table: key text primary key, value jsonb), local
 * JSON file otherwise. Later features reuse this.
 */
export interface Store {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

const DATA_FILE = path.join(process.cwd(), ".data", "store.json");

const jsonFileStore: Store = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      return (data[key] as T) ?? null;
    } catch {
      return null;
    }
  },
  async set<T>(key: string, value: T): Promise<void> {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    } catch {
      // first write
    }
    data[key] = value;
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
  },
};

function supabaseStore(url: string, anonKey: string): Store {
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/kv`;
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "Content-Type": "application/json",
  };
  return {
    async get<T>(key: string): Promise<T | null> {
      const res = await fetch(
        `${endpoint}?key=eq.${encodeURIComponent(key)}&select=value`,
        { headers, cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Supabase get failed: ${res.status}`);
      const rows = (await res.json()) as { value: T }[];
      return rows[0]?.value ?? null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) throw new Error(`Supabase set failed: ${res.status}`);
    },
  };
}

export function getStore(): Store {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    return supabaseStore(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return jsonFileStore;
}
