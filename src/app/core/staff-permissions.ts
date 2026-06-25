import { StaffRole } from '../services/api.service';

export const STAFF_ROLES = {
  support: 'SUPPORT',
  supportOfficer: 'SUPPORT_OFFICER',
  compliance: 'COMPLIANCE',
  complianceOfficer: 'COMPLIANCE_OFFICER',
  operator: 'OPERATOR',
  admin: 'ADMIN',
} as const satisfies Record<string, StaffRole>;

export const STAFF_PERMISSIONS = {
  usersRead: [
    STAFF_ROLES.admin,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.compliance,
    STAFF_ROLES.operator,
  ],
  // GET /api/user/staff/list — incluye al support officer (el backend lo acota a
  // SUPPORT + SUPPORT_OFFICER). Distinto de usersRead (clientes), que NO incluye al SO.
  staffRead: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.compliance,
    STAFF_ROLES.supportOfficer,
  ],
  // POST /api/user — crear cualquier tipo de usuario (puerta de Management + alta de STAFF).
  userCreate: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.supportOfficer,
  ],
  // POST /api/user creando un CLIENTE. Solo admin y operator pueden crear clientes; el compliance
  // officer y el support officer solo crean su tipo de staff (compliance / support), no clientes.
  clientCreate: [STAFF_ROLES.admin, STAFF_ROLES.operator],
  requirements: [
    STAFF_ROLES.admin,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.compliance,
  ],
  internalMessages: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.compliance,
  ],
  // POST /api/compliance-conversation (+ /messages): crear conversaciones internas y responder.
  // El compliance officer puede con cualquier cliente; el compliance, solo con sus asignados
  // (el backend lo refuerza con findAssignedClientForCompliance). El detalle de cliente verifica
  // la asignación para el rol compliance antes de mostrar las acciones.
  internalMessagesWrite: [STAFF_ROLES.complianceOfficer, STAFF_ROLES.compliance],
  riskProfiles: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.compliance,
  ],
  actionRequests: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.compliance,
    STAFF_ROLES.supportOfficer,
    STAFF_ROLES.support,
  ],
  supportTickets: [
    STAFF_ROLES.supportOfficer,
    STAFF_ROLES.support,
  ],
  adminCatalogs: [
    STAFF_ROLES.admin,
  ],
  // GET/POST/PATCH/DELETE /api/coinforge-bank-account: admin gestiona todas las cuentas;
  // operator solo las que tienen cliente asociado (el backend acota por rol).
  bankDataManage: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
  ],

  // ---- Capacidades finas (espejo EXACTO de las listas de roles del backend) ----
  // Úsalas para mostrar/ocultar acciones y pestañas sin provocar 403.

  // PATCH/DELETE /api/user/:id y POST /api/auth/password/reset
  usersWrite: [STAFF_ROLES.admin],
  // GET /api/user/deleted/list
  deletedUsersRead: [STAFF_ROLES.admin],
  // GET /api/user/inactive + /api/user/inactive/:id
  inactiveUsersRead: [STAFF_ROLES.admin],
  // PATCH /api/user/state/change/:id sobre un CLIENTE. En changeStateAction, admin, operator,
  // compliance officer y compliance pueden cambiar el estado de un cliente; el support officer NO
  // (solo gestiona cuentas de soporte: `isSupportOfficer() && !user.isSupport()` => 403).
  clientStateChange: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.compliance,
  ],
  // PATCH /api/kyc/:id/{verify,sync-kycaid,reset,restricted}
  kycReview: [STAFF_ROLES.complianceOfficer, STAFF_ROLES.compliance],
  // GET /api/requirement + /api/requirement/file/download/:requirementFileId — ver/descargar requirements (sin operator)
  requirementsRead: [STAFF_ROLES.admin, STAFF_ROLES.complianceOfficer, STAFF_ROLES.compliance],
  // POST/PATCH requirement, /staff/close, /staff/reject
  requirementsWrite: [STAFF_ROLES.complianceOfficer, STAFF_ROLES.compliance],
  // POST /api/risk-profile, PATCH /:id, POST /:id/notes
  riskProfilesWrite: [STAFF_ROLES.complianceOfficer, STAFF_ROLES.compliance],
  // GET /staff/all/:clientId + verify/block de wallets y cuentas; transacciones por cliente
  clientFinancials: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.compliance,
  ],
  // GET /api/wallet/staff/:id/kycaid-audit/latest
  walletKycaidAuditView: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.compliance,
  ],
  // POST /api/wallet/staff/:id/kycaid-audit. CO = cualquier cliente; compliance = asignado.
  walletKycaidAuditCreate: [STAFF_ROLES.complianceOfficer, STAFF_ROLES.compliance],
  // PATCH /api/transaction-order/staff/change-state/:id
  transactionStateChange: [STAFF_ROLES.admin, STAFF_ROLES.operator],
  // POST /api/compliance-conversation (+messages, +close)
  complianceConversations: [STAFF_ROLES.complianceOfficer, STAFF_ROLES.compliance],
  // GET /api/compliance-conversation/:userId (ver conversaciones de un cliente)
  complianceConversationsByUser: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
    STAFF_ROLES.complianceOfficer,
  ],
  // GET /api/compliance-assignment (+/not-assigned)
  complianceAssignmentView: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.compliance,
  ],
  // POST /api/compliance-assignment
  complianceAssignmentCreate: [STAFF_ROLES.complianceOfficer, STAFF_ROLES.compliance],
  // GET /api/compliance-assignment/pending-reassignment + PATCH /api/compliance-assignment/:id/reassignment
  complianceAssignmentReassign: [STAFF_ROLES.complianceOfficer],
  // GET /api/compliance-assignment/:complianceUserId (ver la cartera de un compliance concreto)
  complianceAssignmentByUser: [STAFF_ROLES.admin, STAFF_ROLES.operator, STAFF_ROLES.complianceOfficer],
  // GET /api/activity-warning/staff + /staff/client/:clientId + /limit
  activityWarningsView: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.compliance,
  ],
  // PATCH /api/activity-warning/staff/:warningId/state y /staff/client/:clientId/limit.
  // CO = cualquier cliente; compliance = asignado/asociado al cliente.
  activityWarningsManage: [STAFF_ROLES.complianceOfficer, STAFF_ROLES.compliance],
  // POST /api/action-request con target COMPLIANCE_OFFICER desde una activity warning.
  activityWarningEscalationCreate: [STAFF_ROLES.compliance],
  // GET /api/action-request (lista global)
  actionRequestsListAll: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.supportOfficer,
  ],
  // PATCH /api/support-ticket/:id/assign (asignar a un agente)
  supportTicketAssign: [STAFF_ROLES.supportOfficer],
  // GET /api/document/:type/:id/file (descarga/visualización central)
  documents: [
    STAFF_ROLES.admin,
    STAFF_ROLES.operator,
    STAFF_ROLES.complianceOfficer,
    STAFF_ROLES.compliance,
  ],
  // GET/POST/PATCH /api/parameter (SMTP / parámetros de la app)
  parameters: [STAFF_ROLES.admin],
} as const satisfies Record<string, readonly StaffRole[]>;

