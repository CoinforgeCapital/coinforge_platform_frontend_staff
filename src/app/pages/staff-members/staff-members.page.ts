import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ApiService, StaffState } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { SessionService } from '../../services/session.service';
import { STAFF_PERMISSIONS, STAFF_ROLES } from '../../core/staff-permissions';
import { EntityCollectionComponent, EntityColumn } from '../../shared/entity-collection/entity-collection.component';
import { UserCreateFormComponent } from '../../shared/user-create-form/user-create-form.component';
import {
  AdminActionsUser,
  UserAdminActionsComponent,
} from '../../shared/user-admin-actions/user-admin-actions.component';
import { StaffActionRequestsComponent } from '../../shared/staff-action-requests/staff-action-requests.component';

interface EntityGroup {
  key: string;
  label: string;
  icon: string;
  columns: EntityColumn[];
}

/** Categorías sintéticas del detalle (no son colecciones embebidas del staff). */
const STATE_KEY = 'accountStateCategory';
const ADMIN_KEY = 'adminActionsCategory';

/** Estados seleccionables para una cuenta de staff (espejo de STAFF_STATES del backend). */
const STAFF_STATE_OPTIONS: readonly { label: string; value: StaffState }[] = [
  { label: 'Approved (active)', value: 'approved' },
  { label: 'Blocked', value: 'blocked' },
];

/** Colecciones que componen a un usuario de staff (ver findAllStaffUsersWithFullInformation). */
const ENTITY_GROUPS: readonly EntityGroup[] = [
  {
    key: 'assignedComplianceClients',
    label: 'Assigned clients',
    icon: 'pi pi-users',
    columns: [
      { field: 'clientUser.email', label: 'Client' },
      { field: 'assignedByUser.email', label: 'Assigned by' },
      { field: 'createdAt', label: 'Date' },
    ],
  },
  {
    key: 'complianceAssignmentsCreated',
    label: 'Assignments created',
    icon: 'pi pi-user-edit',
    columns: [
      { field: 'clientUser.email', label: 'Client' },
      { field: 'complianceUser.email', label: 'Compliance' },
      { field: 'createdAt', label: 'Date' },
    ],
  },
  {
    key: 'requirementsStaff',
    label: 'Requirements',
    icon: 'pi pi-verified',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'documentType', label: 'Type' },
      { field: 'state', label: 'Status' },
      { field: 'customerUser.email', label: 'Client' },
      { field: 'createdAt', label: 'Date' },
    ],
  },
  {
    key: 'supportTicketConversationsSupport',
    label: 'Support tickets',
    icon: 'pi pi-ticket',
    columns: [
      { field: 'subject', label: 'Subject' },
      { field: 'status', label: 'Status' },
      { field: 'priority', label: 'Priority' },
      { field: 'customerUser.email', label: 'Client' },
      { field: 'createdAt', label: 'Date' },
    ],
  },
  {
    key: 'internalConversationsSupport',
    label: 'Internal conversations',
    icon: 'pi pi-comments',
    columns: [
      { field: 'subject', label: 'Subject' },
      { field: 'status', label: 'Status' },
      { field: 'customerUser.email', label: 'Client' },
      { field: 'createdAt', label: 'Date' },
    ],
  },
  {
    key: 'actionRequestsCreated',
    label: 'Action requests created',
    icon: 'pi pi-send',
    columns: [
      { field: 'subject', label: 'Subject' },
      { field: 'status', label: 'Status' },
      { field: 'target', label: 'Target' },
      { field: 'staffUserAssigned.email', label: 'Assigned to' },
      { field: 'createdAt', label: 'Date' },
    ],
  },
  {
    key: 'actionRequestsAssigned',
    label: 'Action requests assigned',
    icon: 'pi pi-inbox',
    columns: [
      { field: 'subject', label: 'Subject' },
      { field: 'status', label: 'Status' },
      { field: 'target', label: 'Target' },
      { field: 'staffUserCreator.email', label: 'Created by' },
      { field: 'createdAt', label: 'Date' },
    ],
  },
];

