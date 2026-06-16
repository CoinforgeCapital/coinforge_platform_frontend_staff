import { inject } from '@angular/core';
import { CanMatchFn, Route, Router, UrlSegment } from '@angular/router';
import { environment } from '../../environments/environment';
import { StaffRole } from '../services/api.service';
import { AuthService } from '../services/auth.service';
import { SessionService } from '../services/session.service';

export interface StaffRouteData {
  roles?: readonly StaffRole[];
}

// La sesión se restaura en el arranque (APP_INITIALIZER -> AuthService.loadSession),
// por lo que estos guards pueden leerla de forma SÍNCRONA desde SessionService.

export const authMatchGuard: CanMatchFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);

  if (session.isAuthenticated()) return true;
  return router.createUrlTree(['/auth/login']);
};

export const unauthMatchGuard: CanMatchFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);

  if (!session.isAuthenticated()) return true;
  return router.createUrlTree([environment.staffHomePath]);
};

export const roleMatchGuard: CanMatchFn = (route: Route, _segments: UrlSegment[]) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const data = route.data as StaffRouteData | undefined;

  if (auth.hasAnyRole(data?.roles)) return true;
  return router.createUrlTree([environment.staffHomePath]);
};
