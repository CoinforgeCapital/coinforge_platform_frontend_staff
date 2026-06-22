import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { DialogModule } from 'primeng/dialog';
import { ConfirmationService, MessageService } from 'primeng/api';

import {
  ApiService,
  KycaidWalletAudit,
  ManualClientState,
  ManageableUserState,
  Requirement,
  RequirementDocumentType,
  RequirementFile,
  RiskProfile,
  SettableTransactionState,
  StaffKycHistoryItem,
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { STAFF_PERMISSIONS, STAFF_ROLES } from '../../core/staff-permissions';
import { EntityCollectionComponent, EntityColumn } from '../../shared/entity-collection/entity-collection.component';
import {
  RiskProfileClientRef,
  RiskProfileDetailComponent,
} from '../../shared/risk-profile-detail/risk-profile-detail.component';
import { UserCreateFormComponent } from '../../shared/user-create-form/user-create-form.component';
import {
  AdminActionsUser,
  UserAdminActionsComponent,
} from '../../shared/user-admin-actions/user-admin-actions.component';
import { ClientInternalConversationsComponent } from '../../shared/client-internal-conversations/client-internal-conversations.component';
import { ClientPendingApprovalsComponent } from '../../shared/client-pending-approvals/client-pending-approvals.component';
import { ClientActivityAlertsComponent } from '../../shared/client-activity-alerts/client-activity-alerts.component';
import { ClientProfileOverviewComponent } from '../../shared/client-profile-overview/client-profile-overview.component';
import { ClientRequirementsComponent } from '../../shared/client-requirements/client-requirements.component';
import { formatAmountByField } from '../../shared/amount-format';
import { ApprovalRequirementWarningService } from '../../services/approval-requirement-warning.service';

interface EntityGroup {
  key: string;
  label: string;
  icon: string;
  columns: EntityColumn[];
}

interface InfoField {
  label: string;
  value: string;
  mono: boolean;
  badge?: boolean;
  badgeValue?: unknown;
  wide?: boolean;
}

/** Grupo de campos relacionados, para dividir listas largas en subsecciones legibles. */
interface FieldGroup {
  title: string;
  fields: InfoField[];
}

type WalletAuditDialogMode = 'latest' | 'detail';

interface DocumentTab {
  key: string;
  label: string;
  collectionKey: string;
  type: RequirementDocumentType;
}

interface FinancialApprovalCheck {
  header: string;
  baseMessage: string;
  checkRequirements: () => Promise<string | null>;
  action: () => Promise<{ ok: boolean; message: string }>;
  newState: string;
  item: Record<string, unknown>;
}

interface ConfirmRunOptions {
  icon?: string;
  acceptLabel?: string;
}

const PROFILE_KEY = 'profile';
const DOCUMENTS_KEY = 'documents';
const WALLET_KEY = 'wallets';
const BANK_KEY = 'clientBankAccounts';
const TX_KEY = 'transactions';
/** Categorías sintéticas del detalle (no son colecciones embebidas del cliente). */
const RISK_PROFILE_KEY = 'riskProfileCategory';
const ACCOUNT_SETTINGS_KEY = 'accountSettingsCategory';
const KYC_SETTINGS_KEY = 'kycSettingsCategory';
const ADMIN_KEY = 'adminActionsCategory';
const PENDING_KEY = 'pendingApprovalsCategory';
const ACTIVITY_ALERTS_KEY = 'activityAlertsCategory';

/** Etiquetas de estados de cliente conocidos, incluidos los automaticos de KYC. */
const CLIENT_STATE_LABELS: readonly { label: string; value: ManageableUserState }[] = [
  { label: 'New', value: 'new' },
  { label: 'KYC pending', value: 'kyc_pending' },
  { label: 'KYC sent', value: 'kyc_send' },
  { label: 'Under review', value: 'under_review' },
  { label: 'Approved', value: 'approved' },
  { label: 'Restricted', value: 'restricted' },
  { label: 'Blocked', value: 'blocked' },
];

/** Estados que staff puede aplicar manualmente sin tocar el registro KYC. */
const MANUAL_CLIENT_STATE_OPTIONS: readonly { label: string; value: ManualClientState }[] = [
  { label: 'Under review', value: 'under_review' },
  { label: 'Approved', value: 'approved' },
  { label: 'Restricted', value: 'restricted' },
  { label: 'Blocked', value: 'blocked' },
];

const MANUAL_CLIENT_STATE_VALUES = MANUAL_CLIENT_STATE_OPTIONS.map((option) => option.value);

/** Acciones sobre el KYC (PATCH /api/kyc/:userId/{verify,sync-kycaid,restricted,reset}). */
type KycAction = 'verify' | 'sync' | 'restricted' | 'reset';
const KYC_ACTIONS: readonly { label: string; value: KycAction; danger: boolean }[] = [
  { label: 'Verify', value: 'verify', danger: false },
  { label: 'Sync from KYCAID', value: 'sync', danger: false },
  { label: 'Restrict', value: 'restricted', danger: true },
  { label: 'Reset', value: 'reset', danger: true },
];

/** Tipos de documento seleccionables al crear un requirement desde el detalle del cliente. */
const REQUIREMENT_DOC_TYPES: readonly { label: string; value: RequirementDocumentType }[] = [
  { label: 'KYC', value: 'kyc' },
  { label: 'Legal declaration', value: 'legal_declaration' },
  { label: 'Source of funds', value: 'source_of_funds' },
  { label: 'Source of wealth', value: 'source_of_wealth' },
  { label: 'Other', value: 'other' },
  { label: 'Transaction evidence', value: 'additional_evidence_transaction' },
  { label: 'Bank account', value: 'client_bank' },
];

const DOCUMENT_TABS: readonly DocumentTab[] = [
  { key: 'kyc', label: 'KYC', collectionKey: 'kycDocuments', type: 'kyc' },
  { key: 'sof', label: 'Source of funds', collectionKey: 'sofDocuments', type: 'source_of_funds' },
  { key: 'sow', label: 'Source of wealth', collectionKey: 'sowDocuments', type: 'source_of_wealth' },
  { key: 'legal', label: 'Legal declarations', collectionKey: 'legalDeclarationDocuments', type: 'legal_declaration' },
  { key: 'other', label: 'Other', collectionKey: 'otherDocuments', type: 'other' },
];

const ENTITY_GROUPS: readonly EntityGroup[] = [
  { key: PROFILE_KEY, label: 'Profile', icon: 'pi pi-id-card', columns: [] },
  {
    key: WALLET_KEY,
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
    key: BANK_KEY,
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
    key: TX_KEY,
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
  { key: DOCUMENTS_KEY, label: 'Documents', icon: 'pi pi-folder', columns: [] },
];

const LIST_COLUMNS: readonly EntityColumn[] = [
  { field: 'email', label: 'Email' },
  { field: 'type', label: 'Type' },
  { field: 'state', label: 'State' },
  { field: 'kyc.kycState', label: 'KYC' },
  { field: 'createdAt', label: 'Created' },
];

const TX_STATE_OPTIONS: readonly { label: string; value: SettableTransactionState }[] = [
  { label: 'Payment received', value: 'payment_received' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Completed', value: 'completed' },
];

@Component({
  selector: 'app-clients-page',
  standalone: true,
  imports: [
    FormsModule,
    TableModule,
    TabsModule,
    DialogModule,
    EntityCollectionComponent,
    RiskProfileDetailComponent,
    UserCreateFormComponent,
    UserAdminActionsComponent,
    ClientInternalConversationsComponent,
    ClientPendingApprovalsComponent,
    ClientActivityAlertsComponent,
    ClientProfileOverviewComponent,
    ClientRequirementsComponent,
  ],
  templateUrl: './clients.page.html',
  styleUrl: './clients.page.css',
})
export class ClientsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);
  private readonly route = inject(ActivatedRoute);
  private readonly requirementWarnings = inject(ApprovalRequirementWarningService);

  readonly columns = LIST_COLUMNS;
  readonly profileKey = PROFILE_KEY;
  readonly documentsKey = DOCUMENTS_KEY;
  readonly riskProfileKey = RISK_PROFILE_KEY;
  readonly accountSettingsKey = ACCOUNT_SETTINGS_KEY;
  readonly kycSettingsKey = KYC_SETTINGS_KEY;
  readonly adminKey = ADMIN_KEY;
  readonly pendingKey = PENDING_KEY;
  readonly activityAlertsKey = ACTIVITY_ALERTS_KEY;
  readonly walletKey = WALLET_KEY;
  readonly documentTabs = DOCUMENT_TABS;
  readonly txStateOptions = TX_STATE_OPTIONS;
  readonly reqDocTypeOptions = REQUIREMENT_DOC_TYPES;
  readonly clientStateOptions = MANUAL_CLIENT_STATE_OPTIONS;
  readonly kycActions = KYC_ACTIONS;

  // ---- Permisos (espejo del backend) ----
  readonly canFinancials = this.auth.hasAnyRole(STAFF_PERMISSIONS.clientFinancials);
  readonly canChangeTxState = this.auth.hasAnyRole(STAFF_PERMISSIONS.transactionStateChange);
  readonly canCreateRequirement = this.auth.hasAnyRole(STAFF_PERMISSIONS.requirementsWrite);
  /** Ver/descargar documentos de requirements (GET + file download) — sin operator. */
  readonly canReadRequirements = this.auth.hasAnyRole(STAFF_PERMISSIONS.requirementsRead);
  /** Cambiar el estado de un cliente (el support officer queda excluido: solo gestiona soporte). */
  readonly canChangeState = this.auth.hasAnyRole(STAFF_PERMISSIONS.clientStateChange);
  /** PATCH /api/kyc/:id/{verify,sync-kycaid,restricted,reset} — gestionar el KYC del cliente. */
  readonly canKyc = this.auth.hasAnyRole(STAFF_PERMISSIONS.kycReview);
  /** Crear clientes (botón "Create user" del listado): solo admin y operator. */
  readonly canCreateUser = this.auth.hasAnyRole(STAFF_PERMISSIONS.clientCreate);
  /** Editar datos / borrar usuario (PATCH/DELETE /api/user/:id) — solo admin. */
  readonly canAdminActions = this.auth.hasAnyRole(STAFF_PERMISSIONS.usersWrite);
  /** Ver alertas de actividad y limites AML del cliente. */
  readonly canActivityWarnings = this.auth.hasAnyRole(STAFF_PERMISSIONS.activityWarningsView);
  /** Ver la última auditoría KYCAID de una wallet del cliente. */
  readonly canViewWalletKycaidAudit = this.auth.hasAnyRole(STAFF_PERMISSIONS.walletKycaidAuditView);

  /** Pestañas del detalle. Las categorías sintéticas muestran paneles propios, no colecciones. */
  readonly entityGroups = computed<EntityGroup[]>(() => {
    const out: EntityGroup[] = [];
    for (const group of ENTITY_GROUPS) {
      out.push(group);
      if (group.key === PROFILE_KEY) {
        out.push({ key: RISK_PROFILE_KEY, label: 'Risk profile', icon: 'pi pi-shield', columns: [] });
        out.push({ key: ACCOUNT_SETTINGS_KEY, label: 'Account settings', icon: 'pi pi-user-edit', columns: [] });
        out.push({ key: KYC_SETTINGS_KEY, label: 'KYC settings', icon: 'pi pi-verified', columns: [] });
        // "Pending approvals" del cliente: mismas operaciones y permisos que la página global
        // (la ruta /pending-approvals se gatea por clientFinancials).
        if (this.canFinancials || this.canKyc) {
          out.push({ key: PENDING_KEY, label: 'Pending approvals', icon: 'pi pi-inbox', columns: [] });
        }
        if (this.canActivityWarnings) {
          out.push({
            key: ACTIVITY_ALERTS_KEY,
            label: 'Activity alerts',
            icon: 'pi pi-exclamation-triangle',
            columns: [],
          });
        }
        if (this.canAdminActions) {
          out.push({ key: ADMIN_KEY, label: 'Admin actions', icon: 'pi pi-cog', columns: [] });
        }
      }
    }
    return out;
  });

  /**
   * Identidad del cliente para el detalle de risk profile embebido. El comparador `equal`
   * conserva la MISMA referencia mientras id/email no cambien: así, al sincronizar el perfil
   * (que reemplaza `selected`) no se dispara una recarga en bucle del componente hijo.
   */
  readonly riskClientRef = computed<RiskProfileClientRef | null>(
    () => {
      const client = this.selected();
      if (!client) return null;
      return { id: String(client['id']), email: String(client['email']) };
    },
    { equal: (a, b) => a?.id === b?.id && a?.email === b?.email },
  );

  /** Datos del cliente para la categoría "Admin actions" (cliente: sin nickname, nunca self). */
  readonly adminUser = computed<AdminActionsUser | null>(() => {
    const client = this.selected();
    if (!client) return null;
    return {
      id: String(client['id']),
      email: String(client['email']),
      nickname: (client['nickname'] as string | null | undefined) ?? null,
      isStaff: false,
      isSelf: false,
    };
  });

  /** Identidad del cliente para el panel de conversaciones internas. */
  readonly internalClientRef = computed<{ id: string; email: string } | null>(() => {
    const client = this.selected();
    if (!client) return null;
    return { id: String(client['id']), email: String(client['email']) };
  });

  /**
   * ¿Puede el rol actual crear/responder conversaciones internas de ESTE cliente? El compliance
   * officer puede con cualquiera; el compliance solo con los clientes asignados a él (espejo del
   * backend: `isComplianceOfficer ? findUserById : findAssignedClientForCompliance`).
   */
  readonly canWriteInternal = computed(() => {
    if (!this.auth.hasAnyRole(STAFF_PERMISSIONS.internalMessagesWrite)) return false;
    if (this.auth.currentRole() === STAFF_ROLES.complianceOfficer) return true;
    const assignments = this.selected()?.['complianceAssignmentsAsClient'];
    const myId = this.auth.currentUserId();
    return (
      Array.isArray(assignments) &&
      assignments.some((a) => {
        const cu = (a as Record<string, unknown>)['complianceUser'] as { id?: string } | undefined;
        return !!cu && cu.id === myId;
      })
    );
  });

  /**
   * El compliance officer puede gestionar alertas de cualquier cliente; el compliance solo cuando
   * el cliente está asignado a él.
   */
  readonly canManageActivityWarnings = computed(() => {
    if (!this.auth.hasAnyRole(STAFF_PERMISSIONS.activityWarningsManage)) return false;
    if (this.auth.currentRole() === STAFF_ROLES.complianceOfficer) return true;
    return this.isCurrentUserAssignedCompliance();
  });

  /** Solicitar una nueva auditoría KYCAID: officer global; compliance solo asignado. */
  readonly canRequestWalletKycaidAudit = computed(() => {
    if (!this.auth.hasAnyRole(STAFF_PERMISSIONS.walletKycaidAuditCreate)) return false;
    if (this.auth.currentRole() === STAFF_ROLES.complianceOfficer) return true;
    return this.isCurrentUserAssignedCompliance();
  });

  private isCurrentUserAssignedCompliance(): boolean {
    const assignments = this.selected()?.['complianceAssignmentsAsClient'];
    const myId = this.auth.currentUserId();
    return (
      Array.isArray(assignments) &&
      assignments.some((a) => {
        const cu = (a as Record<string, unknown>)['complianceUser'] as { id?: string } | undefined;
        return !!cu && cu.id === myId;
      })
    );
  }

  readonly loading = signal(false);
  readonly all = signal<Record<string, unknown>[]>([]);
  readonly search = signal('');
  readonly view = signal<'list' | 'detail'>('list');
  /** true = se muestra el formulario de alta de usuario en lugar del listado. */
  readonly creatingUser = signal(false);
  readonly selected = signal<Record<string, unknown> | null>(null);
  readonly detailLoading = signal(false);
  readonly activeEntity = signal<string>(PROFILE_KEY);
  /** Elemento concreto en el que se ha hecho drill-down (null = se ve la tabla). */
  readonly drillItem = signal<Record<string, unknown> | null>(null);


  // ---- Documents ----
  readonly activeDocTab = signal<string>(DOCUMENT_TABS[0].key);
  readonly downloadingDocId = signal<string | null>(null);
  readonly viewingDocId = signal<string | null>(null);

  // ---- PDF de transacciones (historial completo / individual) ----
  readonly downloadingAllTxPdf = signal(false);
  readonly downloadingTxPdfId = signal<string | null>(null);

  // ---- Descarga de documentos de un requirement (plantilla / archivo del cliente) ----
  readonly downloadingReqFile = signal<string | null>(null);

  // ---- Acciones (estado) ----
  readonly actionBusy = signal(false);
  txTarget: SettableTransactionState | '' = '';

  // ---- Crear requirement para el cliente (botón dentro de la pestaña Requirements) ----
  readonly reqFormOpen = signal(false);
  readonly reqDocType = signal<RequirementDocumentType | ''>('');
  reqName = '';
  reqDescription = '';
  reqLinkId = '';
  readonly reqFiles = signal<File[]>([]);
  readonly reqCreating = signal(false);
  readonly reqRequiresBank = computed(() => this.reqDocType() === 'client_bank');
  readonly reqRequiresTx = computed(() => this.reqDocType() === 'additional_evidence_transaction');
  readonly reqBankOptions = computed<Record<string, unknown>[]>(() => {
    const arr = this.selected()?.['clientBankAccounts'];
    return Array.isArray(arr) ? (arr as Record<string, unknown>[]) : [];
  });
  readonly reqTxOptions = computed<Record<string, unknown>[]>(() => {
    const arr = this.selected()?.['transactions'];
    return Array.isArray(arr) ? (arr as Record<string, unknown>[]) : [];
  });

  /** Requirements embebidos del cliente (colección `requirementsCustomer`) para la vista por pestañas. */
  readonly customerRequirements = computed<Requirement[]>(() => {
    const arr = this.selected()?.['requirementsCustomer'];
    return Array.isArray(arr) ? (arr as Requirement[]) : [];
  });

  onRequirementChanged(requirement: Requirement): void {
    const clientId = this.selected()?.['id'];
    if (!clientId) return;

    const apply = (client: Record<string, unknown>): Record<string, unknown> => {
      if (client['id'] !== clientId) return client;
      const current = Array.isArray(client['requirementsCustomer'])
        ? (client['requirementsCustomer'] as Requirement[])
        : [];
      const next = current.some((item) => item.id === requirement.id)
        ? current.map((item) => item.id === requirement.id ? requirement : item)
        : [requirement, ...current];

      return {
        ...client,
        requirementsCustomer: next,
      };
    };

    const current = this.selected();
    if (current) this.selected.set(apply(current));
    this.all.update((clients) => clients.map(apply));
  }

  // ---- Cambiar estado de la cuenta del cliente (categoría "Account state") ----
  stateTarget: ManualClientState | '' = '';
  readonly stateSaving = signal(false);
  // ---- Acción sobre el KYC (misma categoría) ----
  kycTarget: KycAction | '' = '';
  readonly kycSaving = signal(false);
  readonly kycHistory = signal<StaffKycHistoryItem[]>([]);
  readonly kycHistoryTotal = signal(0);
  readonly kycHistoryPage = signal(1);
  readonly kycHistoryPageSize = signal(10);
  readonly kycHistoryLoading = signal(false);
  readonly kycHistoryError = signal('');
  readonly historicalKyc = signal<StaffKycHistoryItem | null>(null);
  private kycHistoryRequestSeq = 0;

  // ---- Documentos asociados al item (bank account / transaction) ----
  readonly showItemDocs = signal(false);
  readonly itemDocs = computed<Record<string, unknown>[]>(() => {
    const docs = this.drillItem()?.['documents'];
    return Array.isArray(docs) ? (docs as Record<string, unknown>[]) : [];
  });
  readonly itemDocType = computed<RequirementDocumentType | null>(() => {
    if (this.activeEntity() === BANK_KEY) return 'client_bank';
    if (this.activeEntity() === TX_KEY) return 'additional_evidence_transaction';
    return null;
  });

  // ---- Auditoría KYCAID de wallets ----
  readonly walletAuditDialogVisible = signal(false);
  readonly walletAuditLoading = signal(false);
  readonly walletAuditBusy = signal(false);
  readonly walletAuditError = signal('');
  readonly walletAudit = signal<KycaidWalletAudit | null>(null);
  readonly walletAuditWallet = signal<Record<string, unknown> | null>(null);
  readonly walletAuditDialogMode = signal<WalletAuditDialogMode>('latest');
  readonly walletAuditHistoryVisible = signal(false);
  readonly walletAudits = signal<KycaidWalletAudit[]>([]);
  readonly walletAuditsTotal = signal(0);
  readonly walletAuditsPage = signal(1);
  readonly walletAuditsPageSize = signal(10);
  readonly walletAuditsLoading = signal(false);
  readonly walletAuditsError = signal('');
  private walletAuditRequestSeq = 0;
  private walletAuditsRequestSeq = 0;

  readonly filtered = computed(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) return this.all();
    return this.all().filter((u) => String(u['email'] ?? '').toLowerCase().includes(query));
  });

  readonly accountSettingsGroups = computed<FieldGroup[]>(() => {
    const client = this.selected();
    if (!client) return [];
    return [
      {
        title: 'Identity',
        fields: [
          { label: 'User ID', value: this.format(client['id']), mono: true },
          { label: 'Email', value: this.format(client['email']), mono: true },
          { label: 'Account type', value: this.typeLabel(client['type']), mono: false },
          { label: 'Role', value: this.roleLabel(client['role']), mono: false },
        ],
      },
      {
        title: 'Status & activity',
        fields: [
          { label: 'Account state', value: this.stateLabel(client['state']), mono: false, badge: true, badgeValue: client['state'] },
          { label: 'Created', value: this.format(client['createdAt']), mono: false },
          { label: 'Updated', value: this.format(client['updatedAt']), mono: false },
          { label: 'Last login', value: this.format(client['lastLoginAt']), mono: false },
        ],
      },
    ];
  });

  readonly metadataFields = computed<InfoField[]>(() =>
    this.objectFields(this.asRecord(this.selected()?.['clientMetadata']), ['client']),
  );

  readonly activeKyc = computed<StaffKycHistoryItem | null>(() => {
    const client = this.selected();
    const kyc = this.asRecord(client?.['kyc']);
    if (!kyc) return null;
    return {
      ...(kyc as StaffKycHistoryItem),
      personalData: (this.asRecord(client?.['personalData']) as StaffKycHistoryItem['personalData']) ?? null,
      kycDocuments: this.asArray<Record<string, unknown>>(client?.['kycDocuments']) as StaffKycHistoryItem['kycDocuments'],
    };
  });

  readonly entityItems = computed<Record<string, unknown>[]>(() => {
    const client = this.selected();
    const key = this.activeEntity();
    if (!client || key === PROFILE_KEY || key === DOCUMENTS_KEY) return [];
    const items = this.resolvePath(client, key);
    if (!Array.isArray(items)) return [];
    return (items as Record<string, unknown>[]).map((item) => this.enrichSelfRefs(item, client));
  });

  readonly currentColumns = computed<EntityColumn[]>(
    () => this.entityGroups().find((g) => g.key === this.activeEntity())?.columns ?? [],
  );

  readonly activeLabel = computed(
    () => this.entityGroups().find((g) => g.key === this.activeEntity())?.label ?? '',
  );

  readonly actionableEntity = computed(() =>
    [WALLET_KEY, BANK_KEY, TX_KEY].includes(this.activeEntity()),
  );

  readonly walletAuditDialogTitle = computed(() =>
    this.walletAuditDialogMode() === 'detail' ? 'KYCAID wallet audit detail' : 'KYCAID wallet audit',
  );
  readonly walletAuditHistoryWallet = computed<Record<string, unknown> | null>(() =>
    this.activeEntity() === WALLET_KEY && this.walletAuditHistoryVisible() ? this.drillItem() : null,
  );

  // ---- Documents ----
  readonly docItems = computed<Record<string, unknown>[]>(() => {
    const tab = DOCUMENT_TABS.find((t) => t.key === this.activeDocTab());
    const items = tab ? this.resolvePath(this.selected(), tab.collectionKey) : null;
    return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
  });
  readonly documentsTotal = computed(() =>
    DOCUMENT_TABS.reduce((sum, t) => {
      const items = this.resolvePath(this.selected(), t.collectionKey);
      return sum + (Array.isArray(items) ? items.length : 0);
    }, 0),
  );

  ngOnInit(): void {
    void this.load().then(() => {
      // Deep-link: /clients?client=<id> abre el detalle directamente (p. ej. desde
      // compliance assignments). Si el cliente no es visible para el rol, se ignora.
      const clientId = this.route.snapshot.queryParamMap.get('client');
      if (!clientId) return;
      const found = this.all().find((u) => u['id'] === clientId);
      if (found) this.openDetail(found);
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.api.listClients();
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

  // ---- Categoría: Admin actions (editar datos / borrar) ----
  onClientUpdated(data: { email: string; nickname: string | null }): void {
    const id = this.selected()?.['id'];
    if (!id) return;
    const apply = (c: Record<string, unknown>): Record<string, unknown> =>
      c['id'] === id ? { ...c, email: data.email, nickname: data.nickname } : c;
    const current = this.selected();
    if (current) this.selected.set(apply(current));
    this.all.update((list) => list.map(apply));
  }

  onClientDeleted(id: string): void {
    this.all.update((list) => list.filter((c) => c['id'] !== id));
    this.backToList();
  }

  openDetail(row: Record<string, unknown>): void {
    const clientId = String(row['id'] ?? '');
    this.selected.set(row);
    this.activeEntity.set(PROFILE_KEY);
    this.drillItem.set(null);
    this.showItemDocs.set(false);
    this.walletAuditHistoryVisible.set(false);
    this.resetKycHistory();
    this.view.set('detail');

    if (!clientId) return;
    this.detailLoading.set(true);
    this.api.getUser(clientId)
      .then((client) => {
        const detail = client as unknown as Record<string, unknown>;
        if (this.selected()?.['id'] !== clientId) return;
        this.selected.set(detail);
        this.all.update((clients) =>
          clients.map((item) => item['id'] === clientId ? { ...item, ...detail } : item),
        );
      })
      .catch((err) => this.toast('error', 'Could not load client detail', this.errorOf(err)))
      .finally(() => {
        if (this.selected()?.['id'] === clientId) {
          this.detailLoading.set(false);
        }
      });
  }

  onDrill(item: Record<string, unknown>): void {
    this.showItemDocs.set(false);
    this.walletAuditHistoryVisible.set(false);
    this.drillItem.set(item);
  }

  toggleItemDocs(): void {
    this.showItemDocs.update((v) => !v);
  }

  backToList(): void {
    this.view.set('list');
    this.selected.set(null);
    this.detailLoading.set(false);
    this.drillItem.set(null);
    this.walletAuditHistoryVisible.set(false);
    this.resetKycHistory();
  }

  selectEntity(key: string): void {
    this.activeEntity.set(key);
    this.drillItem.set(null);
    this.txTarget = '';
    this.showItemDocs.set(false);
    this.reqFormOpen.set(false);
    this.walletAuditHistoryVisible.set(false);
    if (key === DOCUMENTS_KEY) this.activeDocTab.set(DOCUMENT_TABS[0].key);
    if (key === ACCOUNT_SETTINGS_KEY) {
      this.stateTarget = this.manualClientStateOrEmpty(this.selected()?.['state']);
    }
    if (key === KYC_SETTINGS_KEY) {
      this.kycTarget = '';
      this.historicalKyc.set(null);
      void this.loadKycHistory(1, this.kycHistoryPageSize());
    }
  }

  closeItem(): void {
    this.drillItem.set(null);
    this.txTarget = '';
    this.showItemDocs.set(false);
    this.walletAuditHistoryVisible.set(false);
  }

  // ---- Categoría: risk profile (detalle embebido reutilizable) ----

  /** El detalle de risk profile avisa del perfil cargado/creado/editado; sincroniza el cliente. */
  onClientRiskSynced(profile: RiskProfile | null): void {
    const id = this.selected()?.['id'];
    if (!id) return;
    const apply = (c: Record<string, unknown>): Record<string, unknown> =>
      c['id'] === id ? { ...c, riskProfile: profile } : c;
    const current = this.selected();
    if (current) this.selected.set(apply(current));
    this.all.update((list) => list.map(apply));
  }

  // ---- Categoría: Account state (cambiar estado del cliente) ----

  /** Etiqueta legible para un estado de cliente (p. ej. "kyc_pending" -> "KYC pending"). */
  stateLabel(raw: unknown): string {
    const value = String(raw ?? '');
    return CLIENT_STATE_LABELS.find((o) => o.value === value)?.label ?? this.humanize(value);
  }

  /** Etiqueta legible para el tipo de cuenta (p. ej. "personal" -> "Personal"). */
  typeLabel(raw: unknown): string {
    const value = String(raw ?? '');
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : '-';
  }

  onStateTargetChange(value: string): void {
    this.stateTarget = this.manualClientStateOrEmpty(value);
  }

  applyClientState(): void {
    const client = this.selected();
    const id = client?.['id'] as string | undefined;
    const current = client?.['state'] as string | undefined;
    const next = this.stateTarget;
    if (!id || !next || next === current) return;

    const danger = next === 'blocked' || next === 'restricted';
    this.confirm.confirm({
      header: 'Change account state',
      message: `Set this client's state to "${this.stateLabel(next)}"?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Confirm',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: danger ? 'p-button-danger' : undefined,
      rejectButtonStyleClass: 'p-button-text',
      accept: () => {
        this.stateSaving.set(true);
        this.api
          .changeUserState(id, { clientState: next })
          .then((res) => {
            this.patchSelectedState(id, next);
            this.toast('success', 'State updated', res.message ?? 'Done.');
          })
          .catch((err) => this.toast('error', 'Could not update state', this.errorOf(err)))
          .finally(() => this.stateSaving.set(false));
      },
    });
  }

  /** Refleja el nuevo estado en el cliente seleccionado y en el listado, sin recargar. */
  private patchSelectedState(id: string, next: string): void {
    const apply = (c: Record<string, unknown>): Record<string, unknown> =>
      c['id'] === id ? { ...c, state: next } : c;
    const current = this.selected();
    if (current) this.selected.set(apply(current));
    this.all.update((list) => list.map(apply));
  }

  private manualClientStateOrEmpty(raw: unknown): ManualClientState | '' {
    const value = String(raw ?? '') as ManualClientState;
    return MANUAL_CLIENT_STATE_VALUES.includes(value) ? value : '';
  }

  onKycTargetChange(value: string): void {
    this.kycTarget = value as KycAction | '';
  }

  applyKycAction(): void {
    const id = this.selected()?.['id'] as string | undefined;
    const action = this.kycTarget;
    if (!id || !action) return;

    const danger = KYC_ACTIONS.find((a) => a.value === action)?.danger ?? false;
    const messages: Record<KycAction, string> = {
      verify: "Approve this client's KYC?",
      sync: "Re-sync this client's KYC data from KYCAID?",
      restricted: "Set this client's KYC to restricted?",
      reset: "Reset this client's KYC? The current KYC will be archived and a new active KYC will be created.",
    };
    this.confirm.confirm({
      header: 'Change KYC state',
      message: messages[action],
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Confirm',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: danger ? 'p-button-danger' : undefined,
      rejectButtonStyleClass: 'p-button-text',
      accept: () => {
        this.kycSaving.set(true);
        this.kycCall(id, action)
          .then((res) => {
            this.toast('success', 'KYC updated', res.message ?? 'Done.');
            this.kycTarget = '';
            // Una acción de KYC puede arrastrar el estado de la cuenta: recargamos para reflejar ambos.
            return this.reloadSelectedClient();
          })
          .then(() => {
            this.stateTarget = this.manualClientStateOrEmpty(this.selected()?.['state']);
            if (this.activeEntity() === KYC_SETTINGS_KEY) {
              return this.loadKycHistory(1, this.kycHistoryPageSize());
            }
            return undefined;
          })
          .catch((err) => this.toast('error', 'Could not update KYC', this.errorOf(err)))
          .finally(() => this.kycSaving.set(false));
      },
    });
  }

  private kycCall(id: string, action: KycAction) {
    switch (action) {
      case 'verify':
        return this.api.verifyKyc(id);
      case 'sync':
        return this.api.syncKyc(id);
      case 'restricted':
        return this.api.restrictKyc(id);
      case 'reset':
        return this.api.resetKyc(id);
    }
  }

  onKycHistoryPage(event: { first?: number | null; rows?: number | null }): void {
    const pageSize = Number(event.rows ?? this.kycHistoryPageSize());
    const first = Number(event.first ?? 0);
    const page = Math.floor(first / pageSize) + 1;
    void this.loadKycHistory(page, pageSize);
  }

  openHistoricalKyc(kyc: StaffKycHistoryItem): void {
    this.historicalKyc.set(kyc);
  }

  closeHistoricalKyc(): void {
    this.historicalKyc.set(null);
  }

  isSelectedHistoricalKyc(kyc: StaffKycHistoryItem): boolean {
    return this.historicalKyc()?.id === kyc.id;
  }

  private async loadKycHistory(page: number, pageSize: number): Promise<void> {
    const clientId = this.selected()?.['id'] as string | undefined;
    if (!clientId) {
      this.resetKycHistory();
      return;
    }

    const requestSeq = ++this.kycHistoryRequestSeq;
    this.kycHistoryLoading.set(true);
    this.kycHistoryError.set('');

    try {
      const res = await this.api.listClientKycHistory(clientId, page, pageSize);
      if (requestSeq !== this.kycHistoryRequestSeq) return;
      this.kycHistory.set(res.kycs ?? []);
      this.kycHistoryTotal.set(res.total ?? 0);
      this.kycHistoryPage.set(res.page ?? page);
      this.kycHistoryPageSize.set(res.pageSize ?? pageSize);

      const selectedId = this.historicalKyc()?.id;
      if (selectedId && !(res.kycs ?? []).some((kyc) => kyc.id === selectedId)) {
        this.historicalKyc.set(null);
      }
    } catch (err) {
      if (requestSeq !== this.kycHistoryRequestSeq) return;
      this.kycHistory.set([]);
      this.historicalKyc.set(null);
      this.kycHistoryError.set(this.errorOf(err));
    } finally {
      if (requestSeq === this.kycHistoryRequestSeq) this.kycHistoryLoading.set(false);
    }
  }

  private resetKycHistory(): void {
    this.kycHistoryRequestSeq++;
    this.kycHistory.set([]);
    this.kycHistoryTotal.set(0);
    this.kycHistoryPage.set(1);
    this.kycHistoryError.set('');
    this.kycHistoryLoading.set(false);
    this.historicalKyc.set(null);
  }

  // ---- Crear requirement (botón dentro de la pestaña Requirements) ----

  toggleReqForm(): void {
    this.reqFormOpen.update((open) => {
      const next = !open;
      if (next) this.resetRequirementForm();
      return next;
    });
  }

  onReqDocTypeChange(value: string): void {
    this.reqDocType.set(value as RequirementDocumentType | '');
    this.reqLinkId = '';
  }

  onReqFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.reqFiles.set(Array.from(input.files ?? []));
  }

  async submitRequirement(): Promise<void> {
    const customerUserId = this.selected()?.['id'] as string | undefined;
    const documentType = this.reqDocType();
    const name = this.reqName.trim();
    const description = this.reqDescription.trim();
    if (!customerUserId || !documentType) {
      this.toast('error', 'Missing data', 'Select a document type first.');
      return;
    }
    if (!name || !description) {
      this.toast('error', 'Missing data', 'Name and description are required.');
      return;
    }
    if (this.reqRequiresBank() && !this.reqLinkId) {
      this.toast('error', 'Bank account required', 'Select the client bank account to link.');
      return;
    }
    if (this.reqRequiresTx() && !this.reqLinkId) {
      this.toast('error', 'Transaction required', 'Select the transaction to link.');
      return;
    }
    this.reqCreating.set(true);
    try {
      const res = await this.api.createRequirement({
        customerUserId,
        name,
        description,
        documentType,
        clientBankId: this.reqRequiresBank() ? this.reqLinkId : undefined,
        transactionOrderId: this.reqRequiresTx() ? this.reqLinkId : undefined,
        files: this.reqFiles(),
      });
      this.toast('success', 'Requirement created', res.message ?? 'The requirement was created.');
      this.resetRequirementForm();
      await this.reloadSelectedClient();
      this.selectEntity('requirementsCustomer');
    } catch (err) {
      this.toast('error', 'Could not create requirement', this.errorOf(err));
    } finally {
      this.reqCreating.set(false);
    }
  }

  private resetRequirementForm(): void {
    this.reqDocType.set('');
    this.reqName = '';
    this.reqDescription = '';
    this.reqLinkId = '';
    this.reqFiles.set([]);
  }

  /** Recarga el detalle completo del cliente seleccionado (para refrescar sus colecciones). */
  private async reloadSelectedClient(): Promise<void> {
    const id = this.selected()?.['id'];
    if (!id) return;
    const detail = await this.api.getUser(String(id));
    const record = detail as unknown as Record<string, unknown>;
    this.selected.set(record);
    this.all.update((clients) =>
      clients.map((item) => item['id'] === id ? { ...item, ...record } : item),
    );
  }

  onDocTabChange(key: string | number | undefined): void {
    this.activeDocTab.set(String(key ?? DOCUMENT_TABS[0].key));
  }


  entityCount(key: string): number {
    if (key === PROFILE_KEY) return 0;
    if (key === DOCUMENTS_KEY) return this.documentsTotal();
    const items = this.resolvePath(this.selected(), key);
    return Array.isArray(items) ? items.length : 0;
  }

  /** Las categorías sintéticas no muestran contador. */
  hasCount(key: string): boolean {
    return (
      key !== PROFILE_KEY &&
      key !== RISK_PROFILE_KEY &&
      key !== ACCOUNT_SETTINGS_KEY &&
      key !== KYC_SETTINGS_KEY &&
      key !== ADMIN_KEY &&
      key !== PENDING_KEY &&
      key !== ACTIVITY_ALERTS_KEY
    );
  }

  itemTitle(item: Record<string, unknown>): string {
    const client = item['clientUser'] as { email?: string } | undefined;
    return String(
      item['subject'] ??
        item['name'] ??
        item['title'] ??
        item['accountHolder'] ??
        item['iban'] ??
        item['publicAddress'] ??
        client?.email ??
        item['id'] ??
        'Item',
    );
  }

  value(row: Record<string, unknown>, field: string): string {
    const value = this.resolvePath(row, field);
    return formatAmountByField(field, value as string | number | null | undefined) ?? this.format(value);
  }

  kycState(row: Record<string, unknown>): string {
    const kyc = row['kyc'];
    if (kyc && typeof kyc === 'object' && !Array.isArray(kyc)) {
      const data = kyc as Record<string, unknown>;
      return this.format(data['kycState'] ?? data['state']);
    }
    return this.format(row['kycState']);
  }

  roleLabel(role: unknown): string {
    return String(role ?? '-').replace(/_/g, ' ');
  }

  kycFieldGroups(kyc: StaffKycHistoryItem | null): FieldGroup[] {
    if (!kyc) return [];
    return [
      {
        title: 'Status & verification',
        fields: [
          { label: 'Internal state', value: this.format(kyc.kycState ?? kyc.state), mono: false, badge: true, badgeValue: kyc.kycState ?? kyc.state },
          { label: 'Active', value: this.format(kyc.active), mono: false, badge: true, badgeValue: kyc.active ? 'active' : 'inactive' },
          { label: 'KYCAID status', value: this.format(kyc['kycaidStatus']), mono: false, badge: true, badgeValue: kyc['kycaidStatus'] },
          { label: 'KYCAID verification status', value: this.format(kyc['kycaidVerificationStatus']), mono: false },
          {
            label: 'KYCAID verified',
            value: this.format(kyc['kycaidVerified']),
            mono: false,
            badge: true,
            badgeValue: kyc['kycaidVerified'] === true ? 'verified' : (kyc['kycaidVerified'] === false ? 'restricted' : undefined),
          },
          { label: 'Inactive at', value: this.format(kyc.inactiveAt), mono: false },
        ],
      },
      {
        title: 'Identifiers',
        fields: [
          { label: 'KYC ID', value: this.format(kyc.id), mono: true },
          { label: 'KYCAID verification ID', value: this.format(kyc['kycaidVerificationId']), mono: true },
          { label: 'KYCAID applicant ID', value: this.format(kyc['kycaidApplicantId']), mono: true },
          { label: 'KYCAID external applicant ID', value: this.format(kyc['kycaidExternalApplicantId']), mono: true },
          { label: 'KYCAID form token', value: this.format(kyc['kycaidFormToken']), mono: true },
          { label: 'KYCAID form URL', value: this.format(kyc['kycaidFormUrl']), mono: true, wide: true },
        ],
      },
      {
        title: 'Timeline',
        fields: [
          { label: 'KYCAID started', value: this.format(kyc['kycaidStartedAt']), mono: false },
          { label: 'KYCAID completed', value: this.format(kyc['kycaidCompletedAt']), mono: false },
          { label: 'KYCAID status synced', value: this.format(kyc['kycaidStatusSyncedAt']), mono: false },
          { label: 'Last KYCAID callback', value: this.format(kyc['kycaidLastCallbackAt']), mono: false },
          { label: 'Created', value: this.format(kyc.createdAt), mono: false },
          { label: 'Updated', value: this.format(kyc.updatedAt), mono: false },
        ],
      },
    ];
  }

  personalDataFields(data: unknown): InfoField[] {
    return this.objectFields(this.asRecord(data), ['kyc']);
  }

  kycDocuments(kyc: StaffKycHistoryItem | null): Record<string, unknown>[] {
    return this.asArray<Record<string, unknown>>(kyc?.kycDocuments);
  }

  hasValue(value: unknown): boolean {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
    return true;
  }

  jsonValue(value: unknown): string {
    if (!this.hasValue(value)) return '-';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  badgeClass(value: unknown): string {
    const v = String(value ?? '').toLowerCase();
    if (['approved', 'verified', 'completed', 'active'].includes(v)) return 'cf-badge cf-badge--success';
    if (['blocked', 'restricted', 'rejected', 'denied'].includes(v)) return 'cf-badge cf-badge--danger';
    if (['pending', 'kyc_pending', 'under_review', 'high'].includes(v)) return 'cf-badge cf-badge--warning';
    if (['new', 'kyc_send', 'send', 'in_progress', 'open'].includes(v)) return 'cf-badge cf-badge--info';
    return 'cf-badge cf-badge--neutral';
  }

  // ---- Descarga de documentos ----

  async downloadDoc(doc: Record<string, unknown>, type: RequirementDocumentType): Promise<void> {
    const id = doc['id'] as string | undefined;
    if (!id) return;
    this.downloadingDocId.set(id);
    try {
      const blob = await this.api.downloadClientDocument(type, id);
      this.saveBlob(blob, String(doc['name'] ?? 'document'));
    } catch (err: unknown) {
      this.toast('error', 'Document unavailable', this.downloadErrorMessage(err));
    } finally {
      this.downloadingDocId.set(null);
    }
  }

  // ---- PDF de transacciones (staff) ----

  /** Imprime en PDF el historial completo de transacciones del cliente. */
  async downloadAllTransactionsPdf(): Promise<void> {
    const clientId = this.selected()?.['id'] as string | undefined;
    if (!clientId) return;
    this.downloadingAllTxPdf.set(true);
    try {
      const blob = await this.api.downloadClientTransactionsListPdf(clientId);
      this.saveBlob(blob, `coinforge-transactions-${clientId}.pdf`);
    } catch (err: unknown) {
      this.toast('error', 'Could not generate PDF', this.downloadErrorMessage(err));
    } finally {
      this.downloadingAllTxPdf.set(false);
    }
  }

  /** Imprime en PDF el detalle de una transacción concreta del cliente. */
  async downloadTransactionPdf(item: Record<string, unknown>): Promise<void> {
    const clientId = this.selected()?.['id'] as string | undefined;
    const txId = item['id'] as string | undefined;
    if (!clientId || !txId) return;
    this.downloadingTxPdfId.set(txId);
    try {
      const blob = await this.api.downloadClientTransactionPdf(clientId, txId);
      this.saveBlob(blob, `coinforge-transaction-${txId}.pdf`);
    } catch (err: unknown) {
      this.toast('error', 'Could not generate PDF', this.downloadErrorMessage(err));
    } finally {
      this.downloadingTxPdfId.set(null);
    }
  }

  isDownloadingTxPdf(item: Record<string, unknown>): boolean {
    return this.downloadingTxPdfId() === item['id'];
  }

  // ---- Descarga de documentos de un requirement (igual que la página Requirements) ----

  private reqState(req: Record<string, unknown>): string {
    return String(req['state'] ?? '');
  }

  requirementTemplateFiles(req: Record<string, unknown>): RequirementFile[] {
    const files = req['templateFiles'];
    if (Array.isArray(files)) return files as RequirementFile[];
    return this.requirementFilesBySide(req, 'staff');
  }

  requirementClientFiles(req: Record<string, unknown>): RequirementFile[] {
    const files = req['clientFiles'];
    if (Array.isArray(files)) return files as RequirementFile[];
    return this.requirementFilesBySide(req, 'client');
  }

  private requirementFilesBySide(req: Record<string, unknown>, side: 'staff' | 'client'): RequirementFile[] {
    const files = req['files'];
    return Array.isArray(files)
      ? (files as RequirementFile[]).filter((file) => file.side === side)
      : [];
  }

  canDownloadReqFile(req: Record<string, unknown>, file: RequirementFile): boolean {
    return (
      this.canReadRequirements &&
      !!file.id &&
      this.reqState(req) !== 'approved' &&
      this.reqState(req) !== 'cancelled'
    );
  }

  async downloadRequirementFile(req: Record<string, unknown>, file: RequirementFile): Promise<void> {
    if (!file.id) return;
    this.downloadingReqFile.set(file.id);
    try {
      const blob = await this.api.downloadRequirementFile(file.id);
      this.saveBlob(blob, file.name || String(req['name'] ?? 'requirement-file'));
    } catch (err: unknown) {
      this.toast('error', 'Could not download', this.downloadErrorMessage(err));
    } finally {
      this.downloadingReqFile.set(null);
    }
  }

  isDownloadingReqFile(file: RequirementFile): boolean {
    return this.downloadingReqFile() === file.id;
  }

  reqFileNames(files: File[]): string {
    if (files.length === 0) return 'No files selected';
    if (files.length === 1) return files[0].name;
    return `${files.length} files selected`;
  }

  async viewDoc(doc: Record<string, unknown>, type: RequirementDocumentType): Promise<void> {
    const id = doc['id'] as string | undefined;
    if (!id) return;
    // Abrimos la pestaña de forma síncrona (dentro del gesto del click) para que el
    // navegador no la bloquee como pop-up; luego le ponemos la URL del blob.
    const tab = window.open('', '_blank');
    this.viewingDocId.set(id);
    try {
      const blob = await this.api.viewClientDocument(type, id);
      if (!this.canPreviewBlob(blob)) {
        throw new Error('This file type cannot be previewed. Use Download instead.');
      }

      const url = URL.createObjectURL(blob);
      if (tab) {
        tab.location.href = url;
      } else {
        URL.revokeObjectURL(url);
        throw new Error('The browser blocked the preview window. Allow pop-ups and try again.');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err: unknown) {
      tab?.close();
      this.toast('error', 'Document unavailable', this.downloadErrorMessage(err));
    } finally {
      this.viewingDocId.set(null);
    }
  }

  // ---- Acciones de estado (wallet / bank / transaction) ----

  canVerify(item: Record<string, unknown>): boolean {
    if (!this.canFinancials) return false;
    const s = String(item['state'] ?? '');
    return s !== 'verified' && s !== 'deleted_by_client';
  }
  canBlock(item: Record<string, unknown>): boolean {
    if (!this.canFinancials) return false;
    const s = String(item['state'] ?? '');
    return s !== 'blocked' && s !== 'deleted_by_client';
  }
  canChangeTx(item: Record<string, unknown>): boolean {
    return this.canChangeTxState && String(item['state'] ?? '') !== 'completed';
  }

  canRequestWalletAudit(item: Record<string, unknown>): boolean {
    if (this.activeEntity() !== WALLET_KEY || !this.canRequestWalletKycaidAudit()) return false;
    const state = String(item['state'] ?? '').toLowerCase();
    return !!item['id'] && state !== 'deleted_by_client' && state !== 'not_available';
  }

  async viewWalletAudit(item: Record<string, unknown>): Promise<void> {
    const id = item['id'] as string | undefined;
    if (!id) return;

    const requestSeq = ++this.walletAuditRequestSeq;
    this.walletAuditsRequestSeq++;
    this.walletAuditWallet.set(item);
    this.walletAudit.set(null);
    this.walletAuditError.set('');
    this.walletAuditDialogMode.set('latest');
    this.walletAudits.set([]);
    this.walletAuditsError.set('');
    this.walletAuditDialogVisible.set(true);
    this.walletAuditLoading.set(true);

    try {
      const res = await this.api.getLatestKycaidWalletAudit(id);
      if (requestSeq !== this.walletAuditRequestSeq) return;
      if (res.audit?.walletId && res.audit.walletId !== id) {
        this.walletAudit.set(null);
        this.walletAuditError.set('The returned audit does not belong to the selected wallet.');
        return;
      }
      this.walletAudit.set(res.audit);
      if (res.audit) this.applyLocalWalletAudit(id, res.audit);
    } catch (err) {
      if (requestSeq !== this.walletAuditRequestSeq) return;
      this.walletAuditError.set(this.errorOf(err));
    } finally {
      if (requestSeq === this.walletAuditRequestSeq) this.walletAuditLoading.set(false);
    }
  }

  async viewWalletAuditHistory(item: Record<string, unknown>): Promise<void> {
    const id = item['id'] as string | undefined;
    if (!id) return;

    this.walletAuditRequestSeq++;
    this.walletAuditWallet.set(item);
    this.walletAudit.set(null);
    this.walletAuditError.set('');
    this.walletAudits.set([]);
    this.walletAuditsTotal.set(0);
    this.walletAuditsPage.set(1);
    this.walletAuditsError.set('');
    this.walletAuditHistoryVisible.set(true);
    this.walletAuditDialogVisible.set(false);
    this.showItemDocs.set(false);
    await this.loadWalletAuditHistory(id, 1, this.walletAuditsPageSize());
  }

  backToWalletDetail(): void {
    this.walletAuditHistoryVisible.set(false);
    this.walletAuditsError.set('');
  }

  onWalletAuditsPage(event: { first?: number | null; rows?: number | null }): void {
    const wallet = this.walletAuditWallet();
    const id = wallet?.['id'] as string | undefined;
    if (!id) return;

    const pageSize = Number(event.rows ?? this.walletAuditsPageSize());
    const first = Number(event.first ?? 0);
    const page = Math.floor(first / pageSize) + 1;
    void this.loadWalletAuditHistory(id, page, pageSize);
  }

  openWalletAuditDetail(audit: KycaidWalletAudit): void {
    const walletId = this.walletAuditWallet()?.['id'] as string | undefined;
    if (walletId && audit.walletId && audit.walletId !== walletId) {
      this.walletAudit.set(null);
      this.walletAuditsError.set('The selected audit does not belong to this wallet.');
      return;
    }

    this.walletAuditsError.set('');
    this.walletAudit.set(audit);
    this.walletAuditError.set('');
    this.walletAuditDialogMode.set('detail');
    this.walletAuditDialogVisible.set(true);
  }

  isSelectedWalletAudit(audit: KycaidWalletAudit): boolean {
    return this.walletAudit()?.id === audit.id;
  }

  requestWalletAudit(item: Record<string, unknown>): void {
    const id = item['id'] as string | undefined;
    if (!id) return;

    this.confirm.confirm({
      header: 'Run KYCAID wallet audit',
      message: 'Request a new KYCAID risk audit for this wallet?',
      icon: 'pi pi-search',
      acceptLabel: 'Run audit',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => {
        this.walletAuditsRequestSeq++;
        this.walletAuditBusy.set(true);
        this.api
          .requestKycaidWalletAudit(id)
          .then((res) => {
            if (res.audit?.walletId && res.audit.walletId !== id) {
              this.toast('error', 'Unexpected KYCAID audit', 'The returned audit does not belong to this wallet.');
              return;
            }
            this.walletAuditWallet.set(item);
            this.walletAudit.set(res.audit);
            this.walletAuditError.set('');
            this.walletAuditDialogMode.set('latest');
            this.walletAuditHistoryVisible.set(false);
            this.walletAudits.set([]);
            this.walletAuditsError.set('');
            this.walletAuditDialogVisible.set(true);
            if (res.audit) this.applyLocalWalletAudit(id, res.audit);
            this.toast('success', 'KYCAID audit requested', res.message ?? 'Audit request created.');
          })
          .catch((err) => this.toast('error', 'Could not request audit', this.errorOf(err)))
          .finally(() => this.walletAuditBusy.set(false));
      },
    });
  }

  private async loadWalletAuditHistory(walletId: string, page: number, pageSize: number): Promise<void> {
    const requestSeq = ++this.walletAuditsRequestSeq;
    this.walletAuditsLoading.set(true);
    this.walletAuditsError.set('');

    try {
      const res = await this.api.listKycaidWalletAudits(walletId, page, pageSize);
      if (requestSeq !== this.walletAuditsRequestSeq) return;

      if ((res.audits ?? []).some((audit) => audit.walletId && audit.walletId !== walletId)) {
        this.walletAudits.set([]);
        this.walletAudit.set(null);
        this.walletAuditsError.set('The returned audits do not belong to the selected wallet.');
        return;
      }

      this.walletAudits.set(res.audits ?? []);
      this.walletAuditsTotal.set(res.total ?? 0);
      this.walletAuditsPage.set(res.page ?? page);
      this.walletAuditsPageSize.set(res.pageSize ?? pageSize);
      this.walletAudit.set(null);
    } catch (err) {
      if (requestSeq !== this.walletAuditsRequestSeq) return;
      this.walletAudits.set([]);
      this.walletAudit.set(null);
      this.walletAuditsError.set(this.errorOf(err));
    } finally {
      if (requestSeq === this.walletAuditsRequestSeq) this.walletAuditsLoading.set(false);
    }
  }

  walletAuditFields(audit: KycaidWalletAudit): InfoField[] {
    const fields: Array<[string, unknown, boolean?]> = [
      ['Audit ID', audit.id, true],
      ['Asset', audit.asset],
      ['Service request', audit.serviceRequestId, true],
      ['Risk state', this.prettyAuditState(audit.riskState)],
      ['Risk score', audit.riskScore],
      ['Blacklist flag', audit.hasBlacklistFlag],
      ['Blacklist connections', audit.blackListConnections],
      ['Risk reason', audit.riskReason],
      ['PDF report URL', audit.pdfReportUrl, true],
      ['Requested at', audit.requestedAt],
      ['Checked at', audit.checkedAt],
      ['Last callback at', audit.lastCallbackAt],
      ['Created', audit.createdAt],
      ['Updated', audit.updatedAt],
    ];

    return fields.map(([label, value, mono = false]) => ({
      label,
      value: this.format(value),
      mono,
    }));
  }

  walletAuditJson(value: unknown): string {
    if (value === null || value === undefined || value === '') return '-';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  hasAuditPayload(value: unknown): boolean {
    return value !== null && value !== undefined && value !== '';
  }

  walletBlockchain(item: Record<string, unknown> | null): string {
    const blockchain = item?.['blockchain'];
    if (!blockchain) return '-';
    if (typeof blockchain === 'string') return blockchain;
    if (typeof blockchain === 'object') {
      const ref = blockchain as Record<string, unknown>;
      return String(ref['name'] ?? ref['id'] ?? '-');
    }
    return '-';
  }

  walletAuditBadge(value: unknown): string {
    const v = String(value ?? '').toLowerCase();
    if (['clear', 'low'].includes(v)) return 'cf-badge cf-badge--success';
    if (['failed', 'high_risk'].includes(v)) return 'cf-badge cf-badge--danger';
    if (['pending', 'review'].includes(v)) return 'cf-badge cf-badge--warning';
    return 'cf-badge cf-badge--neutral';
  }

  prettyAuditState(value: unknown): string {
    const raw = String(value ?? '');
    if (!raw) return '-';
    return raw
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  verifyItem(item: Record<string, unknown>): void {
    const id = item['id'] as string;
    const isWallet = this.activeEntity() === WALLET_KEY;
    void this.confirmFinancialApprovalWithRequirementCheck({
      header: isWallet ? 'Verify wallet' : 'Verify bank account',
      baseMessage: 'Mark this resource as verified?',
      checkRequirements: () => isWallet
        ? this.requirementWarnings.forWalletClient(String(this.selected()?.['id'] ?? ''))
        : this.requirementWarnings.forBankAccount(id),
      action: () => (isWallet ? this.api.verifyWallet(id) : this.api.verifyClientBankAccount(id)),
      newState: 'verified',
      item,
    });
  }
  blockItem(item: Record<string, unknown>): void {
    const id = item['id'] as string;
    const isWallet = this.activeEntity() === WALLET_KEY;
    this.confirmRun(
      isWallet ? 'Block wallet' : 'Block bank account',
      'Block this resource?',
      true,
      () => (isWallet ? this.api.blockWallet(id) : this.api.blockClientBankAccount(id)),
      'blocked',
      item,
    );
  }
  applyTxState(item: Record<string, unknown>): void {
    if (!this.txTarget) return;
    const id = item['id'] as string;
    const target = this.txTarget;
    void this.confirmFinancialApprovalWithRequirementCheck({
      header: 'Update transaction',
      baseMessage: `Set the transaction to "${this.roleLabel(target)}"?`,
      checkRequirements: () => this.requirementWarnings.forTransaction(id),
      action: () => this.api.updateTransactionState(id, target),
      newState: target,
      item,
    });
  }

  private async confirmFinancialApprovalWithRequirementCheck(config: FinancialApprovalCheck): Promise<void> {
    this.actionBusy.set(true);
    let requirementWarning: string | null = null;
    try {
      requirementWarning = await config.checkRequirements();
    } finally {
      this.actionBusy.set(false);
    }

    this.confirmRun(
      config.header,
      requirementWarning ? `${config.baseMessage} ${requirementWarning}` : config.baseMessage,
      false,
      config.action,
      config.newState,
      config.item,
      requirementWarning ? { icon: 'pi pi-exclamation-triangle', acceptLabel: 'Continue' } : undefined,
    );
  }

  private confirmRun(
    header: string,
    message: string,
    danger: boolean,
    action: () => Promise<{ ok: boolean; message: string }>,
    newState: string,
    item: Record<string, unknown>,
    options?: ConfirmRunOptions,
  ): void {
    this.confirm.confirm({
      header,
      message,
      icon: options?.icon ?? (danger ? 'pi pi-exclamation-triangle' : 'pi pi-check-circle'),
      acceptLabel: options?.acceptLabel ?? 'Confirm',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: danger ? 'p-button-danger' : undefined,
      rejectButtonStyleClass: 'p-button-text',
      accept: () => {
        this.actionBusy.set(true);
        action()
          .then((res) => {
            this.applyLocalState(this.activeEntity(), String(item['id']), newState);
            this.txTarget = '';
            this.toast('success', 'State updated', res.message ?? 'Done.');
          })
          .catch((err) => this.toast('error', 'Action failed', this.errorOf(err)))
          .finally(() => this.actionBusy.set(false));
      },
    });
  }

  /** Refleja el nuevo estado en la colección embebida sin recargar todo. */
  private applyLocalState(collectionKey: string, itemId: string, newState: string): void {
    const client = this.selected();
    if (!client) return;
    const arr = client[collectionKey];
    if (Array.isArray(arr)) {
      for (const it of arr as Record<string, unknown>[]) {
        if (it['id'] === itemId) {
          it['state'] = newState;
          break;
        }
      }
    }
    // Nueva referencia para que los computed (tabla) se recalculen.
    this.selected.set({ ...client });
    const drill = this.drillItem();
    if (drill && drill['id'] === itemId) this.drillItem.set({ ...drill, state: newState });
  }

  private applyLocalWalletAudit(walletId: string, audit: KycaidWalletAudit): void {
    const patch = {
      kycaidRiskState: audit.riskState,
      kycaidRiskScore: audit.riskScore ?? null,
      kycaidRiskReason: audit.riskReason ?? null,
      kycaidPdfReportUrl: audit.pdfReportUrl ?? null,
    };
    const client = this.selected();
    if (client) {
      const wallets = client[WALLET_KEY];
      if (Array.isArray(wallets)) {
        for (const wallet of wallets as Record<string, unknown>[]) {
          if (wallet['id'] === walletId) Object.assign(wallet, patch);
        }
      }
      this.selected.set({ ...client });
    }
    const drill = this.drillItem();
    if (drill && drill['id'] === walletId) this.drillItem.set({ ...drill, ...patch });
  }

  // ---- helpers ----

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? value as T[] : [];
  }

  private objectFields(record: Record<string, unknown> | null, excludeKeys: string[] = []): InfoField[] {
    if (!record) return [];
    const excluded = new Set(excludeKeys);
    return Object.entries(record)
      .filter(([key, value]) => !excluded.has(key) && this.hasValue(value) && typeof value !== 'object')
      .map(([key, value]) => ({
        label: this.humanize(key),
        value: formatAmountByField(key, value as string | number | null | undefined) ?? this.format(value),
        mono: key.toLowerCase().includes('id') || key.toLowerCase().includes('token'),
      }));
  }

  private resolvePath(row: Record<string, unknown> | null, path: string): unknown {
    if (!row) return undefined;
    return path.split('.').reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[key];
    }, row);
  }

  private enrichSelfRefs(item: Record<string, unknown>, client: Record<string, unknown>): Record<string, unknown> {
    const clientId = client['id'];
    let clone: Record<string, unknown> | null = null;

    for (const [key, value] of Object.entries(item)) {
      if (typeof value === 'string' && value === clientId && this.isUserKey(key)) {
        clone ??= { ...item };
        clone[key] = this.minimalClientRef(client);
        continue;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const ref = value as Record<string, unknown>;
        if (ref['id'] === clientId && ref['email'] === undefined) {
          clone ??= { ...item };
          clone[key] = { ...ref, ...this.minimalClientRef(client) };
        }
      }
    }

    return clone ?? item;
  }

  private isUserKey(key: string): boolean {
    return /(user|sender|closedby)/.test(key.replace(/[_\s-]/g, '').toLowerCase());
  }

  private minimalClientRef(client: Record<string, unknown>): Record<string, unknown> {
    return {
      id: client['id'],
      email: client['email'],
      role: client['role'],
      type: client['type'],
      state: client['state'],
      createdAt: client['createdAt'],
    };
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private canPreviewBlob(blob: Blob): boolean {
    const mimeType = blob.type.toLowerCase().split(';', 1)[0];
    return (
      mimeType === 'application/pdf' ||
      mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('text/')
    );
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

  /**
   * Mensaje claro para fallos de descarga (la respuesta es un blob, así que el error
   * del servidor no es legible). Traducimos por código de estado.
   */
  private downloadErrorMessage(err: unknown): string {
    if (err instanceof Error && !('status' in err)) {
      return err.message;
    }

    const status = (err as { status?: number }).status;
    if (status === 404) return 'This document is no longer available.';
    if (status === 403) return 'You are not allowed to access this document.';
    return 'This document file is not accessible. It may be missing on the server.';
  }

  format(value: unknown): string {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString();
    return String(value);
  }

  private humanize(key: string): string {
    const spaced = key.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
}
