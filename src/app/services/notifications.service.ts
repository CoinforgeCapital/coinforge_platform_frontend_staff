import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { ApiService, AppNotification } from './api.service';

const STORAGE_KEY = 'cf_staff_notifications';

/**
 * Centro de notificaciones del staff. El backend es la fuente persistente; localStorage
 * queda como cache local para evitar una campana vacia mientras se hidrata la sesion.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly api = inject(ApiService);
  private readonly max = environment.notificationsMaxItems ?? 50;
  private readonly _items = signal<AppNotification[]>(this.load());

  readonly items = this._items.asReadonly();
  readonly unreadCount = computed(() => this._items().reduce((total, n) => (
    n.readAt ? total : total + Math.max(1, n.unreadCount ?? 1)
  ), 0));
  readonly hasUnread = computed(() => this.unreadCount() > 0);
  readonly badgeLabel = computed(() => {
    const count = this.unreadCount();
    return count > 99 ? '99+' : String(count);
  });

  /** Nº de no leídas de un tipo concreto (p. ej. para badges de sección). */
  unreadCountByType(type: string): number {
    return this._items().reduce((total, n) => {
      if (n.type !== type || n.readAt) return total;
      return total + Math.max(1, n.unreadCount ?? 1);
    }, 0);
  }

  async hydrate(): Promise<void> {
    try {
      const response = await this.api.listNotifications(1, this.max);
      this._items.set(response.notifications ?? []);
      this.persist(this._items());
    } catch {
      /* Si el backend no esta disponible, mantenemos la cache local existente. */
    }
  }

  push(item: AppNotification): void {
    this.mutate((list) => [item, ...list.filter((n) => n.id !== item.id)].slice(0, this.max));
  }

  markRead(id: string): void {
    const now = new Date().toISOString();
    this.mutate((list) => list.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? now } : n)));
    void this.api.markNotificationRead(id).catch(() => undefined);
  }

  markAllRead(): void {
    const now = new Date().toISOString();
    this.mutate((list) => list.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    void this.api.markAllNotificationsRead().catch(() => undefined);
  }

  markTypeRead(type: string): void {
    const now = new Date().toISOString();
    this.mutate((list) => list.map((n) => (n.type === type && !n.readAt ? { ...n, readAt: now } : n)));
    void this.api.markNotificationTypeRead(type).catch(() => undefined);
  }

  clear(): void {
    this._items.set([]);
    this.persist([]);
    void this.api.clearNotifications().catch(() => undefined);
  }

  clearLocal(): void {
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
