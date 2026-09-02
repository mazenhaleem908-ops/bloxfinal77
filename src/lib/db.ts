// Neon PostgreSQL access layer.
//
// Uses the Neon serverless HTTP driver, which works on Vercel (Node and Edge)
// without a persistent TCP connection pool.
//
// Required environment variable:
//   DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | undefined;

/** Lazily-created Neon SQL tag. Call inside request handlers only. */
export function db(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env["DATABASE_URL"];
    if (!url) {
      const message =
        "Missing DATABASE_URL. Set it to your Neon PostgreSQL connection string.";
      console.error(`[db] ${message}`);
      throw new Error(message);
    }
    _sql = neon(url);
  }
  return _sql;
}

let authSchemaReady: Promise<void> | undefined;

/**
 * Makes sure every table and function the app needs exists.
 *
 * db/schema.sql is still the source of truth, but on a production database
 * where it was never applied the auth tables were created here while `orders`
 * and `item_stock` were not — so login worked and every checkout failed with
 * "relation orders does not exist". This now provisions the full schema. It
 * runs once per warm serverless instance and is a no-op when everything is
 * already there.
 */
export async function ensureAuthSchema(): Promise<void> {
  if (!authSchemaReady) {
    const sql = db();
    authSchemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS auth_codes (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          email text NOT NULL,
          code text NOT NULL,
          expires_at timestamptz NOT NULL,
          attempts integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS auth_codes_email_idx ON auth_codes (email)`;
      await sql`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          token text PRIMARY KEY,
          email text NOT NULL,
          admin boolean NOT NULL DEFAULT false,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS auth_sessions_email_idx ON auth_sessions (email)`;
      // Google OAuth / OIDC: pending authorization requests (state + PKCE verifier).
      await sql`
        CREATE TABLE IF NOT EXISTS auth_oauth_states (
          state text PRIMARY KEY,
          code_verifier text NOT NULL,
          redirect_uri text NOT NULL,
          return_to text NOT NULL DEFAULT '/',
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      // Google OAuth / OIDC: one-time hand-off codes. The browser never sees a
      // session token in a URL; it exchanges this short-lived code for one.
      await sql`
        CREATE TABLE IF NOT EXISTS auth_login_codes (
          code text PRIMARY KEY,
          token text NOT NULL,
          email text NOT NULL,
          admin boolean NOT NULL DEFAULT false,
          name text,
          picture text,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS orders (
          code text PRIMARY KEY,
          intent_id text UNIQUE,
          status text NOT NULL DEFAULT 'pending_payment',
          paid boolean NOT NULL DEFAULT false,
          email text,
          roblox_user text,
          game text,
          items jsonb NOT NULL DEFAULT '[]'::jsonb,
          subtotal numeric(12,2) NOT NULL DEFAULT 0,
          fee numeric(12,2) NOT NULL DEFAULT 0,
          total numeric(12,2) NOT NULL DEFAULT 0,
          data jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS orders_email_idx ON orders (email)`;
      await sql`
        CREATE TABLE IF NOT EXISTS item_stock (
          item_id integer PRIMARY KEY,
          qty integer NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE OR REPLACE FUNCTION reserve_stock(p_items jsonb, p_default integer DEFAULT 12)
        RETURNS boolean
        LANGUAGE plpgsql
        AS $$
        DECLARE
          line jsonb;
          iid integer;
          need integer;
          have integer;
        BEGIN
          FOR line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
            iid := (line->>'id')::integer;
            need := GREATEST(1, COALESCE((line->>'q')::integer, 1));
            INSERT INTO item_stock(item_id, qty)
              VALUES (iid, p_default)
              ON CONFLICT (item_id) DO NOTHING;
            SELECT qty INTO have FROM item_stock WHERE item_id = iid FOR UPDATE;
            IF have IS NULL OR have < need THEN
              RAISE EXCEPTION 'out_of_stock:%', iid;
            END IF;
            UPDATE item_stock SET qty = qty - need, updated_at = now() WHERE item_id = iid;
          END LOOP;
          RETURN true;
        END;
        $$
      `;
      await sql`
        CREATE OR REPLACE FUNCTION release_stock(p_items jsonb)
        RETURNS boolean
        LANGUAGE plpgsql
        AS $$
        DECLARE
          line jsonb;
        BEGIN
          FOR line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
            UPDATE item_stock
               SET qty = qty + GREATEST(1, COALESCE((line->>'q')::integer, 1)), updated_at = now()
             WHERE item_id = (line->>'id')::integer;
          END LOOP;
          RETURN true;
        END;
        $$
      `;
    })().catch((error) => {
      authSchemaReady = undefined; // retry on the next request
      throw error;
    });
  }
  return authSchemaReady;
}


export type Row = Record<string, unknown>;