const LIST_COLUMNS = [
  { field: 'email', label: 'Email' },
  { field: 'nickname', label: 'Nickname' },
  { field: 'role', label: 'Role' },
  { field: 'state', label: 'State' },
  { field: 'lastLoginAt', label: 'Last login' },
  { field: 'createdAt', label: 'Created' },
];

@Component({
  selector: 'app-staff-members-page',
  standalone: true,
  imports: [
    FormsModule,
    TableModule,
    EntityCollectionComponent,
    UserCreateFormComponent,
    UserAdminActionsComponent,
    StaffActionRequestsComponent,
  ],
  templateUrl: './staff-members.page.html',
  styleUrl: './staff-members.page.css',
})
export class StaffMembersPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionService);
  private readonly confirm = inject(ConfirmationService);
  private readonly messages = inject(MessageService);

  readonly columns = LIST_COLUMNS;
  readonly stateKey = STATE_KEY;
  readonly adminKey = ADMIN_KEY;
  readonly staffStateOptions = STAFF_STATE_OPTIONS;

  /** POST /api/user — crear usuarios nuevos (botón "Create user" del listado). */
  readonly canCreateUser = this.auth.hasAnyRole(STAFF_PERMISSIONS.userCreate);
  /** Editar datos / reset password / borrar (PATCH/DELETE /api/user/:id) — solo admin. */
  readonly canAdminActions = this.auth.hasAnyRole(STAFF_PERMISSIONS.usersWrite);

  readonly loading = signal(false);
  readonly all = signal<Record<string, unknown>[]>([]);
  readonly search = signal('');
  readonly view = signal<'list' | 'detail'>('list');
  /** true = se muestra el formulario de alta de usuario en lugar del listado. */
  readonly creatingUser = signal(false);
  readonly selected = signal<Record<string, unknown> | null>(null);
  readonly activeEntity = signal<string>(ENTITY_GROUPS[0].key);
  /** Elemento concreto en el que se ha hecho drill-down (null = se ve la tabla). */
  readonly drillItem = signal<Record<string, unknown> | null>(null);

  // ---- Cambiar estado de la cuenta de staff (categoría "Account state") ----
  stateTarget: StaffState | '' = '';
  readonly stateSaving = signal(false);

  /**
   * Pestañas del detalle. Antepone la categoría sintética "Account state" solo si el rol actual
   * puede cambiar el estado del staff seleccionado (espejo de changeStateAction del backend).
   */
  readonly entityGroups = computed<EntityGroup[]>(() => {
    const groups = [...ENTITY_GROUPS];
    if (this.canAdminActions) {
      groups.unshift({ key: ADMIN_KEY, label: 'Admin actions', icon: 'pi pi-cog', columns: [] });
    }
    if (this.canChangeStateOf(this.selected())) {
      groups.unshift({ key: STATE_KEY, label: 'Account state', icon: 'pi pi-sliders-h', columns: [] });
    }
    return groups;
  });

  /** Datos del staff para la categoría "Admin actions" (staff: con nickname y reset password). */
  readonly adminUser = computed<AdminActionsUser | null>(() => {
    const staff = this.selected();
    if (!staff) return null;
    return {
      id: String(staff['id']),
      email: String(staff['email']),
      nickname: (staff['nickname'] as string | null | undefined) ?? null,
      isStaff: true,
      isSelf: staff['id'] === this.session.userId(),
    };
  });

  /** Identidad del staff del detalle para el panel de action requests entre tú y él. */
  readonly peerRef = computed<{ id: string; email: string } | null>(() => {
    const staff = this.selected();
    if (!staff) return null;
    return { id: String(staff['id']), email: String(staff['email']) };
  });

  readonly filtered = computed(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) return this.all();
    return this.all().filter(
      (u) =>
        String(u['email'] ?? '').toLowerCase().includes(query) ||
        String(u['nickname'] ?? '').toLowerCase().includes(query),
    );
  });

  readonly entityItems = computed<Record<string, unknown>[]>(() => {
    const staff = this.selected();
    if (!staff) return [];
    const items = staff[this.activeEntity()];
    if (!Array.isArray(items)) return [];
    return (items as Record<string, unknown>[]).map((item) => this.enrichSelfRefs(item, staff));
  });

  readonly currentColumns = computed<EntityColumn[]>(
    () => ENTITY_GROUPS.find((g) => g.key === this.activeEntity())?.columns ?? [],
  );

  readonly activeLabel = computed(
    () => ENTITY_GROUPS.find((g) => g.key === this.activeEntity())?.label ?? '',
  );

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.api.listStaffMembers();
      this.all.set((res.users ?? []) as unknown as Record<string, unknown>[]);
    } catch {
      /* el interceptor ya muestra el aviso */
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  clearSearch(): void {
    this.search.set('');
  }

  openDetail(row: Record<string, unknown>): void {
    this.selected.set(row);
    // El tab por defecto es la primera colección con datos (nunca la categoría sintética).
    const firstWithItems = ENTITY_GROUPS.find((g) => this.countFor(row, g.key) > 0);
    this.activeEntity.set((firstWithItems ?? ENTITY_GROUPS[0]).key);
    this.drillItem.set(null);
    this.view.set('detail');
  }

  backToList(): void {
    this.view.set('list');
    this.selected.set(null);
    this.drillItem.set(null);
  }

  selectEntity(key: string): void {
    this.activeEntity.set(key);
    this.drillItem.set(null);
    if (key === STATE_KEY) this.stateTarget = (this.selected()?.['state'] as StaffState) ?? '';
  }

  // ---- Alta de usuario (formulario compartido, en lugar del listado) ----
  startCreateUser(): void {
    this.creatingUser.set(true);
  }
  cancelCreateUser(): void {
    this.creatingUser.set(false);
  }
  onUserCreated(): void {
    this.creatingUser.set(false);
    void this.load();
  }

  // ---- Categoría: Admin actions (editar datos / reset password / borrar) ----
  onStaffUpdated(data: { email: string; nickname: string | null }): void {
    const id = this.selected()?.['id'];
    if (!id) return;
    const apply = (u: Record<string, unknown>): Record<string, unknown> =>
      u['id'] === id ? { ...u, email: data.email, nickname: data.nickname } : u;
    const current = this.selected();
    if (current) this.selected.set(apply(current));
    this.all.update((list) => list.map(apply));
  }

  onStaffDeleted(id: string): void {
    this.all.update((list) => list.filter((u) => u['id'] !== id));
    this.backToList();
  }

  // ---- Categoría: Account state ----

  /** Espejo de changeStateAction: ¿puede el rol actual cambiar el estado de este usuario? */
  canChangeStateOf(user: Record<string, unknown> | null): boolean {
    if (!user || user['state'] === 'deleted') return false;
    const me = this.auth.currentRole();
    const target = user['role'];
    if (target === 'ADMIN') return false;
    if (me === STAFF_ROLES.admin) return true;
    if (me === STAFF_ROLES.operator) return target !== 'OPERATOR';
    if (me === STAFF_ROLES.complianceOfficer) return target === 'CLIENT' || target === 'COMPLIANCE';
    if (me === STAFF_ROLES.supportOfficer) return target === 'SUPPORT';
    return false;
  }

  stateLabel(raw: unknown): string {
    const value = String(raw ?? '');
    return STAFF_STATE_OPTIONS.find((o) => o.value === value)?.label ?? value.replace(/_/g, ' ');
  }

  onStateTargetChange(value: string): void {
    this.stateTarget = value as StaffState | '';
  }

  applyStaffState(): void {
    const user = this.selected();
    const id = user?.['id'] as string | undefined;
    const current = user?.['state'] as string | undefined;
    const next = this.stateTarget;
    if (!id || !next || next === current) return;

    this.confirm.confirm({
      header: 'Change staff state',
      message: `Set this staff member's state to "${this.stateLabel(next)}"?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Confirm',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: next === 'blocked' ? 'p-button-danger' : undefined,
      rejectButtonStyleClass: 'p-button-text',
      accept: () => {
        this.stateSaving.set(true);
        this.api
          .changeUserState(id, { staffState: next })
          .then((res) => {
            this.patchSelectedState(id, next);
            this.toast('success', 'State updated', res.message ?? 'Done.');
          })
          .catch((err) => this.toast('error', 'Could not update state', this.errorOf(err)))
          .finally(() => this.stateSaving.set(false));
      },
    });
  }

  private patchSelectedState(id: string, next: string): void {
    const apply = (u: Record<string, unknown>): Record<string, unknown> =>
      u['id'] === id ? { ...u, state: next } : u;
    const current = this.selected();
    if (current) this.selected.set(apply(current));
    this.all.update((list) => list.map(apply));
  }

  closeItem(): void {
    this.drillItem.set(null);
  }

  entityCount(key: string): number {
    return this.countFor(this.selected(), key);
  }

  itemTitle(item: Record<string, unknown>): string {
    const client = item['clientUser'] as { email?: string } | undefined;
    return String(item['subject'] ?? item['name'] ?? client?.email ?? item['id'] ?? 'Item');
  }

  value(row: Record<string, unknown>, field: string): string {
    const value = field.split('.').reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[key];
    }, row);
    return this.format(value);
  }

  roleLabel(role: unknown): string {
    return String(role ?? '-').replace(/_/g, ' ');
  }

  stateBadgeClass(state: unknown): string {
    switch (state) {
      case 'approved':
        return 'cf-badge cf-badge--success';
      case 'blocked':
      case 'deleted':
        return 'cf-badge cf-badge--danger';
      case 'restricted':
        return 'cf-badge cf-badge--warning';
      default:
        return 'cf-badge cf-badge--neutral';
    }
  }

  private countFor(row: Record<string, unknown> | null, key: string): number {
    const items = row?.[key];
    return Array.isArray(items) ? items.length : 0;
  }

  /**
   * El backend no popula la referencia al propio staff dentro de sus colecciones
   * (p. ej. `assignedByUser` en `complianceAssignmentsCreated` llega solo con su id).
   * Como ese id es el del staff que estamos viendo, completamos su email/rol/estado
   * para que tanto la tabla como la tarjeta de usuario muestren el correo, no el id.
   */
  private enrichSelfRefs(item: Record<string, unknown>, staff: Record<string, unknown>): Record<string, unknown> {
    const staffId = staff['id'];
    let clone: Record<string, unknown> | null = null;

    for (const [key, value] of Object.entries(item)) {
      // Caso real: la referencia al propio staff llega como id suelto (relación no poblada).
      if (typeof value === 'string' && value === staffId && this.isUserKey(key)) {
        clone ??= { ...item };
        clone[key] = this.minimalStaffRef(staff);
        continue;
      }
      // Defensivo: referencia como objeto {id} sin email que también es el propio staff.
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const ref = value as Record<string, unknown>;
        if (ref['id'] === staffId && ref['email'] === undefined) {
          clone ??= { ...item };
          clone[key] = { ...ref, ...this.minimalStaffRef(staff) };
        }
      }
    }

    return clone ?? item;
  }

  private isUserKey(key: string): boolean {
    return /(user|sender|closedby)/.test(key.replace(/[_\s-]/g, '').toLowerCase());
  }

  private minimalStaffRef(staff: Record<string, unknown>): Record<string, unknown> {
    return {
      id: staff['id'],
      email: staff['email'],
      nickname: staff['nickname'] ?? null,
      role: staff['role'],
      type: staff['type'],
      state: staff['state'],
      createdAt: staff['createdAt'],
      lastLoginAt: staff['lastLoginAt'],
    };
  }

  private toast(severity: 'success' | 'error', summary: string, detail: string): void {
    this.messages.add({ severity, summary, detail, life: severity === 'error' ? 6000 : 4000 });
  }

  private errorOf(err: unknown): string {
    const e = err as { error?: { message?: unknown }; message?: unknown };
    if (typeof e.error?.message === 'string' && e.error.message.trim()) return e.error.message;
    if (typeof e.message === 'string' && e.message.trim()) return e.message;
    return 'The request could not be completed.';
  }

  private format(value: unknown): string {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString();
    return String(value);
  }
}
