import { computed, Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

/** Notificación genérica mostrada en la campana del topbar. */
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  meta?: Record<string, unknown> | null;
  readAt?: string | null;
  createdAt?: string;
}

const STORAGE_KEY = 'cf_staff_notifications';

/**
 * Centro de notificaciones del staff. Misma forma que el frontend client: guarda en
 * localStorage el payload temporal recibido por socket y marca lectura con `readAt`.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly max = environment.notificationsMaxItems ?? 50;
  private readonly _items = signal<AppNotification[]>(this.load());

  readonly items = this._items.asReadonly();
  readonly unreadCount = computed(() => this._items().filter((n) => !n.readAt).length);
  readonly hasUnread = computed(() => this.unreadCount() > 0);
  readonly badgeLabel = computed(() => {
    const count = this.unreadCount();
    return count > 99 ? '99+' : String(count);
  });

  /** Nº de no leídas de un tipo concreto (p. ej. para badges de sección). */
  unreadCountByType(type: string): number {
    return this._items().filter((n) => n.type === type && !n.readAt).length;
  }

  push(item: AppNotification): void {
    this.mutate((list) => [item, ...list.filter((n) => n.id !== item.id)].slice(0, this.max));
  }

  markRead(id: string): void {
    const now = new Date().toISOString();
    this.mutate((list) => list.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? now } : n)));
  }

  markAllRead(): void {
    const now = new Date().toISOString();
    this.mutate((list) => list.map((n) => (n.readAt ? n : { ...n, readAt: now })));
  }

  markTypeRead(type: string): void {
    const now = new Date().toISOString();
    this.mutate((list) => list.map((n) => (n.type === type && !n.readAt ? { ...n, readAt: now } : n)));
  }

  clear(): void {
    this._items.set([]);
    this.persist([]);
  }

  private mutate(fn: (list: AppNotification[]) => AppNotification[]): void {
    const next = fn(this._items());
    this._items.set(next);
    this.persist(next);
  }

  private load(): AppNotification[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as AppNotification[]).slice(0, this.max) : [];
    } catch {
      return [];
    }
  }

  private persist(items: AppNotification[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* localStorage lleno o no disponible: lo ignoramos */
    }
  }
}
