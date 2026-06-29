import { HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpRequestOptions, RequestService } from './request.service';
import { SILENT_AUTH_ERROR } from '../core/http-context';
import { assertUploadFilesWithinLimit } from '../shared/upload-file-size';

export interface StandardMessageResponse { ok: boolean; message: string; }
export interface StandardDataResponse<T = unknown> { ok: boolean; message: string; data: T; }
export interface ListUsersResponse { users: StaffUser[]; }
/** Detalle completo (poblado) de un usuario borrado. Solo admin. */
export interface DeletedUserDetailResponse { user: StaffUser; }
export interface ListInactiveUsersResponse {
  ok: boolean;
  users: InactiveUser[];
  total: number;
  page: number;
  pageSize: number;
}
export interface InactiveUserDetailResponse { ok: boolean; user: InactiveUser; }
export interface ListRequirementsResponse {
  requirements: Requirement[];
  total: number;
  page: number;
  pageSize: number;
  countsByState?: Partial<Record<RequirementState, number>>;
}
export interface ListSupportTicketsResponse { tickets: SupportTicket[]; total: number; page: number; pageSize: number; }
export interface ListInternalConversationsResponse { conversations: InternalConversation[]; }
export interface ListActionRequestsResponse { conversations: ActionRequest[]; actionRequests?: ActionRequest[]; }
export interface ListBlockchainsResponse { blockchains: CatalogItem[]; }
export interface ListFiatCurrenciesResponse { fiatCurrencies: CatalogItem[]; }
export interface ListCryptoCurrenciesResponse { cryptoCurrencies: CatalogItem[]; }
export interface ListBankDataResponse { bankAccounts: BankData[]; }
export interface CurrentUserStateResponse { id: string; role: UserRole; state: UserState; email?: string; }
export type PlatformTutorialLanguage = 'en' | 'es' | 'lt';
export interface PlatformTutorialManual {
  title: string;
  audience: string;
  roleGroup: 'admin' | 'operator' | 'compliance' | 'support';
  language: PlatformTutorialLanguage;
  availableLanguages: PlatformTutorialLanguage[];
  markdown: string;
}

export type StaffRole =
  | 'SUPPORT'
  | 'SUPPORT_OFFICER'
  | 'COMPLIANCE'
  | 'COMPLIANCE_OFFICER'
  | 'OPERATOR'
  | 'ADMIN';

export type UserRole = 'INACTIVE' | 'CLIENT' | StaffRole;
export type UserState =
  | 'new'
  | 'kyc_pending'
  | 'kyc_send'
  | 'under_review'
  | 'approved'
  | 'restricted'
  | 'blocked'
  | 'deleted';
export type ManageableUserState = Exclude<UserState, 'deleted'>;
export type ManualClientState = 'under_review' | 'approved' | 'restricted' | 'blocked';
export type StaffState = 'approved' | 'blocked';

