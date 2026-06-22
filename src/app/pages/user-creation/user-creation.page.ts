import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';

import { ApiService, StaffUser } from '../../services/api.service';
import { EntityCollectionComponent, EntityColumn } from '../../shared/entity-collection/entity-collection.component';
import { matchesClientIdentity } from '../../shared/client-identity-search';

interface EntityGroup {
  key: string;
  label: string;
  icon: string;
  columns: EntityColumn[];
}
interface InfoField {
  label: string;
  value: string;
}

const PROFILE_KEY = 'profile';
const DOCUMENTS_KEY = 'documents';

/** Colecciones de documentos del cliente, fusionadas en una sola pestaña "Documents". */
const DOCUMENT_COLLECTIONS: readonly { key: string; label: string }[] = [
  { key: 'kycDocuments', label: 'KYC' },
  { key: 'sofDocuments', label: 'Source of funds' },
  { key: 'sowDocuments', label: 'Source of wealth' },
  { key: 'legalDeclarationDocuments', label: 'Legal declaration' },
  { key: 'otherDocuments', label: 'Other' },
];

/** Pestañas del detalle de un CLIENTE borrado (espejo read-only de la página Clients). */
const CLIENT_GROUPS: readonly EntityGroup[] = [
  { key: PROFILE_KEY, label: 'Profile', icon: 'pi pi-id-card', columns: [] },
  {
    key: 'wallets',
    label: 'Wallets',
    icon: 'pi pi-wallet',
    columns: [
      { field: 'blockchain.name', label: 'Blockchain' },
      { field: 'publicAddress', label: 'Address' },
      { field: 'state', label: 'State' },
      { field: 'createdAt', label: 'Created' },
    ],
  },
  {
    key: 'clientBankAccounts',
    label: 'Bank accounts',
    icon: 'pi pi-building-columns',
    columns: [
      { field: 'accountHolder', label: 'Holder' },
      { field: 'iban', label: 'IBAN' },
      { field: 'bankInstitution', label: 'Bank' },
      { field: 'country', label: 'Country' },
      { field: 'state', label: 'State' },
      { field: 'createdAt', label: 'Created' },
    ],
  },
  {
    key: 'transactions',
    label: 'Transactions',
    icon: 'pi pi-sync',
    columns: [
      { field: 'cryptoSymbol', label: 'Crypto' },
      { field: 'fiatSymbol', label: 'Fiat' },
      { field: 'amountSent', label: 'Sent' },
      { field: 'amountReceive', label: 'Received' },
      { field: 'state', label: 'State' },
      { field: 'createdAt', label: 'Created' },
    ],
  },
  {
    key: 'requirementsCustomer',
    label: 'Requirements',
    icon: 'pi pi-verified',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'documentType', label: 'Type' },
      { field: 'state', label: 'Status' },
      { field: 'staffUser.email', label: 'Created by' },
      { field: 'createdAt', label: 'Created' },
    ],
  },
  {
    key: 'complianceAssignmentsAsClient',
    label: 'Compliance',
    icon: 'pi pi-link',
    columns: [
      { field: 'complianceUser.email', label: 'Compliance' },
      { field: 'assignedByUser.email', label: 'Assigned by' },
      { field: 'createdAt', label: 'Date' },
    ],
  },
  {
    key: 'supportTicketConversationsCustomer',
    label: 'Support tickets',
    icon: 'pi pi-ticket',
    columns: [
      { field: 'subject', label: 'Subject' },
      { field: 'status', label: 'Status' },
      { field: 'priority', label: 'Priority' },
      { field: 'supportUser.email', label: 'Agent' },
      { field: 'createdAt', label: 'Created' },
    ],
  },
  {
    key: 'internalConversationsCustomer',
    label: 'Internal conversations',
    icon: 'pi pi-comments',
    columns: [
      { field: 'subject', label: 'Subject' },
      { field: 'status', label: 'Status' },
      { field: 'staffUser.email', label: 'Compliance' },
      { field: 'createdAt', label: 'Created' },
    ],
  },
  {
    key: DOCUMENTS_KEY,
    label: 'Documents',
    icon: 'pi pi-folder',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'docKind', label: 'Type' },
      { field: 'createdAt', label: 'Created' },
    ],
  },
];

