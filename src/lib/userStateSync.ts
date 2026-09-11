import { emptyState, type AppState } from "./storage";
import { applyAccount, decideOnLoad, isMilestone, parseUserStateRow, persistedKey, toUserStateWrite, type UserStateWrite } from "./userState";
import { messageOf, type UserStateStore, type LoadResult, type WriteResult } from "./userStateStore";

/**
 * Keeps one signed-in student's app state in step with their Supabase row. Framework-free so it
 * can be tested against a real database; `UserStateProvider` is the React glue.
 *
 * The rules:
 * - Nothing is written before the row has been read, so a slow or failed read can never
 *   overwrite a good account copy with an empty or stale device.
 * - A device copy that belongs to another account is discarded before anything is shown.
 * - On load the account's copy wins, unless the device has unconfirmed changes newer than the
 *   row, or the device has a schedule and the row does not (a device from before accounts).
 * - Preference changes are saved after a pause; finishing onboarding and replacing the schedule
 *   are saved at once. Gap answers, reminders and UI state never trigger a save.
 * - A failed read or save changes nothing on the device. The student can retry, or carry on
 *   locally; unconfirmed changes are uploaded after the next successful read.
 */

export type AccountStatus = "loading" | "ready" | "error" | "offline";

export interface AccountSnapshot {
  status: AccountStatus;
  loadError?: string;
  saveError?: string;
  saving: boolean;
}

export interface LocalStateAccess {
  get(): AppState;
  set(next: AppState): void;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface UserStateSyncOptions {
  store: UserStateStore;
  userId: string;
  local: LocalStateAccess;
  onSnapshot?: (snapshot: AccountSnapshot) => void;
  debounceMs?: number;
  now?: () => Date;
  timers?: Timers;
}

export interface UserStateSync {
  /** Read the account row and reconcile the device with it. */
  load(): Promise<void>;
  /** Call after every change to the local state. Cheap when nothing that is saved has changed. */
  notify(): void;
  /** Save any pending change now (before signing out, or when the page is hidden). */
  flush(): Promise<void>;
  /** Try again after a failed read or save. */
  retry(): Promise<void>;
  /** After a failed read: use the device's copy and keep changes for a later upload. */
  continueOffline(): void;
  /** Delete the account row ("Delete everything"). Resolves false if the delete failed. */
  forget(): Promise<boolean>;
  dispose(): void;
  snapshot(): AccountSnapshot;
}

export const SAVE_DEBOUNCE_MS = 1200;

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createUserStateSync(o: UserStateSyncOptions): UserStateSync {
  const timers = o.timers ?? realTimers;
  const now = o.now ?? (() => new Date());
  const debounceMs = o.debounceMs ?? SAVE_DEBOUNCE_MS;

  let snap: AccountSnapshot = { status: "loading", saving: false };
  /** The saved-state key the account row is known to hold; undefined when unknown. */
  let confirmedKey: string | undefined;
  let confirmedWrite: UserStateWrite | undefined;
  /** The last local key seen, to tell the student's edits from nothing having changed. */
  let observedKey: string | undefined;
  let timer: unknown;
  let queue: Promise<void> = Promise.resolve();
  let loadSeq = 0;
  let disposed = false;

  const emit = (patch: Partial<AccountSnapshot>) => {
    snap = { ...snap, ...patch };
    if (!disposed) o.onSnapshot?.(snap);
  };
  const cancelTimer = () => {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
  };
  /** Every change this controller makes to the device, so it is never mistaken for the student's. */
  const setLocal = (next: AppState) => {
    observedKey = persistedKey(next);
    o.local.set(next);
  };
  const markDirty = (state: AppState) => {
    if (state.sync?.dirtySince) return;
    setLocal({ ...state, sync: { ownerId: state.sync?.ownerId ?? o.userId, dirtySince: now().toISOString() } });
  };
  const clearDirty = () => {
    const state = o.local.get();
    if (state.sync?.dirtySince) setLocal({ ...state, sync: { ownerId: state.sync.ownerId ?? o.userId } });
  };
  const scheduleSave = (ms: number) => {
    cancelTimer();
    timer = timers.set(() => { timer = undefined; void save(); }, ms);
  };

  function save(): Promise<void> {
    queue = queue.then(async () => {
      if (disposed || snap.status !== "ready") return;
      const state = o.local.get();
      const key = persistedKey(state);
      if (key === confirmedKey) { clearDirty(); return; }
      const write = toUserStateWrite(o.userId, state);
      emit({ saving: true });
      let res: WriteResult;
      try { res = await o.store.save(write); } catch (e) { res = { ok: false, message: messageOf(e) }; }
      if (disposed) return;
      if (!res.ok) { emit({ saving: false, saveError: res.message }); return; }
      confirmedKey = key;
      confirmedWrite = write;
      emit({ saving: false, saveError: undefined });
      if (persistedKey(o.local.get()) === key) clearDirty();
      else scheduleSave(debounceMs);
    });
    return queue;
  }

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    cancelTimer();
    emit({ status: "loading", loadError: undefined });

    const before = o.local.get();
    if (before.sync?.ownerId && before.sync.ownerId !== o.userId) {
      // Another account's copy: never shown to this one, never uploaded as this one's.
      setLocal({ ...emptyState(), sync: { ownerId: o.userId } });
    } else {
      observedKey = persistedKey(before);
    }

    let res: LoadResult;
    try { res = await o.store.load(o.userId); } catch (e) { res = { kind: "error", message: messageOf(e) }; }
    if (disposed || seq !== loadSeq) return;
    if (res.kind === "error") { emit({ status: "error", loadError: res.message }); return; }

    const local = o.local.get();
    const account = res.kind === "found" ? parseUserStateRow(res.row) : undefined;
    const decision = decideOnLoad(local, account);

    if (decision === "HYDRATE" && account) {
      const next = applyAccount(local, account, o.userId);
      setLocal(next);
      confirmedKey = persistedKey(next);
      confirmedWrite = toUserStateWrite(o.userId, next);
    } else {
      if (local.sync?.ownerId !== o.userId) setLocal({ ...local, sync: { ...local.sync, ownerId: o.userId } });
      else observedKey = persistedKey(local);
      // KEEP: treat the device as matching the account, so an empty or unusable row is not
      // overwritten until the student actually does something.
      confirmedKey = decision === "UPLOAD" ? undefined : persistedKey(o.local.get());
      confirmedWrite = undefined;
    }
    emit({ status: "ready", saveError: undefined });
    if (decision === "UPLOAD") await save();
  }

