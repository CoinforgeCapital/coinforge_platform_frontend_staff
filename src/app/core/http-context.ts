import { HttpContextToken } from '@angular/common/http';

/**
 * Marca una petición para que el `authInterceptor` NO muestre el aviso de
 * "sesión expirada" ni redirija al login cuando reciba un 401.
 *
 * Se usa en el "probe" de sesión del arranque (AuthService.loadSession): ahí un 401
 * solo significa "todavía no hay sesión", no un error que debamos mostrar al usuario.
 */
export const SILENT_AUTH_ERROR = new HttpContextToken<boolean>(() => false);
