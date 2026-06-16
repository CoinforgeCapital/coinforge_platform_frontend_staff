export const environment = {
  backendUrl: 'http://localhost:3000',
  staffHomePath: '/dashboard',
  roles: {
    inactive: 'INACTIVE',
    client: 'CLIENT',
    support: 'SUPPORT',
    supportOfficer: 'SUPPORT_OFFICER',
    compliance: 'COMPLIANCE',
    complianceOfficer: 'COMPLIANCE_OFFICER',
    operator: 'OPERATOR',
    admin: 'ADMIN',
  },
  staffRoles: [
    'SUPPORT',
    'SUPPORT_OFFICER',
    'COMPLIANCE',
    'COMPLIANCE_OFFICER',
    'OPERATOR',
    'ADMIN',
  ],
  /** Máximo de notificaciones guardadas en localStorage (borrado progresivo de las más antiguas). */
  notificationsMaxItems: 200,
};
