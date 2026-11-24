/**
 * Clients Supabase.
 *
 * - `supabasePublic` (cle anon) : verification des jetons d'acces uniquement.
 * - `supabaseAdmin` (cle service) : administration des comptes et taches
 *   privilegiees. Ne doit jamais quitter le backend.
 */
import { createClient } from '@supabase/supabase-js';
import configuration from './environnement.js';

const options = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};

export const supabasePublic =
  configuration.supabase.url && configuration.supabase.cleAnon
    ? createClient(configuration.supabase.url, configuration.supabase.cleAnon, options)
    : null;

export const supabaseAdmin =
  configuration.supabase.url && configuration.supabase.cleService
    ? createClient(configuration.supabase.url, configuration.supabase.cleService, options)
    : null;

export function supabaseDisponible() {
  return Boolean(
    configuration.supabase.url &&
      configuration.supabase.cleAnon &&
      configuration.supabase.cleService,
  );
}

export default { supabasePublic, supabaseAdmin, supabaseDisponible };
