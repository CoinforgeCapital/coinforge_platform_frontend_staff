import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { STAFF_ROLES } from '../../core/staff-permissions';

type SectionKey =
  | 'clients'
  | 'staff-members'
  | 'requirements'
  | 'internal-messages'
  | 'risk-profiles'
  | 'action-requests'
  | 'support-tickets'
  | 'blockchains'
  | 'fiat-currencies'
  | 'crypto-currencies'
  | 'bank-data';

interface SectionColumn {
  field: string;
  label: string;
}

interface SectionConfig {
  key: SectionKey;
  kicker: string;
  title: string;
  description: string;
  columns: SectionColumn[];
  emptyMessage: string;
  contextMessage?: string;
  /** Si está presente, las filas son clicables y navegan a `${detailPath}/${row.id}`. */
  detailPath?: string;
}

const SECTION_CONFIGS: Record<SectionKey, SectionConfig> = {
  clients: {
    key: 'clients',
    kicker: 'Clients',
    title: 'Client directory',
    description: 'Review client accounts visible to your role.',
    columns: [
      { field: 'email', label: 'Email' },
      { field: 'role', label: 'Role' },
      { field: 'state', label: 'State' },
      { field: 'country', label: 'Country' },
      { field: 'createdAt', label: 'Created' },
    ],
    emptyMessage: 'No clients found.',
    detailPath: '/clients',
  },
  'staff-members': {
    key: 'staff-members',
    kicker: 'Staff',
    title: 'Staff members',
    description: 'Review platform staff members according to backend permissions.',
    columns: [
      { field: 'email', label: 'Email' },
      { field: 'role', label: 'Role' },
      { field: 'state', label: 'State' },
      { field: 'lastLoginAt', label: 'Last login' },
    ],
    emptyMessage: 'No staff members found.',
  },
  requirements: {
    key: 'requirements',
    kicker: 'Compliance',
    title: 'Requirements',
    description: 'Track documentation requirements opened for clients.',
    columns: [
      { field: 'name', label: 'Requirement' },
      { field: 'documentType', label: 'Document type' },
      { field: 'status', label: 'Status' },
      { field: 'customerUser.email', label: 'Client' },
      { field: 'createdAt', label: 'Created' },
    ],
    emptyMessage: 'No requirements found.',
  },
  'internal-messages': {
    key: 'internal-messages',
    kicker: 'Communication',
    title: 'Internal messages',
    description: 'Access compliance conversations with clients.',
    columns: [
      { field: 'subject', label: 'Subject' },
      { field: 'status', label: 'Status' },
      { field: 'customerUser.email', label: 'Client' },
      { field: 'staffUser.email', label: 'Staff' },
      { field: 'createdAt', label: 'Created' },
    ],
    emptyMessage: 'No conversations found.',
    contextMessage: 'Admin and operator access to internal messages requires selecting a client context.',
  },
  'risk-profiles': {
    key: 'risk-profiles',
    kicker: 'Risk',
    title: 'Risk profiles',
    description: 'Risk profiles are loaded per client from the client detail workflow.',
    columns: [
      { field: 'client', label: 'Client' },
      { field: 'risk', label: 'Risk' },
      { field: 'updatedAt', label: 'Updated' },
    ],
    emptyMessage: 'Select a client to review the risk profile.',
    contextMessage: 'The backend exposes risk profiles by client id, not as a global list.',
  },
  'action-requests': {
    key: 'action-requests',
    kicker: 'Operations',
    title: 'Action requests',
    description: 'Review action requests assigned to or visible for your staff role.',
    columns: [
      { field: 'subject', label: 'Subject' },
      { field: 'status', label: 'Status' },
      { field: 'staffUserCreator.email', label: 'Created by' },
      { field: 'staffUserAssigned.email', label: 'Assigned to' },
      { field: 'createdAt', label: 'Created' },
    ],
    emptyMessage: 'No action requests found.',
  },
  'support-tickets': {
    key: 'support-tickets',
    kicker: 'Support',
    title: 'Support tickets',
    description: 'Review customer support tickets assigned to the support desk.',
    columns: [
      { field: 'subject', label: 'Subject' },
      { field: 'status', label: 'Status' },
      { field: 'priority', label: 'Priority' },
      { field: 'customerUser.email', label: 'Client' },
      { field: 'createdAt', label: 'Created' },
    ],
    emptyMessage: 'No support tickets found.',
  },
  blockchains: {
    key: 'blockchains',
    kicker: 'Catalog',
    title: 'Blockchains',
    description: 'Manage blockchain catalog data. Create and delete actions are admin-only in the backend.',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'code', label: 'Code' },
      { field: 'enabled', label: 'Enabled' },
    ],
    emptyMessage: 'No blockchains found.',
  },
  'fiat-currencies': {
    key: 'fiat-currencies',
    kicker: 'Catalog',
    title: 'Fiat currencies',
    description: 'Manage fiat currency catalog data. Create and delete actions are admin-only in the backend.',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'code', label: 'Code' },
      { field: 'symbol', label: 'Symbol' },
      { field: 'enabled', label: 'Enabled' },
    ],
    emptyMessage: 'No fiat currencies found.',
  },
  'crypto-currencies': {
    key: 'crypto-currencies',
    kicker: 'Catalog',
    title: 'Crypto currencies',
    description: 'Manage crypto currency catalog data. Create and delete actions are admin-only in the backend.',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'ticker', label: 'Ticker' },
      { field: 'symbol', label: 'Symbol' },
      { field: 'enabled', label: 'Enabled' },
    ],
    emptyMessage: 'No crypto currencies found.',
  },
  'bank-data': {
    key: 'bank-data',
    kicker: 'Treasury',
    title: 'Bank data',
    description: 'Manage Axora Fintech bank account data. Write actions are admin-only in the backend.',
    columns: [
      { field: 'owner', label: 'Owner' },
      { field: 'iban', label: 'IBAN' },
      { field: 'swiftBic', label: 'SWIFT/BIC' },
      { field: 'referenceCode', label: 'Reference' },
      { field: 'currency', label: 'Currency' },
    ],
    emptyMessage: 'No bank data found.',
  },
};

