import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';

/**
 * Preset de marca Axora Fintech sobre Aura (PrimeNG).
 * - `primary`: rampa teal anclada en el acento de la landing (#00d4aa / #00b896),
 *   para que botones, focus, enlaces, tags y estados activos salgan de marca.
 * - Esquema CLARO forzado en el contenido (el modo oscuro queda opt-in con `.cf-dark`,
 *   configurado en app.config), porque el workspace del staff es denso en datos y se
 *   lee mejor en claro; el "chrome" oscuro se aplica por CSS propio (sidebar/topbar/auth).
 */
export const CoinforgePreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#e7fcf6',
      100: '#c2f5e7',
      200: '#88ecd1',
      300: '#43dcb6',
      400: '#0fd0a3',
      500: '#00b896',
      600: '#019e82',
      700: '#01806b',
      800: '#066654',
      900: '#0a5346',
      950: '#003128',
    },
    colorScheme: {
      light: {
        primary: {
          color: '{primary.500}',
          contrastColor: '#ffffff',
          hoverColor: '{primary.600}',
          activeColor: '{primary.700}',
        },
        highlight: {
          background: 'rgba(0, 184, 150, 0.12)',
          focusBackground: 'rgba(0, 184, 150, 0.20)',
          color: '{primary.700}',
          focusColor: '{primary.800}',
        },
      },
    },
  },
});
