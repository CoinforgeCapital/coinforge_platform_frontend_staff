import { computed, Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { StaffRole, UserRole, UserState } from './api.service';

export interface StaffSession {
  id: string;
  role: StaffRole;
  state?: UserState;
  email?: string;
}

/**
 * Guarda la sesión del usuario EN MEMORIA (no en localStorage).
 *
 * Con autenticación por cookie HttpOnly, el token no es accesible desde JavaScript,
 * por lo que la identidad (id, rol, estado) se obtiene del backend y se cachea aquí
 * mientras la pestaña esté abierta. Al recargar la página se vuelve a pedir al backend
 * (ver `AuthService.loadSession` + el APP_INITIALIZER de `app.config.ts`).
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly _session = signal<StaffSession | null>(null);

  /** Sesión actual (solo lectura) como signal. */
  readonly session = this._session.asReadonly();
  /** Rol actual o null si no hay sesión. */
  readonly role = computed<StaffRole | null>(() => this._session()?.role ?? null);
  /** Id del usuario actual o null si no hay sesión. */
  readonly userId = computed<string | null>(() => this._session()?.id ?? null);
  /** Correo del usuario actual o null si no hay sesión / el backend no lo envió. */
  readonly email = computed<string | null>(() => this._session()?.email ?? null);
  /** ¿Hay una sesión de staff activa? */
  readonly isAuthenticated = computed<boolean>(() => this._session() !== null);

  set(session: StaffSession | null): void {
    this._session.set(session);
  }

  clear(): void {
    this._session.set(null);
  }

  /** Comprueba si un rol cualquiera es un rol de staff válido (type guard). */
  static isStaffRole(role: UserRole | string | null | undefined): role is StaffRole {
    return !!role && (environment.staffRoles as readonly string[]).includes(role);
  }
}
