import { inject, Injectable } from '@angular/core';

import { STAFF_PERMISSIONS } from '../core/staff-permissions';
import { ApiService, Requirement } from './api.service';
import { AuthService } from './auth.service';

/**
 * Comprobación previa para acciones financieras que podrían dejar incoherentes
 * requirements aún abiertos. Si el rol no puede leer requirements, devolvemos un
 * aviso conservador para que la acción no continúe sin una decisión explícita.
 */
@Injectable({ providedIn: 'root' })
export class ApprovalRequirementWarningService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  async forWalletClient(clientId: string): Promise<string | null> {
    if (!clientId) return null;
    return this.activeRequirementWarning(
      (requirement) => requirement.customerUser?.id === clientId,
      'for this client',
    );
  }

  async forBankAccount(bankAccountId: string): Promise<string | null> {
    if (!bankAccountId) return null;
    return this.activeRequirementWarning(
      (requirement) => requirement.clientBankAccountId === bankAccountId,
      'linked to this bank account',
    );
  }

  async forTransaction(transactionId: string): Promise<string | null> {
    if (!transactionId) return null;
    return this.activeRequirementWarning(
      (requirement) => requirement.transactionOrderId === transactionId,
      'linked to this transaction',
    );
  }

  private async activeRequirementWarning(
    predicate: (requirement: Requirement) => boolean,
    scopeLabel: string,
  ): Promise<string | null> {
    if (!this.auth.hasAnyRole(STAFF_PERMISSIONS.requirementsRead)) {
      return 'Active requirements could not be checked with your current role. Continue anyway?';
    }

    try {
      const res = await this.api.listRequirements();
      const activeRequirements = (res.requirements ?? []).filter((requirement) => {
        return this.isActiveRequirement(requirement) && predicate(requirement);
      });

      if (!activeRequirements.length) return null;

      const count = activeRequirements.length;
      const names = this.requirementPreview(activeRequirements);
      const prefix = count === 1 ? 'There is 1 active requirement' : `There are ${count} active requirements`;

      return `${prefix} ${scopeLabel}${names ? ` (${names})` : ''}. Continue anyway?`;
    } catch {
      return 'Active requirements could not be checked. Continue anyway?';
    }
  }

  private isActiveRequirement(requirement: Requirement): boolean {
    return requirement.state === 'pending' || requirement.state === 'under_review';
  }

  private requirementPreview(requirements: Requirement[]): string {
    const visible = requirements.slice(0, 3).map((requirement) => requirement.name || this.shortId(requirement.id));
    const remaining = requirements.length - visible.length;
    return remaining > 0 ? `${visible.join(', ')} +${remaining} more` : visible.join(', ');
  }

  private shortId(id?: string): string {
    return id ? `#${id.slice(0, 8).toUpperCase()}` : 'Requirement';
  }
}
