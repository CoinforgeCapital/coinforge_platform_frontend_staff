import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { groupStaffNavItems, STAFF_NAV_ITEMS } from '../core/staff-permissions';
import { AuthService } from '../services/auth.service';
import { NotificationCenterService } from '../services/notification-center.service';
import { NotificationsBellComponent } from '../shared/notifications-bell/notifications-bell.component';
import { RealtimeService, UserStateChangedEvent } from '../services/realtime.service';

@Component({
  selector: 'app-staff-layout',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, NotificationsBellComponent],
  template: `
    <div class="staff-shell" [class.is-collapsed]="collapsed()">
      <aside class="sidebar cf-scroll">
        <nav class="nav" aria-label="Staff navigation">
          @for (group of navGroups(); track group.group) {
            <div class="nav-group">
              <span class="nav-group-label">{{ group.group }}</span>
              @for (item of group.items; track item.path) {
                <a
                  class="nav-link"
                  [routerLink]="item.path"
                  routerLinkActive="is-active"
                  [routerLinkActiveOptions]="{ exact: item.path === '/dashboard' }"
                  [title]="item.label"
                >
                  <i [class]="item.icon" aria-hidden="true"></i>
                  <span class="nav-link-label">{{ item.label }}</span>
                </a>
              }
            </div>
          }
        </nav>

        <div class="sidebar-foot">
          <button type="button" class="logout" (click)="logout()" title="Log out">
            <i class="pi pi-sign-out" aria-hidden="true"></i>
            <span class="nav-link-label">Log out</span>
          </button>
        </div>
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div class="topbar-left">
            <button
              type="button"
              class="brand-btn"
              (click)="toggle()"
              aria-label="Toggle navigation"
              title="Toggle navigation"
            >
              <img src="/favicon.png" alt="CoinForge" />
            </button>
            <div class="topbar-title">
              <span>CoinForge Platform</span>
              <strong>Operations workspace</strong>
            </div>
          </div>
          <div class="topbar-right">
            <div class="user-chip">
              @if (userEmail(); as mail) {
                <span class="user-email" [title]="mail">
                  <i class="pi pi-user" aria-hidden="true"></i>
                  <span class="user-email-text">{{ mail }}</span>
                </span>
              }
              <span class="role-pill">{{ roleLabel() }}</span>
            </div>
            <app-notifications-bell />
          </div>
        </header>

        <main class="content">
          <router-outlet />
        </main>
      </section>
    </div>
  `,
  styles: [
    `
    .staff-shell {
      min-height: 100dvh;
      display: grid;
      grid-template-columns: 268px minmax(0, 1fr);
      background: var(--cf-bg);
      color: var(--cf-text);
      transition: grid-template-columns 0.18s ease;
    }
    .staff-shell.is-collapsed { grid-template-columns: 76px minmax(0, 1fr); }

    /* ---------- Sidebar (chrome oscuro de marca) ---------- */
    .sidebar {
      position: sticky;
      top: 0;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 18px 12px;
      color: var(--cf-chrome-text);
      border-right: 1px solid var(--cf-chrome-border);
      background:
        radial-gradient(120% 60% at 0% 0%, rgba(0, 212, 170, 0.12), transparent 60%),
        radial-gradient(120% 60% at 100% 100%, rgba(139, 92, 246, 0.12), transparent 60%),
        var(--cf-chrome-bg);
      overflow-y: auto;
    }

    .nav { display: flex; flex-direction: column; gap: 14px; }
    .nav-group { display: grid; gap: 3px; }
    .nav-group-label {
      padding: 2px 12px;
      color: var(--cf-chrome-muted);
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .is-collapsed .nav-group-label { visibility: hidden; height: 6px; }

    .nav-link {
      min-height: 40px;
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 0 12px;
      border-radius: 9px;
      color: var(--cf-chrome-text);
      text-decoration: none;
      font-weight: 600;
      white-space: nowrap;
      border: 1px solid transparent;
    }
    .nav-link:hover { background: var(--cf-chrome-elevate); color: var(--cf-chrome-text-strong); }
    .nav-link.is-active {
      background: rgba(0, 212, 170, 0.14);
      color: #eafff8;
      border-color: rgba(0, 212, 170, 0.28);
      box-shadow: inset 3px 0 0 var(--cf-teal-400);
    }
    .nav-link i { width: 20px; font-size: 1.02rem; text-align: center; color: var(--cf-teal-400); }
    .is-collapsed .nav-link { justify-content: center; padding: 0; }
    .is-collapsed .nav-link-label { display: none; }

    .sidebar-foot { margin-top: auto; display: grid; gap: 10px; }
    .logout {
      min-height: 40px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      border: 1px solid rgba(255, 92, 92, 0.34);
      border-radius: 9px;
      background: rgba(255, 92, 92, 0.08);
      color: #ffd4d4;
      font-weight: 700;
      cursor: pointer;
    }
    .logout:hover { background: rgba(255, 92, 92, 0.16); }
    .logout i { color: #ff9b9b; }

    /* ---------- Workspace (contenido claro) ---------- */
    .workspace { min-width: 0; display: grid; grid-template-rows: auto 1fr; }

    .topbar {
      min-height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 0 24px;
      border-bottom: 1px solid var(--cf-border);
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 5;
    }
    .topbar-left { display: flex; align-items: center; gap: 12px; }
    .topbar-title span {
      display: block;
      color: var(--cf-text-muted);
      font-size: 0.7rem;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .topbar-title strong { display: block; color: var(--cf-text); font-size: 1.02rem; }

    /* Recuadro de marca en el topbar (favicon) — también pliega/expande el menú */
    .brand-btn {
      width: 42px;
      height: 42px;
      display: inline-grid;
      place-items: center;
      padding: 0;
      border: 1px solid var(--cf-border);
      border-radius: 11px;
      background: var(--cf-surface);
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .brand-btn:hover { border-color: rgba(0, 184, 150, 0.5); box-shadow: var(--cf-ring); }
    .brand-btn img { width: 28px; height: 28px; object-fit: contain; display: block; }

    .role-pill {
      border: 1px solid var(--cf-border);
      border-radius: 999px;
      padding: 7px 14px;
      background: var(--cf-surface);
      color: var(--cf-text);
      font-weight: 700;
      font-size: 0.85rem;
      white-space: nowrap;
    }

    .topbar-right { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .user-chip { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .user-email {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      max-width: 30rem;
      padding: 6px 13px;
      border: 1px solid var(--cf-border);
      border-radius: 999px;
      background: var(--cf-surface);
      color: var(--cf-text);
      font-size: 0.82rem;
      font-weight: 700;
      line-height: 1.2;
    }
    .user-email i { flex: none; color: var(--cf-teal-600); font-size: 0.92rem; }
    .user-email-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @media (max-width: 720px) { .user-email-text { max-width: 150px; } }
    @media (max-width: 560px) { .user-email { display: none; } }

    .content { width: min(100%, 1480px); margin: 0 auto; padding: 26px 24px 40px; }

    @media (max-width: 980px) {
      .staff-shell, .staff-shell.is-collapsed { grid-template-columns: 1fr; }
      .sidebar { position: static; height: auto; }
      .nav-link-label, .nav-group-label { display: revert; visibility: visible; }
      .nav { grid-template-columns: 1fr; }
    }
  `,
  ],
})
export class StaffLayoutComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly notificationCenter = inject(NotificationCenterService);
  private readonly realtime = inject(RealtimeService);
  private readonly router = inject(Router);
  private userStateSub?: Subscription;

  readonly collapsed = signal(false);

  readonly navGroups = computed(() =>
    groupStaffNavItems(STAFF_NAV_ITEMS.filter((item) => this.auth.hasAnyRole(item.roles))),
  );

  ngOnInit(): void {
    // El shell solo se monta con sesión de staff: arrancamos realtime + notificaciones.
    this.notificationCenter.start();

    // El backend avisa cuando cambia el estado de este staff: revalidamos en vivo.
    this.userStateSub = this.realtime.userStateChanged$.subscribe((event) => {
      void this.onUserStateChanged(event);
    });
  }

  ngOnDestroy(): void {
    this.userStateSub?.unsubscribe();
    this.notificationCenter.stop();
  }

  /** Revalida la sesión tras un cambio de estado notificado por el servidor. */
  private async onUserStateChanged(event: UserStateChangedEvent): Promise<void> {
    if (event.state === 'blocked' || event.state === 'deleted') {
      this.notificationCenter.stop();
      await this.auth.logout();
      return;
    }

    const previousRole = this.auth.currentRole();
    await this.auth.loadSession();

    // Sesión inválida => fuera. El bloqueo se trata arriba para cortar el socket al instante.
    if (!this.auth.isAuthenticatedStaff()) {
      this.notificationCenter.stop();
      await this.auth.logout();
      return;
    }

    // Cambió el rol => a un sitio seguro; el menú se re-gatea solo (navGroups es computed).
    if (this.auth.currentRole() !== previousRole) {
      void this.router.navigateByUrl('/dashboard');
    }
  }

  toggle(): void {
    this.collapsed.update((value) => !value);
  }

  roleLabel(): string {
    return this.auth.currentRole()?.replace(/_/g, ' ') ?? 'Staff';
  }

  /** Correo del usuario en sesión (se muestra en el topbar junto al rol). */
  userEmail(): string | null {
    return this.auth.currentEmail();
  }

  logout(): Promise<void> {
    this.notificationCenter.stop();
    return this.auth.logout();
  }
}
