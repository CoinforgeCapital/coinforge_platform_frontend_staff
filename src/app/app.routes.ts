import { Routes } from '@angular/router';
import { authMatchGuard, roleMatchGuard, unauthMatchGuard } from './core/auth.guard';
import { STAFF_PERMISSIONS } from './core/staff-permissions';

const catalogPage = () =>
  import('./pages/catalog-manager/catalog-manager.page').then((m) => m.CatalogManagerPage);

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },

  // IMPORTANTE: la ruta 'auth' debe ir ANTES que el shell con path '' (prefix-match).
  // Si el shell va primero, su authMatchGuard intercepta también '/auth/login' y, al no haber
  // sesión, redirige a '/auth/login' en bucle infinito (la página deja de responder).
  {
    path: 'auth',
    canMatch: [unauthMatchGuard],
    loadComponent: () =>
      import('./layouts/auth-layout.component').then((m) => m.AuthLayoutComponent),
    children: [
      {
        path: 'login',
        loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
      },
      {
        path: 'set-password',
        loadComponent: () =>
          import('./pages/set-password/set-password.page').then((m) => m.SetPasswordPage),
      },
      { path: '', pathMatch: 'full', redirectTo: 'login' },
    ],
  },

  {
    path: '',
    canMatch: [authMatchGuard],
    loadComponent: () =>
      import('./layouts/staff-layout.component').then((m) => m.StaffLayoutComponent),
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'clients',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.usersRead },
        loadComponent: () =>
          import('./pages/clients/clients.page').then((m) => m.ClientsPage),
      },
      {
        path: 'staff-members',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.staffRead },
        loadComponent: () =>
          import('./pages/staff-members/staff-members.page').then((m) => m.StaffMembersPage),
      },
      {
        path: 'requirements',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.requirements },
        loadComponent: () =>
          import('./pages/requirements/requirements.page').then((m) => m.RequirementsPage),
      },
      {
        path: 'internal-messages',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.complianceConversations },
        loadComponent: () =>
          import('./pages/internal-messages/internal-messages.page').then((m) => m.InternalMessagesPage),
      },
      {
        path: 'risk-profiles',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.riskProfiles },
        loadComponent: () =>
          import('./pages/risk-profiles/risk-profiles.page').then((m) => m.RiskProfilesPage),
      },
      {
        path: 'compliance-assignments',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.complianceAssignmentView },
        loadComponent: () =>
          import('./pages/compliance-assignments/compliance-assignments.page').then(
            (m) => m.ComplianceAssignmentsPage,
          ),
      },
      {
        path: 'pending-approvals',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.clientFinancials },
        loadComponent: () =>
          import('./pages/pending-approvals/pending-approvals.page').then(
            (m) => m.PendingApprovalsPage,
          ),
      },
      {
        path: 'activity-warnings',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.activityWarningsView },
        loadComponent: () =>
          import('./pages/activity-warnings/activity-warnings.page').then(
            (m) => m.ActivityWarningsPage,
          ),
      },
      {
        path: 'warning-limits',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.activityWarningsView },
        loadComponent: () =>
          import('./pages/warning-limits/warning-limits.page').then(
            (m) => m.WarningLimitsPage,
          ),
      },
      {
        path: 'action-requests',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.actionRequests },
        loadComponent: () =>
          import('./pages/action-requests/action-requests.page').then((m) => m.ActionRequestsPage),
      },
      {
        path: 'support-tickets',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.supportTickets },
        loadComponent: () =>
          import('./pages/support-tickets/support-tickets.page').then((m) => m.SupportTicketsPage),
      },
      {
        path: 'user-management',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.deletedUsersRead },
        loadComponent: () =>
          import('./pages/user-creation/user-creation.page').then((m) => m.UserManagementPage),
      },
      {
        path: 'blockchains',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.adminCatalogs, sectionKey: 'blockchains' },
        loadComponent: catalogPage,
      },
      {
        path: 'fiat-currencies',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.adminCatalogs, sectionKey: 'fiat-currencies' },
        loadComponent: catalogPage,
      },
      {
        path: 'crypto-currencies',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.adminCatalogs, sectionKey: 'crypto-currencies' },
        loadComponent: catalogPage,
      },
      {
        path: 'bank-data',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.adminCatalogs, sectionKey: 'bank-data' },
        loadComponent: catalogPage,
      },
      {
        path: 'parameters',
        canMatch: [roleMatchGuard],
        data: { roles: STAFF_PERMISSIONS.parameters },
        loadComponent: () =>
          import('./pages/parameters/parameters.page').then((m) => m.ParametersPage),
      },
      {
        // Disponible para cualquier miembro del staff autenticado (sin roleMatchGuard).
        path: 'account-settings',
        loadComponent: () =>
          import('./pages/account-settings/account-settings.page').then((m) => m.AccountSettingsPage),
      },
    ],
  },

  { path: '**', redirectTo: 'dashboard' },
];
