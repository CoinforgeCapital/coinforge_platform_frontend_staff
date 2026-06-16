import { HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { SILENT_AUTH_ERROR } from '../core/http-context';
import { ApiService, LoginRequest, StaffRole, StandardMessageResponse } from './api.service';
import { SessionService } from './session.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  /** Rol actual (de la sesión en memoria) o null si no hay sesión de staff. */
  currentRole(): StaffRole | null {
    return this.session.role();
  }

  /** Correo del usuario actual o null (si no hay sesión o el backend no lo envió). */
  currentEmail(): string | null {
    return this.session.email();
  }

  /** Id del usuario actual o null si no hay sesión. */
  currentUserId(): string | null {
    return this.session.userId();
  }

  isAuthenticatedStaff(): boolean {
    return this.session.isAuthenticated();
  }

  hasAnyRole(roles?: readonly StaffRole[]): boolean {
    if (!roles?.length) return this.isAuthenticatedStaff();
    const role = this.currentRole();
    return role !== null && roles.includes(role);
  }

  /**
   * Restaura la sesión preguntando al backend quién es el usuario autenticado.
   * La identidad vive en la cookie HttpOnly (no en JS), así que la única forma de
   * conocer el rol es consultar al backend. Un 401 => no hay sesión.
   *
   * Se marca como "silenciosa" para que el interceptor no muestre el aviso de sesión
   * expirada durante el arranque. Nunca lanza: no debe bloquear el boot de la app.
   */
  async loadSession(): Promise<void> {
    try {
      const context = new HttpContext().set(SILENT_AUTH_ERROR, true);
      const me = await this.api.getCurrentUserState({ context });
      this.session.set(
        SessionService.isStaffRole(me.role) && me.state !== 'deleted'
          ? { id: me.id, role: me.role, state: me.state, email: me.email }
          : null,
      );
    } catch {
      this.session.clear();
    }
  }

  async login(payload: LoginRequest): Promise<void> {
    // 1) Autentica: el backend responde con Set-Cookie (access_token HttpOnly).
    await this.api.login(payload);
    // 2) Carga la identidad (id/rol/estado) desde el backend.
    await this.loadSession();
    // 3) Este portal solo admite cuentas de staff.
    if (!this.isAuthenticatedStaff()) {
      await this.logout(false);
      throw new Error('This portal only allows staff accounts.');
    }
    await this.router.navigateByUrl(environment.staffHomePath, { replaceUrl: true });
  }

  async logout(redirect = true): Promise<void> {
    // Pide al backend que borre la cookie; si falla, limpiamos igualmente el estado local.
    try {
      await this.api.logout();
    } catch {
      /* noop: la sesión local se limpia de todas formas */
    }
    this.session.clear();
    if (redirect) await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  startChangePassword(newPassword: string): Promise<StandardMessageResponse> {
    return this.api.startChangePassword({ newPassword });
  }

  async endChangePassword(token: string): Promise<StandardMessageResponse> {
    const response = await this.api.endChangePassword({ token });
    if (response.ok) await this.logout(false);
    return response;
  }

  startChangeEmail(newEmail: string): Promise<StandardMessageResponse> {
    return this.api.startChangeEmail({ newEmail });
  }

  async endChangeEmail(token: string): Promise<StandardMessageResponse> {
    const response = await this.api.endChangeEmail({ token });
    if (response.ok) await this.logout(false);
    return response;
  }
}
