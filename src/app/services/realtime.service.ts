import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, NgZone, PLATFORM_ID } from '@angular/core';
import { Subject } from 'rxjs';
import { io, type Socket } from 'socket.io-client';

import { environment } from '../../environments/environment';
import { AppNotification, UserState } from './api.service';

/** Evento emitido por el backend al crear un mensaje interno (compliance conversation). */
export interface InternalMessageCreatedEvent {
  type: 'internal_message';
  conversationId: string;
  message: {
    id: string;
    body: string;
    senderId: string;
    createdAt?: string | Date | null;
  };
  conversation: {
    id: string;
    subject: string;
    status: 'open' | 'closed';
    customerUserId: string;
    supportUserId: string;
    closedAt?: string | Date | null;
  };
}

/** Evento emitido por el backend al crear un mensaje de action request. */
export interface ActionRequestMessageCreatedEvent {
  type: 'action_request_message';
  conversationId: string;
  message: {
    id: string;
    body: string;
    senderId: string;
    createdAt?: string | Date | null;
  };
  conversation: {
    id: string;
    subject: string;
    status: 'open' | 'closed';
    staffUserAssignedId: string | null;
    staffUserCreatorId: string;
    closedAt?: string | Date | null;
  };
}

/** Evento privado emitido cuando cambia el estado del usuario autenticado. */
export interface UserStateChangedEvent {
  previousState: UserState;
  state: UserState;
}

/**
 * Conexión Socket.IO de la consola staff. La autenticación viaja en la cookie HttpOnly
 * de sesión (withCredentials) y el backend asocia el socket a la room `user:{id}` según
 * el Origin. Pensado para crecer: añadir nuevos eventos = un Subject + un `socket.on`.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly platformId = inject(PLATFORM_ID);
  // Socket.IO entrega sus callbacks FUERA de la zona de Angular. Reentramos en la zona al
  // emitir cada evento para que las actualizaciones de signals (p. ej. la campana) disparen
  // la detección de cambios. (En modo zoneless, NgZone.run simplemente ejecuta la función.)
  private readonly zone = inject(NgZone);
  private socket: Socket | null = null;

  private readonly internalMessageCreatedSubject = new Subject<InternalMessageCreatedEvent>();
  readonly internalMessageCreated$ = this.internalMessageCreatedSubject.asObservable();

  private readonly actionRequestMessageCreatedSubject = new Subject<ActionRequestMessageCreatedEvent>();
  readonly actionRequestMessageCreated$ = this.actionRequestMessageCreatedSubject.asObservable();

  // Notificaciones para la campana (decididas por el backend).
  private readonly notificationCreatedSubject = new Subject<AppNotification>();
  readonly notificationCreated$ = this.notificationCreatedSubject.asObservable();

  // Señal transitoria: el estado de este usuario de staff ha cambiado (revalidar sesión).
  private readonly userStateChangedSubject = new Subject<UserStateChangedEvent>();
  readonly userStateChanged$ = this.userStateChangedSubject.asObservable();

  connect(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.socket?.connected) return;

    this.disconnect();

    this.socket = io(environment.backendUrl, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    this.socket.on('internal-message:created', (payload: InternalMessageCreatedEvent) => {
      this.zone.run(() => this.internalMessageCreatedSubject.next(payload));
    });

    this.socket.on('action-request-message:created', (payload: ActionRequestMessageCreatedEvent) => {
      this.zone.run(() => this.actionRequestMessageCreatedSubject.next(payload));
    });

    this.socket.on('notification:created', (payload: AppNotification) => {
      this.zone.run(() => this.notificationCreatedSubject.next(payload));
    });

    this.socket.on('user:state-changed', (payload: UserStateChangedEvent) => {
      this.zone.run(() => this.userStateChangedSubject.next(payload));
    });

    this.socket.on('connect_error', (error: Error) => {
      // Si el handshake es rechazado por falta de sesión, no insistimos.
      if (/unauthorized/i.test(error.message)) this.disconnect();
    });
  }

  disconnect(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
  }
}