/** Pestañas del detalle de un usuario de STAFF borrado (espejo read-only de Staff members). */
const STAFF_GROUPS: readonly EntityGroup[] = [
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

/** Claves a ocultar en las tarjetas de Profile (ruido de KYCAID, ids, rutas…). */
const PROFILE_SKIP = /^id$|Id$|password|hash|^code$|Code$|token|^raw|kycaid|external|path|formUrl|url$|notes$|^user$/i;

/**
 * Listado de usuarios dados de baja (admin-only). Permite abrir el detalle COMPLETO de un usuario
 * borrado en modo solo lectura (perfil, KYC, wallets, transacciones, requirements, etc.), sin
 * ninguna acción de modificación. Los datos los trae `GET /api/user/deleted/:id` (admin).
 */
@Component({
  selector: 'app-user-management-page',
  standalone: true,
  imports: [DatePipe, TableModule, EntityCollectionComponent],
  templateUrl: './user-creation.page.html',
  styleUrl: './user-creation.page.css',
})
export class UserManagementPage {
  private readonly api = inject(ApiService);
  private readonly messages = inject(MessageService);

  readonly deletedUsers = signal<StaffUser[]>([]);
  readonly loading = signal(false);
  readonly pageSize = 20;

  readonly search = signal('');
  readonly deletedUsersView = computed(() => this.filterByEmail(this.deletedUsers(), this.search()));

  // ---- Detalle (solo lectura) ----
  readonly view = signal<'list' | 'detail'>('list');
  /** Fila clicada (cabecera inmediata mientras carga el detalle). */
  readonly selected = signal<StaffUser | null>(null);
  /** Entidad completa poblada (colecciones). */
  readonly detail = signal<Record<string, unknown> | null>(null);
  readonly detailLoading = signal(false);
  readonly activeEntity = signal<string>('');
  /** Elemento concreto en el que se ha hecho drill-down (null = se ve la tabla). */
  readonly drillItem = signal<Record<string, unknown> | null>(null);

  readonly profileKey = PROFILE_KEY;

  readonly isClient = computed(
    () => String(this.detail()?.['role'] ?? this.selected()?.role ?? '') === 'CLIENT',
  );
  readonly entityGroups = computed<readonly EntityGroup[]>(() => (this.isClient() ? CLIENT_GROUPS : STAFF_GROUPS));

  readonly entityItems = computed<Record<string, unknown>[]>(() => {
    const data = this.detail();
    const key = this.activeEntity();
    if (!data || key === PROFILE_KEY) return [];
    if (key === DOCUMENTS_KEY) return this.mergedDocuments(data);
    const items = data[key];
    return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
  });

  readonly currentColumns = computed<EntityColumn[]>(
    () => this.entityGroups().find((g) => g.key === this.activeEntity())?.columns ?? [],
  );
  readonly activeLabel = computed(
    () => this.entityGroups().find((g) => g.key === this.activeEntity())?.label ?? '',
  );

  // ---- Profile (datos únicos del cliente) ----
  readonly personalDataFields = computed<InfoField[]>(() => this.objectFields(this.detail()?.['personalData']));
  readonly kycFields = computed<InfoField[]>(() => this.objectFields(this.detail()?.['kyc']));
  readonly riskFields = computed<InfoField[]>(() => this.objectFields(this.detail()?.['riskProfile']));
  readonly hasProfileData = computed(
    () => this.personalDataFields().length + this.kycFields().length + this.riskFields().length > 0,
  );

  constructor() {
    void this.loadDeleted();
  }

  async loadDeleted(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.api.listDeletedUsers();
      this.deletedUsers.set(res.users ?? []);
    } catch (err: unknown) {
      this.toast('error', 'Could not load deleted users', this.toErrorMessage(err));
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

  async openDetail(user: StaffUser): Promise<void> {
    this.selected.set(user);
    this.detail.set(null);
    this.drillItem.set(null);
    this.view.set('detail');
    this.detailLoading.set(true);
    try {
      const res = await this.api.getDeletedUser(user.id);
      this.detail.set(res.user as unknown as Record<string, unknown>);
      this.activeEntity.set(this.entityGroups()[0]?.key ?? '');
    } catch (err: unknown) {
      this.toast('error', 'Could not load user detail', this.toErrorMessage(err));
    } finally {
      this.detailLoading.set(false);
    }
  }

  backToList(): void {
    this.view.set('list');
    this.selected.set(null);
    this.detail.set(null);
    this.drillItem.set(null);
  }

  selectEntity(key: string): void {
    this.activeEntity.set(key);
    this.drillItem.set(null);
  }
  closeItem(): void {
    this.drillItem.set(null);
  }

  entityCount(key: string): number {
    const data = this.detail();
    if (!data || key === PROFILE_KEY) return 0;
    if (key === DOCUMENTS_KEY) return this.mergedDocuments(data).length;
    const items = data[key];
    return Array.isArray(items) ? items.length : 0;
  }

  itemTitle(item: Record<string, unknown>): string {
    const client = item['clientUser'] as { email?: string } | undefined;
    return String(
      item['subject'] ??
        item['name'] ??
        item['accountHolder'] ??
        item['iban'] ??
        item['publicAddress'] ??
        client?.email ??
        item['id'] ??
        'Item',
    );
  }

  roleLabel(role?: string): string {
    return String(role ?? '-').replace(/_/g, ' ');
  }
  stateLabel(state?: string): string {
    return state === 'deleted' ? 'Deleted' : String(state ?? '-').replace(/_/g, ' ');
  }
  stateBadgeClass(state?: string): string {
    return state === 'deleted' ? 'cf-badge cf-badge--danger' : 'cf-badge cf-badge--neutral';
  }

  // ---- helpers ----

  private mergedDocuments(data: Record<string, unknown>): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const collection of DOCUMENT_COLLECTIONS) {
      const arr = data[collection.key];
      if (Array.isArray(arr)) {
        for (const doc of arr as Record<string, unknown>[]) {
          out.push({ ...doc, docKind: collection.label });
        }
      }
    }
    return out;
  }

  private filterByEmail(rows: StaffUser[], q: string): StaffUser[] {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((u) => matchesClientIdentity(u, term));
  }

  private objectFields(obj: unknown): InfoField[] {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
    const out: InfoField[] = [];
    for (const [key, raw] of Object.entries(obj as Record<string, unknown>)) {
      if (PROFILE_SKIP.test(key)) continue;
      if (raw === null || raw === undefined || raw === '') continue;
      if (typeof raw === 'object') continue;
      out.push({ label: this.humanize(key), value: this.format(raw) });
    }
    return out;
  }

  private format(value: unknown): string {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString();
    return String(value);
  }

  private humanize(key: string): string {
    const spaced = key.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  private toast(severity: 'success' | 'error', summary: string, detail: string): void {
    this.messages.add({ severity, summary, detail, life: severity === 'error' ? 6000 : 5000 });
  }

  private toErrorMessage(err: unknown): string {
    const error = err as { error?: { message?: unknown }; message?: unknown };
    if (typeof error.error?.message === 'string' && error.error.message.trim()) return error.error.message;
    if (typeof error.message === 'string' && error.message.trim()) return error.message;
    return 'Unable to complete the operation.';
  }
}
