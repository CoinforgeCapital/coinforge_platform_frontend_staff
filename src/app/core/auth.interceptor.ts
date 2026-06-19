import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { SessionService } from '../services/session.service';
import { SILENT_AUTH_ERROR } from './http-context';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const CSRF_COOKIE = 'csrf_token_staff';
const CSRF_HEADER = 'X-CSRF-Token';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  const messages = inject(MessageService);
  const router = inject(Router);

  // El token de sesión viaja en una cookie HttpOnly: para que el navegador la envíe (y para
  // recibir la cookie en el login) las llamadas al backend van con `withCredentials`.
  // En las peticiones que modifican estado añadimos el token CSRF (double-submit): lo leemos
  // de la cookie `csrf_token` (NO HttpOnly) y lo reenviamos en la cabecera `X-CSRF-Token`.
  const isBackendCall = req.url.startsWith(environment.backendUrl);
  let authReq = req;
  if (isBackendCall) {
    const isMutating = !SAFE_METHODS.includes(req.method.toUpperCase());
    const csrfToken = isMutating ? readCookie(CSRF_COOKIE) : null;
    authReq = req.clone({
      withCredentials: true,
      ...(csrfToken ? { setHeaders: { [CSRF_HEADER]: csrfToken } } : {}),
    });
  }

  return next(authReq).pipe(
    catchError((err: unknown) => {
      const error = err as HttpErrorResponse;
      const isNetworkError = error.status === 0;
      const detail = extractErrorMessage(error, isNetworkError);
      const accountDeleted = isAccountDeletedError(error);
      const accountBlocked = isAccountBlockedError(error);
      // Peticiones marcadas como "silenciosas" (p. ej. el probe de sesión) no muestran UI.
      const silent = req.context.get(SILENT_AUTH_ERROR);

      if (error.status === 401 || accountDeleted || accountBlocked) {
        // Cookie ausente/expirada o cuenta no operativa: limpiamos la sesión en memoria.
        session.clear();
        if (!silent) {
          messages.add({
            severity: 'warn',
            summary: accountDeleted || accountBlocked ? 'Account unavailable' : 'Session expired',
            detail: accountDeleted || accountBlocked ? detail : 'Your session has expired. Please sign in again.',
            life: 7000,
          });
          router.navigateByUrl('/auth/login');
        }
      } else if (!silent) {
        messages.add({
          severity: isNetworkError ? 'warn' : 'error',
          summary: isNetworkError ? 'Network error' : 'Request failed',
          detail,
          life: 6000,
        });
      }

      return throwError(() => err);
    }),
  );
};

/** Lee una cookie por nombre desde document.cookie (para el token CSRF, que NO es HttpOnly). */
function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  }
  return null;
}

function extractErrorMessage(error: HttpErrorResponse, isNetworkError: boolean): string {
  if (isNetworkError) return 'The backend is not reachable. Please try again.';
  if (typeof error.error === 'string' && error.error.trim()) return error.error;
  if (typeof error.error?.message === 'string' && error.error.message.trim()) return error.error.message;
  if (error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

function isAccountDeletedError(error: HttpErrorResponse): boolean {
  return error.status === 403 && error.error?.code === 'account_deleted';
}

function isAccountBlockedError(error: HttpErrorResponse): boolean {
  return error.status === 403 && error.error?.code === 'account_blocked';
}
