import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppNotification } from '../../services/api.service';
import { NotificationsService } from '../../services/notifications.service';

/**
 * Campana de notificaciones del topbar. Consume el centro de notificaciones genérico
 * (NotificationsService) y navega al pulsar cada una. Reutilizable para futuros tipos.
 */
@Component({
  selector: 'app-notifications-bell',
  standalone: true,
  template: `
    <div class="bell-wrap">
      <button
        type="button"
        class="bell-btn"
        [class.has-unread]="hasUnread()"
        (click)="toggle()"
        aria-label="Notifications"
        title="Notifications"
      >
        <i class="pi pi-bell" aria-hidden="true"></i>
        @if (hasUnread()) {
          <span class="bell-badge">{{ badgeLabel() }}</span>
        }
      </button>

      @if (open()) {
        <div class="bell-backdrop" (click)="close()"></div>
        <div class="bell-panel" role="menu">
          <header class="bell-head">
            <strong>Notifications</strong>
            @if (items().length) {
              <span class="bell-head-actions">
                <button type="button" (click)="markAllRead()">Mark all read</button>
                <button type="button" (click)="clearAll()">Clear</button>
              </span>
            }
          </header>

          <div class="bell-list cf-scroll">
            @for (n of items(); track n.id) {
              <button type="button" class="bell-item" [class.is-unread]="!n.readAt" (click)="openItem(n)">
                <span class="bell-item-icon"><i [class]="iconOf(n)" aria-hidden="true"></i></span>
                <span class="bell-item-body">
                  <span class="bell-item-title">{{ n.title }}</span>
                  @if ((n.unreadCount ?? 1) > 1 && !n.readAt) {
                    <span class="bell-item-count">{{ n.unreadCount }} updates</span>
                  }
                  @if (n.body) {
                    <span class="bell-item-text">{{ n.body }}</span>
                  }
                  <span class="bell-item-time">{{ timeAgo(n.createdAt) }}</span>
                </span>
                @if (!n.readAt) {
                  <span class="bell-dot" aria-hidden="true"></span>
                }
              </button>
            } @empty {
              <div class="bell-empty">
                <i class="pi pi-bell-slash" aria-hidden="true"></i>
                <span>No notifications yet.</span>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
    .bell-wrap { position: relative; }

    .bell-btn {
      position: relative;
      width: 42px;
      height: 42px;
      display: inline-grid;
      place-items: center;
      border: 1px solid var(--cf-border);
      border-radius: 11px;
      background: var(--cf-surface);
      color: var(--cf-text);
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease;
    }
    .bell-btn:hover { border-color: rgba(0, 184, 150, 0.5); color: var(--cf-teal-600); }
    .bell-btn.has-unread { color: var(--cf-teal-600); }
    .bell-btn i { font-size: 1.1rem; }

    .bell-badge {
      position: absolute;
      top: -6px;
      right: -6px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      background: var(--cf-danger, #e14b4b);
      color: #fff;
      font-size: 0.66rem;
      font-weight: 800;
      box-shadow: 0 0 0 2px var(--cf-surface);
    }

    .bell-backdrop {
      position: fixed;
      inset: 0;
      z-index: 40;
    }

    .bell-panel {
      position: absolute;
      right: 0;
      top: calc(100% + 8px);
      width: 360px;
      max-width: 86vw;
      z-index: 50;
      border: 1px solid var(--cf-border);
      border-radius: var(--cf-radius);
      background: var(--cf-surface);
      box-shadow: var(--cf-shadow-lg, 0 18px 50px rgba(15, 27, 42, 0.18));
      overflow: hidden;
    }

    .bell-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--cf-border);
      background: var(--cf-surface-2);
    }
    .bell-head strong { color: var(--cf-text); font-size: 0.95rem; }
    .bell-head-actions { display: inline-flex; gap: 6px; }
    .bell-head-actions button {
      border: 0;
      background: transparent;
      color: var(--cf-text-muted);
      font: inherit;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
      padding: 2px 4px;
    }
    .bell-head-actions button:hover { color: var(--cf-teal-600); }

    .bell-list { max-height: 60vh; overflow-y: auto; }

    .bell-item {
      width: 100%;
      display: flex;
      align-items: flex-start;
      gap: 11px;
      padding: 12px 14px;
      border: 0;
      border-bottom: 1px solid var(--cf-border);
      background: transparent;
      text-align: left;
      cursor: pointer;
    }
    .bell-item:last-child { border-bottom: 0; }
    .bell-item:hover { background: var(--cf-surface-2); }
    .bell-item.is-unread { background: rgba(0, 212, 170, 0.06); }

    .bell-item-icon {
      flex: none;
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      border-radius: 9px;
      background: rgba(0, 212, 170, 0.12);
      color: var(--cf-teal-600);
    }
    .bell-item-body { display: grid; gap: 2px; min-width: 0; flex: 1; }
    .bell-item-title { color: var(--cf-text); font-weight: 700; font-size: 0.88rem; }
    .bell-item-count {
      width: max-content;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(0, 212, 170, 0.13);
      color: var(--cf-teal-700, #008d77);
      font-size: 0.7rem;
      font-weight: 800;
    }
    .bell-item-text {
      color: var(--cf-text-muted);
      font-size: 0.82rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bell-item-time { color: var(--cf-text-muted); font-size: 0.72rem; }

    .bell-dot {
      flex: none;
      width: 8px;
      height: 8px;
      margin-top: 6px;
      border-radius: 50%;
      background: var(--cf-teal-500);
    }

    .bell-empty {
      display: grid;
      justify-items: center;
      gap: 8px;
      padding: 34px 16px;
      color: var(--cf-text-muted);
    }
    .bell-empty i { font-size: 1.6rem; color: var(--cf-text-muted); }
    .bell-empty span { font-weight: 600; font-size: 0.88rem; }
    `,
  ],
})
export class NotificationsBellComponent {
  private readonly notifications = inject(NotificationsService);
  private readonly router = inject(Router);

  readonly open = signal(false);
  readonly items = this.notifications.items;
  readonly hasUnread = this.notifications.hasUnread;
  readonly badgeLabel = this.notifications.badgeLabel;

  toggle(): void {
    this.open.update((value) => !value);
  }

  close(): void {
    this.open.set(false);
  }

  markAllRead(): void {
    this.notifications.markAllRead();
  }

  clearAll(): void {
    this.notifications.clear();
  }

  openItem(notification: AppNotification): void {
    this.notifications.markRead(notification.id);
    this.close();
    const link = notification.meta?.['link'];
    if (typeof link === 'string') {
      const conversationId = notification.meta?.['conversationId'];
      if (typeof conversationId === 'string') {
        void this.router.navigate([link], { queryParams: { conversation: conversationId } });
        return;
      }
      void this.router.navigateByUrl(link);
    }
  }

  iconOf(notification: AppNotification): string {
    const icons: Record<string, string> = {
      internal_message: 'pi pi-comments',
      action_request: 'pi pi-send',
      requirement_submitted: 'pi pi-verified',
    };
    return icons[notification.type] ?? 'pi pi-bell';
  }

  timeAgo(value?: string | null): string {
    if (!value) return '';
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return '';
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }
}
