import { inject, Injectable } from '@angular/core';
import { Subscription } from 'rxjs';

import { NotificationsService } from './notifications.service';
import { RealtimeService } from './realtime.service';

/**
 * Conecta el socket con el centro de notificaciones del staff. Las notificaciones son
 * temporales y viven en localStorage; aquí solo conectamos realtime y empujamos eventos.
 */
@Injectable({ providedIn: 'root' })
export class NotificationCenterService {
  private readonly realtime = inject(RealtimeService);
  private readonly notifications = inject(NotificationsService);

  private subscription?: Subscription;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;

    this.realtime.connect();
    this.subscription = this.realtime.notificationCreated$.subscribe((notification) => {
      this.notifications.push(notification);
    });
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    this.started = false;
    this.realtime.disconnect();
    this.notifications.clear();
  }
}
