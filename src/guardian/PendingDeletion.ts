/**
 * Offline-safe server deletion (V1.1 Phase 1 release gate).
 *
 * Problem: turning sharing off used to stop local tracking and fire the
 * server purge in the same breath. Offline, the purge silently never
 * happened and the UI kept implying the server copies were gone.
 *
 * Design — a persisted privacy state machine:
 *
 *   none ──requestDeletion()──▶ pending ──RPC success──▶ confirmed
 *                                  │  ▲
 *                                  └──┴── RPC failure (retry)
 *
 * Rules:
 * - The pending record is written to SecureStore BEFORE any network
 *   attempt, whenever sharing is disabled or the last guardian is
 *   revoked. It survives restarts and is reloaded at init.
 * - `confirmed` is assigned in EXACTLY ONE place in this file: the
 *   success branch of the deletion executor, after the purge RPC has
 *   actually resolved. No failure path can reach it.
 * - A pending deletion is NEVER silently dropped. Turning sharing back
 *   on does not clear it: it executes first on the next successful
 *   contact (the server purge deletes points stored up to that moment),
 *   and only its own success removes it.
 * - Retries are app-activity-driven (no netinfo / no background jobs —
 *   no new native deps): app launch (init), AppState foreground,
 *   guardian-screen mount, and an explicit "Retry now" button all call
 *   attemptDeletion(). While the guardian backend is not configured,
 *   attempts are skipped without consuming the retry counter — there is
 *   simply no server to delete from yet.
 *
 * The purge RPC is the existing one: set_sharing_enabled(false) deletes
 * the caller's location_points + latest_locations server-side. For the
 * 'last-guardian-revoked' reason the executor first re-drives
 * revoke_link(linkId) (idempotent) so access is cut even when the
 * original revoke happened offline, then runs the same purge.
 */
import type { GuardianService } from './GuardianService';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type PendingDeletionReason = 'sharing-disabled' | 'last-guardian-revoked';

export interface PendingDeletionRecord {
  requestedAt: string; // ISO
  reason: PendingDeletionReason;
  attempts: number;
  linkId: string | null;
}

export type DeletionState = 'none' | 'pending' | 'confirmed';

export interface DeletionStatus {
  state: DeletionState;
  requestedAt: string | null;
  confirmedAt: string | null;
  attempts: number;
  reason: PendingDeletionReason | null;
}

export const PENDING_DELETION_KEY = 'basera.guardian.pendingDeletion.v1';
export const DELETION_CONFIRMED_AT_KEY = 'basera.guardian.deletionConfirmedAt.v1';

const NONE_STATUS: DeletionStatus = {
  state: 'none',
  requestedAt: null,
  confirmedAt: null,
  attempts: 0,
  reason: null,
};

/** Default storage: expo-secure-store (lazy require; failures degrade to
 *  "nothing persisted" so a storage fault can never block a local stop
 *  or an immediate deletion attempt). */
function secureStoreStorage(): KeyValueStorage {
  const load = (): {
    getItemAsync(k: string): Promise<string | null>;
    setItemAsync(k: string, v: string): Promise<void>;
    deleteItemAsync(k: string): Promise<void>;
  } | null => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('expo-secure-store');
    } catch {
      return null;
    }
  };
  return {
    async getItem(key) {
      try {
        return (await load()?.getItemAsync(key)) ?? null;
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      try {
        await load()?.setItemAsync(key, value);
      } catch {
        // best-effort persistence; the in-memory record still drives retries
      }
    },
    async removeItem(key) {
      try {
        await load()?.deleteItemAsync(key);
      } catch {
        // best-effort, see setItem
      }
    },
  };
}

function parseRecord(raw: string | null): PendingDeletionRecord | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PendingDeletionRecord>;
    if (typeof p.requestedAt !== 'string' || typeof p.attempts !== 'number') return null;
    if (p.reason !== 'sharing-disabled' && p.reason !== 'last-guardian-revoked') return null;
    return {
      requestedAt: p.requestedAt,
      reason: p.reason,
      attempts: p.attempts,
      linkId: typeof p.linkId === 'string' ? p.linkId : null,
    };
  } catch {
    return null;
  }
}