  function notify(): void {
    if (disposed) return;
    const state = o.local.get();
    const key = persistedKey(state);
    if (key === observedKey) return;
    const firstSighting = observedKey === undefined;
    observedKey = key;
    if (firstSighting && snap.status === "loading") return;
    if (key === confirmedKey) { cancelTimer(); clearDirty(); return; }
    markDirty(state);
    if (snap.status !== "ready") return;
    scheduleSave(isMilestone(confirmedWrite, toUserStateWrite(o.userId, state)) ? 0 : debounceMs);
  }

  async function flush(): Promise<void> {
    cancelTimer();
    if (snap.status === "ready" && persistedKey(o.local.get()) !== confirmedKey) return save();
    return queue;
  }

  async function retry(): Promise<void> {
    if (snap.status === "error" || snap.status === "offline") return load();
    if (snap.saveError) return save();
    return queue;
  }

  function continueOffline(): void {
    if (snap.status === "error") emit({ status: "offline" });
  }

  async function forget(): Promise<boolean> {
    // The device is being emptied, and that empty state is not something to upload. Marked
    // before waiting so the reset's own change notification schedules nothing, and again after,
    // because a save that was already in flight records its key when it finishes.
    const emptyKey = persistedKey({ ...emptyState(), sync: { ownerId: o.userId } });
    const holdEmpty = () => { cancelTimer(); confirmedKey = emptyKey; confirmedWrite = undefined; };
    holdEmpty();
    await queue; // an in-flight save must land before the delete, or it would recreate the row
    holdEmpty();
    let res: WriteResult;
    try { res = await o.store.remove(o.userId); } catch (e) { res = { ok: false, message: messageOf(e) }; }
    if (disposed) return res.ok;
    if (!res.ok) {
      confirmedKey = undefined;
      emit({ saveError: res.message });
      return false;
    }
    emit({ saveError: undefined });
    return true;
  }

  return {
    load,
    notify,
    flush,
    retry,
    continueOffline,
    forget,
    dispose: () => { disposed = true; cancelTimer(); },
    snapshot: () => snap,
  };
}
