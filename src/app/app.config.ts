import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';
import { AuthService } from './services/auth.service';
import { CoinforgePreset } from './theme/coinforge-preset';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    providePrimeNG({
      theme: {
        preset: CoinforgePreset,
        // Modo oscuro opt-in (clase .cf-dark): el contenido se mantiene claro aunque el
        // sistema operativo esté en oscuro, para no afectar a las tablas densas.
        options: { darkModeSelector: '.cf-dark' },
      },
    }),
    MessageService,
    ConfirmationService,
    // Antes de renderizar, restauramos la sesión preguntando al backend (la identidad
    // está en la cookie HttpOnly). Así los guards ya disponen de la sesión tras recargar.
    provideAppInitializer(() => inject(AuthService).loadSession()),
  ],
};
