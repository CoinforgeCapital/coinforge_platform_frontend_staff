import { Component, inject, input, OnDestroy, OnInit, output, signal } from '@angular/core';
import { catchError, debounceTime, distinctUntilChanged, from, map, of, Subject, Subscription, switchMap } from 'rxjs';
import { ApiService, StaffUser } from '../../services/api.service';
import { matchesClientIdentity } from '../client-identity-search';

/**
 * Selector de usuario escalable con debounce. Para staff usa la búsqueda del backend
 * por email/nickname/id; para clientes reutiliza la lista permitida por el backend y
 * permite buscar también por nombre y apellidos de personal-data.
 */
@Component({
  selector: 'app-user-autocomplete',
  standalone: true,
  template: `
    <div class="ua-wrap">
      <div class="ua-input">
        <i class="pi pi-search" aria-hidden="true"></i>
        <input
          type="text"
          [placeholder]="placeholder()"
          [value]="query()"
          (input)="onInput($event)"
          (focus)="onFocus()"
          autocomplete="off"
        />
        @if (loading()) {
          <i class="pi pi-spin pi-spinner ua-spin" aria-hidden="true"></i>
        }
      </div>

      @if (open()) {
        <div class="ua-backdrop" (click)="close()"></div>
        <div class="ua-panel">
          @if (results().length) {
            @for (u of results(); track u.id) {
              <button type="button" class="ua-item" (click)="pick(u)">
                <span class="ua-email">{{ u.email }}</span>
                <span class="ua-meta">{{ userSecondaryLabel(u) }}</span>
              </button>
            }
          } @else if (!loading() && query().trim().length >= 2) {
            <div class="ua-empty">No users match “{{ query().trim() }}”.</div>
          } @else {
            <div class="ua-empty">Type at least 2 characters…</div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
    .ua-wrap { position: relative; }
    .ua-input { position: relative; display: flex; align-items: center; }
    .ua-input > i.pi-search { position: absolute; left: 12px; color: var(--cf-text-muted); }
    .ua-input input {
      width: 100%;
      box-sizing: border-box;
      min-height: 44px;
      border: 1px solid var(--cf-border);
      border-radius: var(--cf-radius-sm);
      padding: 0 34px;
      background: var(--cf-surface);
      color: var(--cf-text);
      font: inherit;
    }
    .ua-input input:focus { outline: none; border-color: var(--cf-teal-500); box-shadow: var(--cf-ring); }
    .ua-spin { position: absolute; right: 12px; color: var(--cf-teal-600); }

    .ua-backdrop { position: fixed; inset: 0; z-index: 40; }
    .ua-panel {
      position: absolute;
      left: 0;
      right: 0;
      top: calc(100% + 6px);
      z-index: 50;
      max-height: 300px;
      overflow-y: auto;
      border: 1px solid var(--cf-border);
      border-radius: var(--cf-radius-sm);
      background: var(--cf-surface);
      box-shadow: var(--cf-shadow-lg, 0 18px 50px rgba(15, 27, 42, 0.18));
    }
    .ua-item {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      border: 0;
      border-bottom: 1px solid var(--cf-border);
      background: transparent;
      text-align: left;
      cursor: pointer;
    }
    .ua-item:last-child { border-bottom: 0; }
    .ua-item:hover { background: var(--cf-surface-2); }
    .ua-email { color: var(--cf-text); font-weight: 600; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ua-meta { color: var(--cf-text-muted); font-size: 0.78rem; white-space: nowrap; }
    .ua-empty { padding: 14px; color: var(--cf-text-muted); font-size: 0.85rem; }
    `,
  ],
})
export class UserAutocompleteComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);

  readonly type = input<'client' | 'staff' | undefined>(undefined);
  readonly allowedRoles = input<readonly string[] | null>(null);
  /** Si es true, oculta del resultado los usuarios de staff bloqueados (state !== 'approved'). */
  readonly excludeBlocked = input<boolean>(false);
  readonly placeholder = input<string>('Search by email or id…');
  readonly selected = output<StaffUser>();

  readonly query = signal('');
  readonly results = signal<StaffUser[]>([]);
  readonly loading = signal(false);
  readonly open = signal(false);

  private readonly query$ = new Subject<string>();
  private sub?: Subscription;
  private clientCache?: StaffUser[];

  ngOnInit(): void {
    this.sub = this.query$
      .pipe(
        debounceTime(300),
        map((q) => q.trim()),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.length < 2) {
            this.loading.set(false);
            return of<StaffUser[]>([]);
          }
          this.loading.set(true);
          const request =
            this.type() === 'client'
              ? this.searchClientsLocally(q)
              : this.api.searchUsers(q, this.type()).then((r) => this.filterCandidates(r.users ?? []));
          return from(request).pipe(
            catchError(() => of<StaffUser[]>([])),
          );
        }),
      )
      .subscribe((users) => {
        this.results.set(users);
        this.loading.set(false);
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    this.open.set(true);
    this.query$.next(value);
  }

  onFocus(): void {
    if (this.results().length || this.query().trim().length >= 2) this.open.set(true);
  }

  pick(user: StaffUser): void {
    this.selected.emit(user);
    this.query.set(user.email);
    this.open.set(false);
  }

  close(): void {
    this.open.set(false);
  }

  /** Limpia el campo (p. ej. tras usar la selección en el formulario padre). */
  reset(): void {
    this.query.set('');
    this.results.set([]);
    this.open.set(false);
  }

  private async searchClientsLocally(q: string): Promise<StaffUser[]> {
    const term = q.trim().toLowerCase();
    if (!this.clientCache) {
      const res = await this.api.listClients();
      this.clientCache = res.users ?? [];
    }

    return this.clientCache
      .filter((user) =>
        matchesClientIdentity(user, term) ||
        String(user.id ?? '').toLowerCase().includes(term) ||
        String(user.nickname ?? '').toLowerCase().includes(term),
      )
      .slice(0, 20);
  }

  private filterCandidates(users: StaffUser[]): StaffUser[] {
    let candidates = users;

    const roles = this.allowedRoles();
    if (roles && roles.length > 0) {
      candidates = candidates.filter((user) => roles.includes(user.role));
    }

    // Para asignaciones no deben ofrecerse usuarios de staff bloqueados.
    if (this.excludeBlocked()) {
      candidates = candidates.filter((user) => user.state === 'approved');
    }

    return candidates;
  }

  userSecondaryLabel(user: StaffUser): string {
    const fullName = [user.personalData?.name, user.personalData?.surname]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .join(' ');
    return fullName || user.nickname || this.roleLabel(user.role);
  }

  roleLabel(role: string): string {
    return String(role).replace(/_/g, ' ');
  }
}
