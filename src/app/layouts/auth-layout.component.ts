import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <main class="auth-layout">
      <router-outlet />
    </main>
  `,
  styles: [
    `
    .auth-layout {
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: #f2f6f9;
      background:
        radial-gradient(58% 48% at 15% 18%, rgba(0, 212, 170, 0.16), transparent 60%),
        radial-gradient(54% 44% at 85% 82%, rgba(139, 92, 246, 0.18), transparent 60%),
        radial-gradient(60% 60% at 50% 50%, rgba(0, 30, 30, 0.45), transparent 80%),
        #070b10;
    }
  `,
  ],
})
export class AuthLayoutComponent {}