export interface StaffKyc {
  id: string;
  state?: string;
  kycState?: string;
  active?: boolean;
  inactiveAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface StaffKycHistoryItem extends StaffKyc {
  personalData?: StaffPersonalData | null;
  kycDocuments?: StaffClientDocument[];
}

export interface StaffClientMetadata {
  id?: string;
  discoverySource?: string;
  understandAndContinue?: boolean;
  acknowledgesAxoraFintech?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface StaffPersonalData {
  id?: string;
  name?: string;
  surname?: string;
  birthDate?: string;
  nationality?: string;
  identificationType?: string;
  identificationNumber?: string;
  expirationIDDate?: string;
  address?: string;
  residenceCountry?: string;
  phoneNumber?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface StaffClientDocument {
  id: string;
  name?: string;
  path?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface StaffUser {
  id: string;
  email: string;
  nickname?: string | null;
  role: UserRole;
  state: UserState;
  type?: string;
  country?: string;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
  /** Vista del KYC activo del cliente. El historial queda en backend y aquí se muestra solo el vigente. */
  kyc?: StaffKyc | null;
  clientMetadata?: StaffClientMetadata | null;
  personalData?: StaffPersonalData | null;
  kycDocuments?: StaffClientDocument[];
  [key: string]: unknown;
}

export interface InactiveUser {
  id: string;
  email: string;
  role: 'INACTIVE';
  state: UserState;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  clientMetadata?: StaffClientMetadata | null;
  [key: string]: unknown;
}

export interface ListClientKycHistoryResponse {
  ok: boolean;
  kycs: StaffKycHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type RequirementState = 'pending' | 'under_review' | 'approved' | 'cancelled';
export type RequirementDocumentType =
  | 'additional_evidence_transaction'
  | 'client_bank'
  | 'kyc'
  | 'legal_declaration'
  | 'source_of_funds'
  | 'source_of_wealth'
  | 'other';
export type RequirementFileSide = 'staff' | 'client';

export interface RequirementFile {
  id: string;
  name: string;
  side: RequirementFileSide;
  createdAt?: string;
  uploadedBy?: StaffUser | null;
}

export interface Requirement {
  id: string;
  name: string;
  description?: string;
  documentType?: RequirementDocumentType;
  state?: RequirementState;
  hasTemplateFile?: boolean;
  hasClientFile?: boolean;
  hasTemplateFiles?: boolean;
  hasClientFiles?: boolean;
  templateFiles?: RequirementFile[];
  clientFiles?: RequirementFile[];
  /**
   * El detalle de cliente embebe la entidad cruda con `files` (cada uno con su `side`),
   * mientras que GET /api/requirement entrega templateFiles/clientFiles ya separados.
   */
  files?: RequirementFile[];
  createdAt?: string;
  updatedAt?: string;
  /** Fecha de aprobación o cancelación (cuando el requirement queda cerrado). */
  closedDate?: string | null;
  customerUser?: StaffUser;
  staffUser?: StaffUser;
  closedBy?: StaffUser | null;
  transactionOrderId?: string | null;
  clientBankAccountId?: string | null;
}

/**
 * Documento final archivado de un requirement aprobado. Al cerrar el requirement,
 * los ficheros del cliente se mueven a la tabla documental de su `documentType` y
 * quedan trazados por `sourceRequirement`; este es el shape para listarlos.
 */
export interface RequirementArchivedDocument {
  id: string;
  name: string;
  documentType: RequirementDocumentType;
  createdAt?: string;
}
export interface ListRequirementDocumentsResponse {
  documents: RequirementArchivedDocument[];
}

export interface CreateRequirementRequest {
  customerUserId: string;
  name: string;
  description: string;
  documentType: RequirementDocumentType;
  /** Solo para documentType 'client_bank'. */
  clientBankId?: string;
  /** Solo para documentType 'additional_evidence_transaction'. */
  transactionOrderId?: string;
  file?: File | null;
  files?: File[];
}
export interface UpdateRequirementRequest {
  name?: string;
  description?: string;
  file?: File | null;
  files?: File[];
  deleteFileIds?: string[];
}

/** Cuenta bancaria de un cliente (para vincular requirements de tipo client_bank). */
export interface ClientBankAccount {
  id: string;
  iban: string;
  bankInstitution?: string;
  country?: string;
  accountHolder?: string;
  state?: string;
  createdAt?: string;
}
export interface ListClientBankAccountsResponse {
  bankAccounts: ClientBankAccount[];
}

/** Transacción de un cliente (para vincular requirements de tipo evidencia de transacción). */
export interface ClientTransaction {
  id: string;
  cryptoSymbol?: string;
  fiatSymbol?: string;
  amountSent?: string;
  amountReceive?: string;
  termsAccepted?: boolean;
  state?: string;
  createdAt?: string;
}
export interface ListClientTransactionsResponse {
  volume?: number;
  frequency?: number;
  count?: number;
  transactions: ClientTransaction[];
}

export interface ComplianceAssignment {
  id: string;
  createdAt?: string;
  clientUser?: StaffUser;
  complianceUser?: StaffUser;
  assignedByUser?: StaffUser | null;
}
export interface ListComplianceAssignmentsResponse {
  assignments: ComplianceAssignment[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ListUnassignedClientsResponse {
  clients: StaffUser[];
  total: number;
  page: number;
  pageSize: number;
}
export interface CreateComplianceAssignmentRequest {
  clientUserId: string;
  /** Solo lo envía el compliance officer; el compliance "raso" se asigna a sí mismo. */
  complianceUserId?: string;
}
export interface ReassignComplianceAssignmentRequest {
  complianceUserId: string;
  reason?: string;
}
export interface ReassignComplianceAssignmentResponse {
  ok: boolean;
  message: string;
  data?: {
    assignment?: ComplianceAssignment;
    transferredRequirements?: number;
    transferredConversations?: number;
  };
}
export interface ComplianceAssignmentHistory {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  reason?: string | null;
  assignment?: Pick<ComplianceAssignment, 'id' | 'createdAt'> & { updatedAt?: string } | null;
  clientUser?: StaffUser | null;
  previousComplianceUser?: StaffUser | null;
  newComplianceUser?: StaffUser | null;
  reassignedByUser?: StaffUser | null;
}
export interface ListComplianceAssignmentHistoryResponse {
  ok: boolean;
  history: ComplianceAssignmentHistory[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ComplianceAssignmentHistoryDetailResponse {
  ok: boolean;
  history: ComplianceAssignmentHistory;
}

export type WalletState = 'pending' | 'verified' | 'blocked' | 'deleted_by_client' | 'not_available';
export interface Wallet {
  id: string;
  publicAddress?: string;
  blockchain?: { id: string; name?: string } | string | null;
  state?: WalletState;
  acceptedTermOfUse?: boolean;
  kycaidRiskState?: string;
  kycaidRiskScore?: string | null;
  kycaidRiskReason?: string | null;
  kycaidPdfReportUrl?: string | null;
  createdAt?: string;
}
export interface ListWalletsResponse { wallets: Wallet[]; }

export interface KycaidWalletAudit {
  id: string;
  walletId?: string | null;
  asset?: string | null;
  serviceRequestId?: string | null;
  riskState: string;
  riskScore?: string | null;
  hasBlacklistFlag?: boolean | null;
  blackListConnections?: boolean | null;
  riskSignals?: unknown;
  riskReason?: string | null;
  pdfReportUrl?: string | null;
  rawResult?: unknown;
  rawLastCallback?: unknown;
  requestedAt?: string | null;
  checkedAt?: string | null;
  lastCallbackAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface KycaidWalletAuditResponse {
  ok: boolean;
  message?: string;
  audit: KycaidWalletAudit | null;
}

export interface KycaidWalletAuditListResponse {
  ok: boolean;
  audits: KycaidWalletAudit[];
  total: number;
  page: number;
  pageSize: number;
}

export type TransactionState = 'pending' | 'payment_received' | 'in_progress' | 'completed';
/** Estados a los que el staff puede mover una transacción (no se vuelve a 'pending'). */
export type SettableTransactionState = 'payment_received' | 'in_progress' | 'completed';

// ---- Cola de pendientes de aprobación (listados cross-cliente, paginados) ----
/** Cliente dueño del elemento pendiente (cada listado es cross-cliente). */
export interface PendingClientRef {
  id: string;
  email: string;
}
/** La cola de pendientes se trae completa; la paginación es en el cliente. */
export interface PendingListResponse<T> {
  items: T[];
}
export interface PendingWallet {
  id: string;
  publicAddress?: string;
  state?: WalletState;
  blockchain?: { id: string; name?: string } | null;
  createdAt?: string;
  client: PendingClientRef;
}
export interface PendingBankAccount {
  id: string;
  iban: string;
  bankInstitution?: string;
  country?: string;
  accountHolder?: string;
  state?: string;
  createdAt?: string;
  client: PendingClientRef;
}
export interface PendingTransaction {
  id: string;
  amountSent?: string;
  amountReceive?: string;
  fiatSymbol?: string;
  cryptoSymbol?: string;
  termsAccepted?: boolean;
  state?: string;
  createdAt?: string;
  client: PendingClientRef;
}
export interface PendingKyc {
  id: string;
  state?: string;
  createdAt?: string;
  client: PendingClientRef;
}

export type ActivityWarningState = 'pending' | 'solved';
export type ActivityWarningType = string;

export interface ActivityWarningClientRef {
  id: string;
  email: string;
}

export interface ActivityWarningTransactionRef {
  id: string;
  fiatSymbol?: string;
  amountSent?: string;
  amountSentEur?: string | null;
  cryptoSymbol?: string;
  state?: string;
  createdAt?: string;
}

export interface ActivityWarningWalletRef {
  id: string;
  publicAddress?: string;
  state?: string;
  kycaidRiskState?: string;
  kycaidRiskScore?: string | null;
  kycaidRiskReason?: string | null;
  kycaidPdfReportUrl?: string | null;
  blockchain?: { id: string; name?: string } | null;
}

export interface ActivityWarningReviewerRef {
  id: string;
  email: string;
  nickname?: string | null;
}

export interface ActivityWarning {
  id: string;
  state: ActivityWarningState;
  type: ActivityWarningType;
  summary?: string | null;
  triggerAmountEur?: string | null;
  thresholdAmountEur?: string | null;
  totalAmountEur?: string | null;
  transactionCount?: number | null;
  kycaidServiceRequestId?: string | null;
  kycaidRiskScore?: string | null;
  kycaidRiskReason?: string | null;
  reviewedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  client: ActivityWarningClientRef;
  transaction?: ActivityWarningTransactionRef | null;
  wallet?: ActivityWarningWalletRef | null;
  reviewedBy?: ActivityWarningReviewerRef | null;
}

export interface ListActivityWarningsResponse {
  warnings: ActivityWarning[];
  total: number;
  page: number;
  pageSize: number;
  countsByState?: Partial<Record<ActivityWarningState, number>>;
}

export interface TransactionWarningLimit {
  id: string;
  clientId: string;
  fiatSingleTransactionLimit: string;
  fiatBigSingleTransactionLimit: string;
  fiatAllLowTransactionsLimit: string;
  fiatAllBigTransactionsLimit: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TransactionWarningLimitResponse {
  limit: TransactionWarningLimit;
}

export interface UpdateActivityWarningStateRequest {
  state: ActivityWarningState;
}

export interface UpdateActivityWarningStateResponse extends StandardMessageResponse {
  warning: ActivityWarning;
}

export interface UpdateTransactionWarningLimitRequest {
  fiatSingleTransactionLimit: string;
}

export interface UpdateTransactionWarningLimitResponse extends StandardMessageResponse {
  limit: TransactionWarningLimit;
}

export type RiskLevel = 'pending_review' | 'low' | 'medium' | 'high';
export type RiskFlag = 'none' | 'review' | 'high_risk' | 'suspicious';

export interface RiskNote {
  id: string;
  title: string;
  description: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RiskProfile {
  id: string;
  level: RiskLevel;
  flag: RiskFlag;
  /** Sin poblar llega como id (string); no se usa para mostrar. */
  user?: string | StaffUser | null;
  notes?: RiskNote[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateRiskProfileRequest { userId: string; level: RiskLevel; flag: RiskFlag; }
export interface UpdateRiskProfileRequest { level?: RiskLevel; flag?: RiskFlag; }
export interface CreateRiskNoteRequest { riskProfileId: string; title: string; description: string; }

export interface SupportTicketDocument {
  id: string;
  name?: string;
  createdAt?: string;
}

export interface SupportTicketMessage {
  id: string;
  body: string;
  createdAt?: string;
  updatedAt?: string;
  sender?: StaffUser;
  documents?: SupportTicketDocument[];
}

export interface SupportTicket {
  id: string;
  subject?: string;
  status?: string;
  priority?: string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
  customerUser?: StaffUser;
  supportUser?: StaffUser;
  messages?: SupportTicketMessage[];
}

export interface SupportTicketAssignmentHistory {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  reason?: string | null;
  ticket?: {
    id: string;
    subject?: string;
    status?: string;
    priority?: string;
    customerUser?: StaffUser | null;
  } | null;
  previousSupportUser?: StaffUser | null;
  newSupportUser?: StaffUser | null;
  reassignedByUser?: StaffUser | null;
}

export interface ListSupportTicketAssignmentHistoryResponse {
  ok: boolean;
  history: SupportTicketAssignmentHistory[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InternalMessage {
  id: string;
  body: string;
  createdAt?: string;
  updatedAt?: string;
  readAt?: string | null;
  sender?: StaffUser;
}

export interface InternalConversation {
  id: string;
  subject?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
  customerUser?: StaffUser;
  staffUser?: StaffUser;
  messages?: InternalMessage[];
}

export interface ActionRequestMessage {
  id: string;
  body: string;
  createdAt?: string;
  updatedAt?: string;
  sender?: StaffUser;
}

export interface ActionRequest {
  id: string;
  subject?: string;
  status?: string;
  target?: string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
  staffUserCreator?: StaffUser;
  staffUserAssigned?: StaffUser;
  messages?: ActionRequestMessage[];
}

export interface CatalogItem {
  id: string;
  name?: string;
  symbol?: string;
  createdAt?: string;
  blockchain?: { id: string; name?: string } | string | null;
  blockchainName?: string; // resuelto en el cliente para crypto-currencies
}

export interface BankData {
  id: string;
  name?: string;
  owner?: string;
  iban?: string;
  swiftBic?: string;
  referenceCode?: string;
  createdAt?: string;
  /** Cliente asociado (cuenta dedicada). null/ausente = cuenta general. */
  client?: StaffUser | null;
}

export interface CreateBlockchainRequest { name: string; }
export interface CreateFiatCurrencyRequest { name: string; symbol: string; }
export interface CreateCryptoCurrencyRequest { blockchainId: string; name: string; symbol: string; }
export interface CreateBankDataRequest {
  name: string;
  iban: string;
  owner: string;
  swiftBic: string;
  referenceCode: string;
  /** Cliente al que se asocia la cuenta. Obligatorio para operator; opcional (general) para admin. */
  client?: string;
}
export interface UpdateBankDataRequest {
  name?: string;
  owner?: string;
  swiftBic?: string;
  referenceCode?: string;
}

export interface LoginRequest { email: string; password: string; }
// El login ya no devuelve el token (va en cookie HttpOnly); solo confirma el resultado.
export interface LoginResponse { ok: boolean; }
export interface StartChangePasswordRequest { newPassword: string; }
export interface EndChangePasswordRequest { token: string; }
export interface StartChangeEmailRequest { newEmail: string; }
export interface EndChangeEmailRequest { token: string; }
export interface CreateUserRequest {
  email: string;
  // La contraseña ya NO la fija el staff: el backend envía un código/enlace para que el
  // propio usuario la establezca (POST /api/auth/password/set).
  /** Alias mostrado al cliente. Obligatorio al crear staff; se omite para clientes. */
  nickname?: string;
  state: ManageableUserState;
  roleAdmin?: Exclude<StaffRole, 'ADMIN'> | 'CLIENT';
  roleOperator?: Exclude<StaffRole, 'ADMIN' | 'OPERATOR'> | 'CLIENT';
}
export interface UpdateUserRequest extends Partial<Omit<CreateUserRequest, 'state'>> {
  state?: ManualClientState | StaffState;
}
export interface ChangeUserStateRequest {
  clientState?: ManualClientState;
  staffState?: StaffState;
}
export interface CreateInternalConversationRequest {
  customerUserId: string;
  supportUserId: string;
  subject: string;
  body: string;
}
export interface CreateMessageRequest { body: string; }
export interface CreateActionRequestRequest {
  staffUserCreatorId: string;
  target: string;
  subject: string;
  body: string;
}
export interface UpdateSupportTicketStatusRequest { status: 'open' | 'pending' | 'resolved' | 'closed'; }

export interface PlatformParameters {
  id?: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass?: string;
  backupTransactionsPdfDays: number;
  recoverPasswordCodeTtlHours: number;
  changePasswordCodeTtlHours: number;
  changeEmailCodeTtlHours: number;
  setPasswordCodeTtlHours: number;
  activationCodeTtlHours: number;
}
export interface ParametersRequest {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  backupTransactionsPdfDays: number;
  recoverPasswordCodeTtlHours: number;
  changePasswordCodeTtlHours: number;
  changeEmailCodeTtlHours: number;
  setPasswordCodeTtlHours: number;
  activationCodeTtlHours: number;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly request = inject(RequestService);

  private normalizeStaffKyc<T extends StaffKyc>(kyc: T): T {
    const state = kyc.kycState ?? kyc.state;
    if (!state) return kyc;
    return {
      ...kyc,
      state,
      kycState: state,
    };
  }

  private normalizeStaffUser<T extends StaffUser>(user: T): T {
    if (!user?.kyc) return user;

    return {
      ...user,
      kyc: this.normalizeStaffKyc(user.kyc),
    };
  }

  private normalizeClientKycHistoryResponse(response: ListClientKycHistoryResponse): ListClientKycHistoryResponse {
    return {
      ...response,
      kycs: (response.kycs ?? []).map((kyc) => this.normalizeStaffKyc(kyc)),
    };
  }

  private normalizeListUsersResponse(response: ListUsersResponse): ListUsersResponse {
    return {
      ...response,
      users: (response.users ?? []).map((user) => this.normalizeStaffUser(user)),
    };
  }

  login(body: LoginRequest): Promise<LoginResponse> {
    // La respuesta ya no incluye el token: el backend lo entrega en una cookie HttpOnly.
    return this.request.post<LoginResponse, LoginRequest>('/api/auth/staff/login', body);
  }

  logout(): Promise<{ ok: boolean }> {
    // El backend borra las cookies HttpOnly de staff (el frontend no puede hacerlo desde JS).
    return this.request.post<{ ok: boolean }>('/api/auth/staff/logout');
  }

  startChangePassword(body: StartChangePasswordRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, StartChangePasswordRequest>(
      '/api/auth/password/change/start',
      body,
    );
  }

  endChangePassword(body: EndChangePasswordRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, EndChangePasswordRequest>(
      '/api/auth/password/change/end',
      body,
    );
  }

  startChangeEmail(body: StartChangeEmailRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, StartChangeEmailRequest>(
      '/api/auth/email/change/start',
      body,
    );
  }

  endChangeEmail(body: EndChangeEmailRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, EndChangeEmailRequest>(
      '/api/auth/email/change/end',
      body,
    );
  }

  resetStaffPassword(userId: string): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, { userId: string }>(
      '/api/auth/password/reset',
      { userId },
    );
  }

  /** El usuario establece su contraseña con el código de un solo uso (endpoint público). */
  setPassword(code: string, password: string): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, { code: string; password: string }>(
      '/api/auth/password/set',
      { code, password },
      { context: new HttpContext().set(SILENT_AUTH_ERROR, true) },
    );
  }

  /** Comprueba (sin consumir) si el código de set-password sigue siendo válido. */
  validateSetPasswordCode(code: string): Promise<{ ok: boolean; valid: boolean }> {
    return this.request.get<{ ok: boolean; valid: boolean }>('/api/auth/password/set/validate', {
      params: { code },
      context: new HttpContext().set(SILENT_AUTH_ERROR, true),
    });
  }

  getCurrentUserState(options?: HttpRequestOptions): Promise<CurrentUserStateResponse> {
    return this.request.get<CurrentUserStateResponse>('/api/user/client/control/state', options);
  }

  listClients(): Promise<ListUsersResponse> {
    return this.request
      .get<ListUsersResponse>('/api/user/client/list')
      .then((response) => this.normalizeListUsersResponse(response));
  }

  /** Búsqueda de usuarios para selectores escalables (autocomplete). */
  searchUsers(q: string, type?: 'client' | 'staff', limit = 20): Promise<ListUsersResponse> {
    return this.request.get<ListUsersResponse>('/api/user/search', { params: { q, type, limit } });
  }

  listStaffMembers(): Promise<ListUsersResponse> {
    return this.request.get<ListUsersResponse>('/api/user/staff/list');
  }

  listDeletedUsers(): Promise<ListUsersResponse> {
    return this.request.get<ListUsersResponse>('/api/user/deleted/list');
  }

  listInactiveUsers(page = 1, pageSize = 20, q?: string): Promise<ListInactiveUsersResponse> {
    return this.request.get<ListInactiveUsersResponse>('/api/user/inactive', {
      params: { page, pageSize, q: q?.trim() || undefined },
    });
  }

  getInactiveUser(id: string): Promise<InactiveUserDetailResponse> {
    return this.request.get<InactiveUserDetailResponse>(`/api/user/inactive/${id}`);
  }

  /** Detalle completo (poblado, solo lectura) de un usuario borrado. Solo admin. */
  getDeletedUser(id: string): Promise<DeletedUserDetailResponse> {
    return this.request
      .get<DeletedUserDetailResponse>(`/api/user/deleted/${id}`)
      .then((response) => ({
        ...response,
        user: this.normalizeStaffUser(response.user),
      }));
  }

  getUser(id: string): Promise<StaffUser> {
    return this.request
      .get<StaffUser>(`/api/user/${id}`)
      .then((user) => this.normalizeStaffUser(user));
  }

  listClientKycHistory(id: string, page = 1, pageSize = 10): Promise<ListClientKycHistoryResponse> {
    return this.request
      .get<ListClientKycHistoryResponse>(`/api/user/${id}/kyc-history`, {
        params: { page, pageSize },
      })
      .then((response) => this.normalizeClientKycHistoryResponse(response));
  }

  createUser(body: CreateUserRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, CreateUserRequest>('/api/user', body);
  }

  updateUser(id: string, body: UpdateUserRequest): Promise<StandardDataResponse<StaffUser>> {
    return this.request.patch<StandardDataResponse<StaffUser>, UpdateUserRequest>(`/api/user/${id}`, body);
  }

  deleteUser(id: string): Promise<void> {
    return this.request.delete<void>(`/api/user/${id}`);
  }

  changeUserState(id: string, body: ChangeUserStateRequest): Promise<StandardDataResponse<StaffUser>> {
    return this.request.patch<StandardDataResponse<StaffUser>, ChangeUserStateRequest>(
      `/api/user/state/change/${id}`,
      body,
    );
  }

  listRequirements(query?: {
    page?: number;
    pageSize?: number;
    state?: RequirementState;
    q?: string;
    sortBy?: 'createdAt' | 'updatedAt' | 'closedDate' | 'name' | 'documentType' | 'state' | 'clientEmail' | 'staffEmail';
    sortDir?: 'asc' | 'desc';
  }): Promise<ListRequirementsResponse> {
    return this.request.get<ListRequirementsResponse>('/api/requirement', {
      params: query,
    });
  }

  getRequirement(requirementId: string): Promise<{ requirement: Requirement }> {
    return this.request.get<{ requirement: Requirement }>(`/api/requirement/${requirementId}`);
  }

  /**
   * Documentos finales archivados de un requirement aprobado. El staging se borra al
   * aprobar, así que la lista de archivos de un requirement completado vive en las
   * tablas documentales del cliente; cada uno se descarga/visualiza por documentType+id.
   */
  getRequirementDocuments(requirementId: string): Promise<ListRequirementDocumentsResponse> {
    return this.request.get<ListRequirementDocumentsResponse>(`/api/requirement/${requirementId}/documents`);
  }

  closeRequirement(requirementId: string): Promise<StandardDataResponse<Requirement>> {
    return this.request.patch<StandardDataResponse<Requirement>>(`/api/requirement/staff/close/${requirementId}`);
  }

  rejectRequirement(requirementId: string): Promise<StandardDataResponse<Requirement>> {
    return this.request.patch<StandardDataResponse<Requirement>>(`/api/requirement/staff/reject/${requirementId}`);
  }

  cancelRequirement(requirementId: string): Promise<StandardDataResponse<Requirement>> {
    return this.request.patch<StandardDataResponse<Requirement>>(`/api/requirement/staff/cancel/${requirementId}`);
  }

  createRequirement(body: CreateRequirementRequest): Promise<StandardMessageResponse> {
    const fd = new FormData();
    fd.append('customerUserId', body.customerUserId);
    fd.append('name', body.name);
    fd.append('description', body.description);
    fd.append('documentType', body.documentType);
    if (body.clientBankId) fd.append('clientBankId', body.clientBankId);
    if (body.transactionOrderId) fd.append('transactionOrderId', body.transactionOrderId);
    const files = body.files ?? (body.file ? [body.file] : []);
    assertUploadFilesWithinLimit(files);
    files.forEach((file, index) => fd.append(`file_${index + 1}`, file));
    return this.request.post<StandardMessageResponse, FormData>('/api/requirement', fd);
  }

  /** Cuentas bancarias de un cliente (staff). Para vincular requirements client_bank. */
  listClientBankAccountsByStaff(clientId: string): Promise<ListClientBankAccountsResponse> {
    return this.request.get<ListClientBankAccountsResponse>(`/api/bank-account/staff/all/${clientId}`);
  }

  /** Transacciones de un cliente (staff). Para vincular requirements de evidencia de transacción. */
  listClientTransactionsByStaff(clientId: string): Promise<ListClientTransactionsResponse> {
    return this.request.get<ListClientTransactionsResponse>(`/api/transaction-order/staff/all/${clientId}`);
  }

  updateRequirement(
    requirementId: string,
    body: UpdateRequirementRequest,
  ): Promise<StandardDataResponse<Requirement>> {
    const fd = new FormData();
    if (body.name !== undefined) fd.append('name', body.name);
    if (body.description !== undefined) fd.append('description', body.description);
    if (body.deleteFileIds?.length) fd.append('deleteFileIds', JSON.stringify(body.deleteFileIds));
    const files = body.files ?? (body.file ? [body.file] : []);
    assertUploadFilesWithinLimit(files);
    files.forEach((file, index) => fd.append(`file_${index + 1}`, file));
    return this.request.patch<StandardDataResponse<Requirement>, FormData>(
      `/api/requirement/${requirementId}`,
      fd,
    );
  }

  private requirementFileBlob(
    requirementFileId: string,
    mode: 'download' | 'inline',
  ): Promise<Blob> {
    return this.request.download(`/api/requirement/file/download/${requirementFileId}`, {
      params: { mode },
      context: new HttpContext().set(SILENT_AUTH_ERROR, true),
    });
  }

  downloadRequirementFile(requirementFileId: string): Promise<Blob> {
    return this.requirementFileBlob(requirementFileId, 'download');
  }

  viewRequirementFile(requirementFileId: string): Promise<Blob> {
    return this.requirementFileBlob(requirementFileId, 'inline');
  }

  /**
   * Descarga centralizada de un documento de cliente (KYC, source of funds/wealth, etc.).
   * Marcada como silenciosa: el interceptor no muestra su aviso genérico; el error lo
   * traduce la página a un mensaje claro (p. ej. "documento no accesible").
   */
  private clientDocumentBlob(
    documentType: RequirementDocumentType,
    documentId: string,
    mode: 'download' | 'inline',
  ): Promise<Blob> {
    return this.request.download(`/api/document/${documentType}/${documentId}/file`, {
      params: { mode },
      context: new HttpContext().set(SILENT_AUTH_ERROR, true),
    });
  }

  /** Descarga (adjunto) un documento de cliente. */
  downloadClientDocument(documentType: RequirementDocumentType, documentId: string): Promise<Blob> {
    return this.clientDocumentBlob(documentType, documentId, 'download');
  }

  /** PDF con el historial completo de transacciones de un cliente (staff). */
  downloadClientTransactionsListPdf(clientId: string): Promise<Blob> {
    return this.request.download(`/api/transaction-order/staff/client/${clientId}/pdf`);
  }

  /** PDF con el detalle de una transacción concreta de un cliente (staff). */
  downloadClientTransactionPdf(clientId: string, transactionId: string): Promise<Blob> {
    return this.request.download(
      `/api/transaction-order/staff/client/${clientId}/transaction/${transactionId}/pdf`,
    );
  }

  /** Obtiene un documento de cliente para previsualizarlo en el navegador (inline). */
  viewClientDocument(documentType: RequirementDocumentType, documentId: string): Promise<Blob> {
    return this.clientDocumentBlob(documentType, documentId, 'inline');
  }

  // ---- Compliance assignments ----

  listComplianceAssignments(page = 1, pageSize = 10, q?: string): Promise<ListComplianceAssignmentsResponse> {
    return this.request.get<ListComplianceAssignmentsResponse>('/api/compliance-assignment', {
      params: { page, pageSize, q },
    });
  }

  listUnassignedClients(page = 1, pageSize = 10, q?: string): Promise<ListUnassignedClientsResponse> {
    return this.request.get<ListUnassignedClientsResponse>('/api/compliance-assignment/not-assigned', {
      params: { page, pageSize, q },
    });
  }

  /** Clientes asignados a compliance staff bloqueado y pendientes de reasignación (CO). */
  listComplianceAssignmentsPendingReassignment(page = 1, pageSize = 10, q?: string): Promise<ListComplianceAssignmentsResponse> {
    return this.request.get<ListComplianceAssignmentsResponse>('/api/compliance-assignment/pending-reassignment', {
      params: { page, pageSize, q },
    });
  }

  /** Asignaciones de un compliance concreto (admin / CO / operator). */
  listComplianceAssignmentsByComplianceUser(
    complianceUserId: string,
    page = 1,
    pageSize = 10,
    q?: string,
  ): Promise<ListComplianceAssignmentsResponse> {
    return this.request.get<ListComplianceAssignmentsResponse>(`/api/compliance-assignment/${complianceUserId}`, {
      params: { page, pageSize, q },
    });
  }

  createComplianceAssignment(body: CreateComplianceAssignmentRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, CreateComplianceAssignmentRequest>(
      '/api/compliance-assignment',
      body,
    );
  }

  reassignComplianceAssignment(
    assignmentId: string,
    body: ReassignComplianceAssignmentRequest,
  ): Promise<ReassignComplianceAssignmentResponse> {
    return this.request.patch<ReassignComplianceAssignmentResponse, ReassignComplianceAssignmentRequest>(
      `/api/compliance-assignment/${assignmentId}/reassignment`,
      body,
    );
  }

  listComplianceAssignmentHistoryByClient(
    clientUserId: string,
    page = 1,
    pageSize = 10,
  ): Promise<ListComplianceAssignmentHistoryResponse> {
    return this.request.get<ListComplianceAssignmentHistoryResponse>(
      `/api/compliance-assignment/client/${clientUserId}/history`,
      { params: { page, pageSize } },
    );
  }

  getComplianceAssignmentHistory(historyId: string): Promise<ComplianceAssignmentHistoryDetailResponse> {
    return this.request.get<ComplianceAssignmentHistoryDetailResponse>(
      `/api/compliance-assignment/history/${historyId}`,
    );
  }

  // ---- Client financials: wallets ----

  listWalletsByClient(clientId: string): Promise<ListWalletsResponse> {
    return this.request.get<ListWalletsResponse>(`/api/wallet/staff/all/${clientId}`);
  }
  getLatestKycaidWalletAudit(id: string): Promise<KycaidWalletAuditResponse> {
    return this.request.get<KycaidWalletAuditResponse>(`/api/wallet/staff/${id}/kycaid-audit/latest`);
  }
  listKycaidWalletAudits(id: string, page = 1, pageSize = 10): Promise<KycaidWalletAuditListResponse> {
    return this.request.get<KycaidWalletAuditListResponse>(`/api/wallet/staff/${id}/kycaid-audit`, {
      params: { page, pageSize },
    });
  }
  requestKycaidWalletAudit(id: string): Promise<KycaidWalletAuditResponse> {
    return this.request.post<KycaidWalletAuditResponse, Record<string, never>>(
      `/api/wallet/staff/${id}/kycaid-audit`,
      {},
    );
  }
  verifyWallet(id: string): Promise<StandardDataResponse<Wallet>> {
    return this.request.patch<StandardDataResponse<Wallet>>(`/api/wallet/staff/verify/${id}`);
  }
  blockWallet(id: string): Promise<StandardDataResponse<Wallet>> {
    return this.request.patch<StandardDataResponse<Wallet>>(`/api/wallet/staff/block/${id}`);
  }

  // ---- Client financials: bank accounts ----

  verifyClientBankAccount(id: string): Promise<StandardDataResponse<ClientBankAccount>> {
    return this.request.patch<StandardDataResponse<ClientBankAccount>>(`/api/bank-account/staff/verify/${id}`);
  }
  blockClientBankAccount(id: string): Promise<StandardDataResponse<ClientBankAccount>> {
    return this.request.patch<StandardDataResponse<ClientBankAccount>>(`/api/bank-account/staff/block/${id}`);
  }

  // ---- Client financials: transactions (state change is operator/admin only) ----

  updateTransactionState(id: string, state: SettableTransactionState): Promise<StandardDataResponse<ClientTransaction>> {
    return this.request.patch<StandardDataResponse<ClientTransaction>, { state: SettableTransactionState }>(
      `/api/transaction-order/staff/change-state/${id}`,
      { state },
    );
  }

  // ---- KYC actions (compliance / compliance officer) ----

  verifyKyc(userId: string): Promise<StandardDataResponse<unknown>> {
    return this.request.patch<StandardDataResponse<unknown>>(`/api/kyc/${userId}/verify`);
  }
  syncKyc(userId: string): Promise<StandardDataResponse<unknown>> {
    return this.request.patch<StandardDataResponse<unknown>>(`/api/kyc/${userId}/sync-kycaid`);
  }
  restrictKyc(userId: string): Promise<StandardDataResponse<unknown>> {
    return this.request.patch<StandardDataResponse<unknown>>(`/api/kyc/${userId}/restricted`);
  }
  resetKyc(userId: string): Promise<StandardDataResponse<unknown>> {
    return this.request.patch<StandardDataResponse<unknown>>(`/api/kyc/${userId}/reset`);
  }

  // ---- Cola de pendientes de aprobación (lista completa, escopada por rol en el backend) ----

  listPendingWallets(): Promise<PendingListResponse<PendingWallet>> {
    return this.request.get<PendingListResponse<PendingWallet>>('/api/wallet/staff/pending');
  }
  listPendingBankAccounts(): Promise<PendingListResponse<PendingBankAccount>> {
    return this.request.get<PendingListResponse<PendingBankAccount>>('/api/bank-account/staff/pending');
  }
  listPendingTransactions(): Promise<PendingListResponse<PendingTransaction>> {
    return this.request.get<PendingListResponse<PendingTransaction>>('/api/transaction-order/staff/pending');
  }
  listPendingKyc(): Promise<PendingListResponse<PendingKyc>> {
    return this.request.get<PendingListResponse<PendingKyc>>('/api/kyc/staff/pending');
  }

  // ---- Activity warnings ----

  listActivityWarnings(query?: {
    page?: number;
    pageSize?: number;
    state?: ActivityWarningState;
    type?: ActivityWarningType;
    q?: string;
    sortBy?: 'createdAt' | 'updatedAt' | 'reviewedAt' | 'type' | 'state' | 'clientEmail' | 'reviewedByEmail' | 'triggerAmountEur' | 'totalAmountEur' | 'thresholdAmountEur';
    sortDir?: 'asc' | 'desc';
  }): Promise<ListActivityWarningsResponse> {
    return this.request.get<ListActivityWarningsResponse>('/api/activity-warning/staff', {
      params: query,
    });
  }

  listClientActivityWarnings(
    clientId: string,
    query?: {
      page?: number;
      pageSize?: number;
      state?: ActivityWarningState;
      type?: ActivityWarningType;
      q?: string;
      sortBy?: 'createdAt' | 'updatedAt' | 'reviewedAt' | 'type' | 'state' | 'clientEmail' | 'reviewedByEmail' | 'triggerAmountEur' | 'totalAmountEur' | 'thresholdAmountEur';
      sortDir?: 'asc' | 'desc';
    },
  ): Promise<ListActivityWarningsResponse> {
    return this.request.get<ListActivityWarningsResponse>(`/api/activity-warning/staff/client/${clientId}`, {
      params: query,
    });
  }

  getClientTransactionWarningLimit(clientId: string): Promise<TransactionWarningLimitResponse> {
    return this.request.get<TransactionWarningLimitResponse>(`/api/activity-warning/staff/client/${clientId}/limit`);
  }

  updateClientTransactionWarningLimit(
    clientId: string,
    body: UpdateTransactionWarningLimitRequest,
  ): Promise<UpdateTransactionWarningLimitResponse> {
    return this.request.patch<UpdateTransactionWarningLimitResponse, UpdateTransactionWarningLimitRequest>(
      `/api/activity-warning/staff/client/${clientId}/limit`,
      body,
    );
  }

  updateActivityWarningState(
    warningId: string,
    body: UpdateActivityWarningStateRequest,
  ): Promise<UpdateActivityWarningStateResponse> {
    return this.request.patch<UpdateActivityWarningStateResponse, UpdateActivityWarningStateRequest>(
      `/api/activity-warning/staff/${warningId}/state`,
      body,
    );
  }

  listInternalConversations(): Promise<ListInternalConversationsResponse> {
    return this.request.get<ListInternalConversationsResponse>('/api/compliance-conversation');
  }

  listInternalConversationsByUser(userId: string): Promise<ListInternalConversationsResponse> {
    return this.request.get<ListInternalConversationsResponse>(`/api/compliance-conversation/${userId}`);
  }

  createInternalConversation(body: CreateInternalConversationRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, CreateInternalConversationRequest>(
      '/api/compliance-conversation',
      body,
    );
  }

  createInternalMessage(conversationId: string, body: CreateMessageRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, CreateMessageRequest>(
      `/api/compliance-conversation/${conversationId}/messages`,
      body,
    );
  }

  closeInternalConversation(conversationId: string): Promise<StandardDataResponse<InternalConversation>> {
    return this.request.patch<StandardDataResponse<InternalConversation>>(
      `/api/compliance-conversation/close/${conversationId}`,
    );
  }

  /**
   * Perfil de riesgo de un cliente. Devuelve 404 si aún no tiene perfil (caso normal),
   * por eso va en modo silencioso: que NO muestre toast; la página gestiona el 404.
   */
  getRiskProfileByUser(userId: string): Promise<{ riskProfile: RiskProfile }> {
    return this.request.get<{ riskProfile: RiskProfile }>(`/api/risk-profile/user/${userId}`, {
      context: new HttpContext().set(SILENT_AUTH_ERROR, true),
    });
  }

  createRiskProfile(body: CreateRiskProfileRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, CreateRiskProfileRequest>('/api/risk-profile', body);
  }

  updateRiskProfile(id: string, body: UpdateRiskProfileRequest): Promise<StandardDataResponse<RiskProfile>> {
    return this.request.patch<StandardDataResponse<RiskProfile>, UpdateRiskProfileRequest>(
      `/api/risk-profile/${id}`,
      body,
    );
  }

  createRiskNote(riskProfileId: string, body: { title: string; description: string }): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, CreateRiskNoteRequest>(
      `/api/risk-profile/${riskProfileId}/notes`,
      { riskProfileId, title: body.title, description: body.description },
    );
  }

  listActionRequests(): Promise<ListActionRequestsResponse> {
    return this.request.get<ListActionRequestsResponse>('/api/action-request');
  }

  listOwnActionRequests(): Promise<ListActionRequestsResponse> {
    return this.request.get<ListActionRequestsResponse>('/api/action-request/own');
  }

  listUnassignedActionRequests(): Promise<ListActionRequestsResponse> {
    return this.request.get<ListActionRequestsResponse>('/api/action-request/without-assign');
  }

  createActionRequest(body: CreateActionRequestRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, CreateActionRequestRequest>('/api/action-request', body);
  }

  createActionRequestMessage(actionRequestId: string, body: CreateMessageRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, CreateMessageRequest>(
      `/api/action-request/${actionRequestId}/messages`,
      body,
    );
  }

  attachActionRequest(actionRequestId: string): Promise<StandardMessageResponse> {
    return this.request.patch<StandardMessageResponse>(`/api/action-request/attach/${actionRequestId}`);
  }

  closeActionRequest(actionRequestId: string): Promise<StandardDataResponse<ActionRequest>> {
    return this.request.patch<StandardDataResponse<ActionRequest>>(`/api/action-request/close/${actionRequestId}`);
  }

  listSupportTickets(page = 1, pageSize = 20): Promise<ListSupportTicketsResponse> {
    return this.request.get<ListSupportTicketsResponse>('/api/support-ticket', { params: { page, pageSize } });
  }

  listUnassignedSupportTickets(page = 1, pageSize = 20): Promise<ListSupportTicketsResponse> {
    return this.request.get<ListSupportTicketsResponse>('/api/support-ticket/unassigned', { params: { page, pageSize } });
  }

  listPendingReassignmentSupportTickets(page = 1, pageSize = 20): Promise<ListSupportTicketsResponse> {
    return this.request.get<ListSupportTicketsResponse>('/api/support-ticket/pending-reassignment', { params: { page, pageSize } });
  }

  getSupportTicket(ticketId: string): Promise<{ ticket: SupportTicket }> {
    return this.request.get<{ ticket: SupportTicket }>(`/api/support-ticket/${ticketId}`);
  }

  listSupportTicketAssignmentHistory(
    ticketId: string,
    query?: { page?: number; pageSize?: number },
  ): Promise<ListSupportTicketAssignmentHistoryResponse> {
    return this.request.get<ListSupportTicketAssignmentHistoryResponse>(
      `/api/support-ticket/${ticketId}/assignment-history`,
      { params: query },
    );
  }

  getSupportTicketAssignmentHistory(historyId: string): Promise<{ ok: boolean; history: SupportTicketAssignmentHistory }> {
    return this.request.get<{ ok: boolean; history: SupportTicketAssignmentHistory }>(
      `/api/support-ticket/assignment-history/${historyId}`,
    );
  }

  assignSupportTicketToMe(ticketId: string): Promise<StandardDataResponse<SupportTicket>> {
    return this.request.patch<StandardDataResponse<SupportTicket>>(`/api/support-ticket/${ticketId}/assign/me`);
  }

  assignSupportTicket(ticketId: string, supportUserId: string): Promise<StandardDataResponse<SupportTicket>> {
    return this.request.patch<StandardDataResponse<SupportTicket>, { supportUserId: string }>(
      `/api/support-ticket/${ticketId}/assign`,
      { supportUserId },
    );
  }

  updateSupportTicketStatus(
    ticketId: string,
    body: UpdateSupportTicketStatusRequest,
  ): Promise<StandardDataResponse<SupportTicket>> {
    return this.request.patch<StandardDataResponse<SupportTicket>, UpdateSupportTicketStatusRequest>(
      `/api/support-ticket/${ticketId}/status`,
      body,
    );
  }

  createSupportTicketMessage(ticketId: string, body: FormData): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, FormData>(`/api/support-ticket/${ticketId}/messages`, body);
  }

  downloadSupportTicketDocument(documentId: string): Promise<Blob> {
    return this.request.download(`/api/support-ticket/download/${documentId}/file`);
  }

  // ---- Platform tutorial — manual privado por rol ----
  getPlatformTutorialManual(
    lang: PlatformTutorialLanguage = 'en',
  ): Promise<StandardDataResponse<PlatformTutorialManual>> {
    return this.request.get<StandardDataResponse<PlatformTutorialManual>>('/api/platform-tutorial/manual', {
      params: { lang },
    });
  }

  // ---- Platform parameters — solo admin ----
  getParameters(): Promise<PlatformParameters> {
    return this.request.get<PlatformParameters>('/api/parameter');
  }

  createParameters(body: ParametersRequest): Promise<PlatformParameters> {
    return this.request.post<PlatformParameters, ParametersRequest>('/api/parameter', body);
  }

  updateParameters(body: Partial<ParametersRequest>): Promise<PlatformParameters> {
    return this.request.patch<PlatformParameters, Partial<ParametersRequest>>('/api/parameter', body);
  }

  listBlockchains(): Promise<ListBlockchainsResponse> {
    return this.request.get<ListBlockchainsResponse>('/api/blockchain');
  }

  listFiatCurrencies(): Promise<ListFiatCurrenciesResponse> {
    return this.request.get<ListFiatCurrenciesResponse>('/api/fiat-currency');
  }

  listCryptoCurrencies(): Promise<ListCryptoCurrenciesResponse> {
    return this.request.get<ListCryptoCurrenciesResponse>('/api/crypto-currency');
  }

  listBankData(): Promise<ListBankDataResponse> {
    return this.request.get<ListBankDataResponse>('/api/coinforge-bank-account');
  }

  // ---- Administration catalogs (admin only) ----

  createBlockchain(body: CreateBlockchainRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, CreateBlockchainRequest>('/api/blockchain', body);
  }

  deleteBlockchain(id: string): Promise<void> {
    return this.request.delete<void>(`/api/blockchain/${id}`);
  }

  createFiatCurrency(body: CreateFiatCurrencyRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, CreateFiatCurrencyRequest>('/api/fiat-currency', body);
  }

  deleteFiatCurrency(id: string): Promise<void> {
    return this.request.delete<void>(`/api/fiat-currency/${id}`);
  }

  createCryptoCurrency(body: CreateCryptoCurrencyRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, CreateCryptoCurrencyRequest>('/api/crypto-currency', body);
  }

  deleteCryptoCurrency(id: string): Promise<void> {
    return this.request.delete<void>(`/api/crypto-currency/${id}`);
  }

  createBankData(body: CreateBankDataRequest): Promise<StandardMessageResponse> {
    return this.request.post<StandardMessageResponse, CreateBankDataRequest>('/api/coinforge-bank-account', body);
  }

  updateBankData(id: string, body: UpdateBankDataRequest): Promise<StandardDataResponse<BankData>> {
    return this.request.patch<StandardDataResponse<BankData>, UpdateBankDataRequest>(
      `/api/coinforge-bank-account/${id}`,
      body,
    );
  }

  deleteBankData(id: string): Promise<void> {
    return this.request.delete<void>(`/api/coinforge-bank-account/${id}`);
  }
}