@Component({
  selector: 'app-staff-section-page',
  standalone: true,
  imports: [TableModule],
  templateUrl: './staff-section.page.html',
  styleUrl: './staff-section.page.css',
})
export class StaffSectionPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  readonly config = signal<SectionConfig>(SECTION_CONFIGS.clients);
  readonly rows = signal<Record<string, unknown>[]>([]);
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly infoMessage = signal('');

  ngOnInit(): void {
    const key = this.route.snapshot.data['sectionKey'] as SectionKey | undefined;
    this.config.set(SECTION_CONFIGS[key ?? 'clients']);
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    this.infoMessage.set('');

    try {
      const rows = await this.fetchRows(this.config().key);
      this.rows.set(rows);
    } catch (err: unknown) {
      this.errorMessage.set(this.toErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  openRow(row: Record<string, unknown>): void {
    const detailPath = this.config().detailPath;
    const id = row['id'];
    if (detailPath && typeof id === 'string') {
      void this.router.navigate([detailPath, id]);
    }
  }

  value(row: Record<string, unknown>, field: string): string {
    const value = field.split('.').reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[key];
    }, row);

    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string' && this.looksLikeDate(value)) return new Date(value).toLocaleString();
    if (typeof value === 'object') {
      const objectValue = value as Record<string, unknown>;
      return String(objectValue['email'] ?? objectValue['name'] ?? objectValue['id'] ?? '-');
    }
    return String(value);
  }

  private async fetchRows(key: SectionKey): Promise<Record<string, unknown>[]> {
    switch (key) {
      case 'clients':
        return this.asRows((await this.api.listClients()).users);
      case 'staff-members':
        return this.asRows((await this.api.listStaffMembers()).users);
      case 'requirements':
        return this.asRows((await this.api.listRequirements()).requirements);
      case 'internal-messages':
        if (this.auth.hasAnyRole([STAFF_ROLES.compliance, STAFF_ROLES.complianceOfficer])) {
          return this.asRows((await this.api.listInternalConversations()).conversations);
        }
        this.infoMessage.set(this.config().contextMessage ?? '');
        return [];
      case 'risk-profiles':
        this.infoMessage.set(this.config().contextMessage ?? '');
        return [];
      case 'action-requests':
        if (this.auth.hasAnyRole([STAFF_ROLES.admin, STAFF_ROLES.operator, STAFF_ROLES.complianceOfficer, STAFF_ROLES.supportOfficer])) {
          return this.asRows((await this.api.listActionRequests()).conversations);
        }
        return this.asRows((await this.api.listOwnActionRequests()).conversations);
      case 'support-tickets':
        return this.asRows((await this.api.listSupportTickets()).tickets);
      case 'blockchains':
        return this.asRows((await this.api.listBlockchains()).blockchains);
      case 'fiat-currencies':
        return this.asRows((await this.api.listFiatCurrencies()).fiatCurrencies);
      case 'crypto-currencies':
        return this.asRows((await this.api.listCryptoCurrencies()).cryptoCurrencies);
      case 'bank-data':
        return this.asRows((await this.api.listBankData()).bankAccounts);
    }
  }

  private asRows<T extends object>(rows: T[] | undefined): Record<string, unknown>[] {
    return (rows ?? []) as Record<string, unknown>[];
  }

  private looksLikeDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T/.test(value);
  }

  private toErrorMessage(err: unknown): string {
    const error = err as { error?: { message?: unknown }; message?: unknown };
    if (typeof error.error?.message === 'string' && error.error.message.trim()) return error.error.message;
    if (typeof error.message === 'string' && error.message.trim()) return error.message;
    return 'Unable to load this section.';
  }
}