export class PendingDeletionManager {
  private record: PendingDeletionRecord | null = null;
  private status: DeletionStatus = { ...NONE_STATUS };
  private loaded = false;
  private attemptInFlight: Promise<DeletionStatus> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private guardian: GuardianService,
    private storage: KeyValueStorage = secureStoreStorage(),
    private now: () => Date = () => new Date(),
  ) {}

  getStatus(): DeletionStatus {
    return this.status;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: DeletionStatus): void {
    this.status = status;
    for (const l of this.listeners) l();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const raw = await this.storage.getItem(PENDING_DELETION_KEY).catch(() => null);
    const record = parseRecord(raw);
    if (record) {
      this.record = record;
      this.setStatus({
        state: 'pending',
        requestedAt: record.requestedAt,
        confirmedAt: null,
        attempts: record.attempts,
        reason: record.reason,
      });
      return;
    }
    const confirmedAt = await this.storage.getItem(DELETION_CONFIRMED_AT_KEY).catch(() => null);
    if (confirmedAt) {
      this.setStatus({ ...NONE_STATUS, state: 'confirmed', confirmedAt });
    }
  }

  /**
   * App-launch entry point: reload the persisted obligation and, if one
   * is pending, try to execute it right away.
   */
  async init(): Promise<DeletionStatus> {
    await this.ensureLoaded();
    if (this.record) return this.attemptDeletion();
    return this.status;
  }

  /**
   * Record a deletion obligation and try to execute it. The record is
   * persisted BEFORE the network attempt. Never throws for network
   * reasons — failure is reported as state 'pending'.
   */
  async requestDeletion(
    reason: PendingDeletionReason,
    linkId: string | null = null,
  ): Promise<DeletionStatus> {
    await this.ensureLoaded();
    if (this.record) {
      // An obligation already exists: keep the earliest request time and
      // retry count, attach the link id if newly known. Never dropped.
      if (linkId && !this.record.linkId) this.record.linkId = linkId;
    } else {
      this.record = { requestedAt: this.now().toISOString(), reason, attempts: 0, linkId };
      // A new obligation supersedes any earlier confirmation display.
      await this.storage.removeItem(DELETION_CONFIRMED_AT_KEY).catch(() => undefined);
    }
    await this.persist();
    this.setStatus({
      state: 'pending',
      requestedAt: this.record.requestedAt,
      confirmedAt: null,
      attempts: this.record.attempts,
      reason: this.record.reason,
    });
    return this.attemptDeletion();
  }

  /**
   * Execute the pending deletion against the server. Safe to call from
   * any retry trigger; concurrent calls share one attempt.
   */
  async attemptDeletion(): Promise<DeletionStatus> {
    await this.ensureLoaded();
    if (!this.record) return this.status;
    if (!this.guardian.isConfigured()) {
      // No backend configured: nothing to delete from yet, and this does
      // not count as a failed attempt.
      return this.status;
    }
    if (this.attemptInFlight) return this.attemptInFlight;
    const run = this.executeDeletion();
    this.attemptInFlight = run;
    try {
      return await run;
    } finally {
      if (this.attemptInFlight === run) this.attemptInFlight = null;
    }
  }

  private async persist(): Promise<void> {
    if (!this.record) return;
    await this.storage
      .setItem(PENDING_DELETION_KEY, JSON.stringify(this.record))
      .catch(() => undefined);
  }

  private async executeDeletion(): Promise<DeletionStatus> {
    const record = this.record;
    if (!record) return this.status;
    try {
      if (record.linkId) {
        // Re-drive the revocation itself: if the original revoke was
        // attempted offline it never reached the server. revoke_link is
        // idempotent, and once no active guardian remains it also purges.
        await this.guardian.revokeLink(record.linkId);
      }
      await this.guardian.setSharingEnabled(false);
    } catch {
      record.attempts += 1;
      await this.persist();
      this.setStatus({
        state: 'pending',
        requestedAt: record.requestedAt,
        confirmedAt: null,
        attempts: record.attempts,
        reason: record.reason,
      });
      return this.status;
    }
    // === SUCCESS — the ONLY place state 'confirmed' is ever assigned ===
    // The purge RPC resolved, so the server has acknowledged deletion.
    const confirmedAt = this.now().toISOString();
    const { requestedAt, attempts, reason } = record;
    this.record = null;
    await this.storage.removeItem(PENDING_DELETION_KEY).catch(() => undefined);
    await this.storage.setItem(DELETION_CONFIRMED_AT_KEY, confirmedAt).catch(() => undefined);
    this.setStatus({ state: 'confirmed', requestedAt, confirmedAt, attempts, reason });
    return this.status;
  }
}

/** Maps the deletion state to the honest server-side UI string key.
 *  'none' renders nothing — there is no server-copy claim to make. */
export function deletionServerMessageKey(
  status: DeletionStatus,
): 'guardianDeletionPending' | 'guardianDeletionConfirmed' | null {
  if (status.state === 'pending') return 'guardianDeletionPending';
  if (status.state === 'confirmed') return 'guardianDeletionConfirmed';
  return null;
}