export interface StaffNavItem {
  path: string;
  label: string;
  icon: string;
  group: string;
  roles?: readonly StaffRole[];
}

export const STAFF_NAV_ITEMS: readonly StaffNavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'pi pi-home', group: 'General' },

  { path: '/clients', label: 'Clients', icon: 'pi pi-users', group: 'User management', roles: STAFF_PERMISSIONS.usersRead },
  { path: '/staff-members', label: 'Staff members', icon: 'pi pi-id-card', group: 'User management', roles: STAFF_PERMISSIONS.staffRead },
  { path: '/inactive-users', label: 'Inactive users', icon: 'pi pi-user-minus', group: 'User management', roles: STAFF_PERMISSIONS.inactiveUsersRead },
  { path: '/user-management', label: 'Deleted users', icon: 'pi pi-trash', group: 'User management', roles: STAFF_PERMISSIONS.deletedUsersRead },

  { path: '/requirements', label: 'Requirements', icon: 'pi pi-verified', group: 'Compliance', roles: STAFF_PERMISSIONS.requirements },
  { path: '/risk-profiles', label: 'Risk profiles', icon: 'pi pi-shield', group: 'Compliance', roles: STAFF_PERMISSIONS.riskProfiles },
  { path: '/compliance-assignments', label: 'Compliance assignments', icon: 'pi pi-link', group: 'Compliance', roles: STAFF_PERMISSIONS.complianceAssignmentView },
  { path: '/pending-approvals', label: 'Pending approvals', icon: 'pi pi-inbox', group: 'Compliance', roles: STAFF_PERMISSIONS.clientFinancials },
  { path: '/activity-warnings', label: 'Activity warnings', icon: 'pi pi-exclamation-triangle', group: 'Compliance', roles: STAFF_PERMISSIONS.activityWarningsView },

  { path: '/internal-messages', label: 'Internal messages', icon: 'pi pi-comments', group: 'Communications', roles: STAFF_PERMISSIONS.complianceConversations },
  { path: '/action-requests', label: 'Action requests', icon: 'pi pi-send', group: 'Communications', roles: STAFF_PERMISSIONS.actionRequests },

  { path: '/support-tickets', label: 'Support tickets', icon: 'pi pi-ticket', group: 'Support', roles: STAFF_PERMISSIONS.supportTickets },

  { path: '/blockchains', label: 'Blockchains', icon: 'pi pi-sitemap', group: 'Administration', roles: STAFF_PERMISSIONS.adminCatalogs },
  { path: '/fiat-currencies', label: 'Fiat currencies', icon: 'pi pi-dollar', group: 'Administration', roles: STAFF_PERMISSIONS.adminCatalogs },
  { path: '/crypto-currencies', label: 'Crypto currencies', icon: 'pi pi-bitcoin', group: 'Administration', roles: STAFF_PERMISSIONS.adminCatalogs },
  { path: '/bank-data', label: 'Bank data', icon: 'pi pi-building-columns', group: 'Administration', roles: STAFF_PERMISSIONS.bankDataManage },
  { path: '/parameters', label: 'Parameters', icon: 'pi pi-sliders-h', group: 'Administration', roles: STAFF_PERMISSIONS.parameters },

  // Ajustes de la propia cuenta: visible para todo el staff (sin restricción de rol).
  { path: '/account-settings', label: 'Account settings', icon: 'pi pi-cog', group: 'Account' },
];

/** Agrupa los items de nav visibles preservando el orden de definición. */
export function groupStaffNavItems(
  items: readonly StaffNavItem[],
): { group: string; items: StaffNavItem[] }[] {
  const groups: { group: string; items: StaffNavItem[] }[] = [];
  for (const item of items) {
    let bucket = groups.find((g) => g.group === item.group);
    if (!bucket) {
      bucket = { group: item.group, items: [] };
      groups.push(bucket);
    }
    bucket.items.push(item);
  }
  return groups;
}
