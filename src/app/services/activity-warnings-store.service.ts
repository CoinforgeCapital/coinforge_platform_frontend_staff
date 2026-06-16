import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  ActivityWarning,
  ActivityWarningState,
  StandardMessageResponse,
  TransactionWarningLimit,
  TransactionWarningLimitResponse,
  UpdateActivityWarningStateResponse,
  UpdateTransactionWarningLimitResponse,
} from './api.service';
import { STAFF_ROLES } from '../core/staff-permissions';
import { AuthService } from './auth.service';
import { NotificationsService } from './notifications.service';

interface StoredEscalation {
  id: string;
  warningId: string;
  target: string;
  subject: string;
  body: string;
  createdAt: string;
}

interface StoredClientAssignment {
  clientId: string;
  complianceUserId: string;
  complianceUserEmail?: string | null;
  createdAt: string;
}

const WARNINGS_KEY = 'cf_staff_activity_warnings';
const LIMITS_KEY = 'cf_staff_activity_warning_client_limits';
const ESCALATIONS_KEY = 'cf_staff_activity_warning_escalations';
const ASSIGNMENTS_KEY = 'cf_staff_activity_warning_client_assignments_v2';

const REVIEWER = {
  id: 'staff-compliance-officer',
  email: 'compliance.officer@coinforge.test',
  nickname: 'Compliance officer',
};

@Injectable({ providedIn: 'root' })
export class ActivityWarningsStoreService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationsService);
  private readonly seedUrl = '/activity-alerts.json';

  async listActivityWarnings(): Promise<{ warnings: ActivityWarning[] }> {
    const warnings = await this.getWarnings();
    return { warnings: this.visibleWarnings(warnings) };
  }

  async listClientActivityWarnings(
    clientId: string,
    clientEmail?: string,
    assignedToCurrentCompliance = false,
  ): Promise<{ warnings: ActivityWarning[] }> {
    if (assignedToCurrentCompliance) {
      this.registerAssignedClient(clientId, clientEmail);
    }
    if (!this.canViewClient(clientId)) {
      return { warnings: [] };
    }

    const warnings = await this.getWarnings();
    const current = warnings.filter((warning) => warning.client?.id === clientId);
    if (current.length) return { warnings: current };

    const generated = this.createWarningsForClient(clientId, clientEmail, warnings);
    const next = [...generated, ...warnings];
    this.persistWarnings(next);
    return { warnings: generated };
  }

  async getClientTransactionWarningLimit(clientId: string): Promise<TransactionWarningLimitResponse> {
    return { limit: await this.getClientLimit(clientId) };
  }

  async updateClientTransactionWarningLimit(
    clientId: string,
    body: { fiatSingleTransactionLimit: string },
  ): Promise<UpdateTransactionWarningLimitResponse> {
    if (!this.canManageClient(clientId)) {
      throw new Error('You do not have permission.');
    }

    const list = this.readClientLimits();
    const now = new Date().toISOString();
    const current = list.find((limit) => limit.clientId === clientId);
    const limit: TransactionWarningLimit = {
      ...(current ?? this.defaultClientLimit(clientId, now)),
      fiatSingleTransactionLimit: body.fiatSingleTransactionLimit,
      updatedAt: now,
    };
    this.persistClientLimits(current ? list.map((item) => (item.clientId === clientId ? limit : item)) : [limit, ...list]);
    return { ok: true, message: 'The transaction warning limit was updated.', limit };
  }

  async updateActivityWarningState(
    warningId: string,
    body: { state: ActivityWarningState },
  ): Promise<UpdateActivityWarningStateResponse> {
    const warnings = await this.getWarnings();
    const current = warnings.find((warning) => warning.id === warningId);
    if (!current) throw new Error('Activity warning not found.');
    if (!this.canManageWarning(current)) {
      throw new Error('You do not have permission.');
    }

    const now = new Date().toISOString();
    const warning: ActivityWarning = {
      ...current,
      state: body.state,
      reviewedAt: body.state === 'solved' ? now : null,
      reviewedBy: body.state === 'solved' ? REVIEWER : null,
      updatedAt: now,
    };

    this.persistWarnings(warnings.map((item) => (item.id === warningId ? warning : item)));
    return { ok: true, message: 'The warning was updated.', warning };
  }

  async createEscalation(warning: ActivityWarning, body: string): Promise<StandardMessageResponse> {
    const now = new Date().toISOString();
    const id = this.createId('awr');
    const subject = `Activity warning escalation: ${warning.client?.email ?? 'Client'}`;
    const escalation: StoredEscalation = {
      id,
      warningId: warning.id,
      target: 'COMPLIANCE_OFFICER',
      subject,
      body,
      createdAt: now,
    };
    this.persistEscalations([escalation, ...this.readEscalations()]);
    this.notifications.push({
      id: `notification-${id}`,
      type: 'action_request',
      title: 'Action request created',
      body: `${warning.client?.email ?? 'Client'} case escalated to compliance officers.`,
      meta: {
        link: '/activity-warnings',
        warningId: warning.id,
        target: 'COMPLIANCE_OFFICER',
      },
      createdAt: now,
    });
    return { ok: true, message: 'The compliance officers were notified.' };
  }

  private async getWarnings(): Promise<ActivityWarning[]> {
    const seeded = await this.loadSeed();
    const stored = this.readWarnings();
    if (stored) {
      const merged = this.mergeWarnings(stored, seeded);
      this.persistWarnings(merged);
      return this.sortWarnings(merged);
    }

    this.persistWarnings(seeded);
    return this.sortWarnings(seeded);
  }

  private async loadSeed(): Promise<ActivityWarning[]> {
    const rows = await firstValueFrom(this.http.get<ActivityWarning[]>(this.seedUrl));
    return Array.isArray(rows) ? rows.map((row) => this.normalizeWarning(row)) : [];
  }

  private readWarnings(): ActivityWarning[] | null {
    try {
      const raw = localStorage.getItem(WARNINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.map((row) => this.normalizeWarning(row as ActivityWarning)) : null;
    } catch {
      return null;
    }
  }

  private persistWarnings(warnings: readonly ActivityWarning[]): void {
    localStorage.setItem(WARNINGS_KEY, JSON.stringify(warnings));
  }

  private mergeWarnings(stored: readonly ActivityWarning[], seeded: readonly ActivityWarning[]): ActivityWarning[] {
    const storedIds = new Set(stored.map((warning) => warning.id));
    return [...stored, ...seeded.filter((warning) => !storedIds.has(warning.id))];
  }

  private sortWarnings(warnings: readonly ActivityWarning[]): ActivityWarning[] {
    return [...warnings].sort((a, b) => this.time(b.createdAt) - this.time(a.createdAt));
  }

  private normalizeWarning(row: ActivityWarning): ActivityWarning {
    const now = new Date().toISOString();
    return {
      ...row,
      id: String(row.id || this.createId('warning')),
      state: row.state === 'solved' ? 'solved' : 'pending',
      type: String(row.type || 'SINGLE'),
      reviewedAt: row.reviewedAt ?? null,
      createdAt: row.createdAt ?? now,
      updatedAt: row.updatedAt ?? row.createdAt ?? now,
      client: {
        id: String(row.client?.id || 'client-sample'),
        email: String(row.client?.email || 'client@coinforge.test'),
      },
      transaction: row.transaction ?? null,
      wallet: row.wallet ?? null,
      reviewedBy: row.reviewedBy ?? null,
    };
  }

  private createWarningsForClient(
    clientId: string,
    clientEmail: string | undefined,
    seed: readonly ActivityWarning[],
  ): ActivityWarning[] {
    const now = new Date();
    const email = clientEmail?.trim() || `client-${clientId.slice(0, 8)}@coinforge.test`;
    return seed.slice(0, 8).map((warning, index) => {
      const createdAt = new Date(now.getTime() - (index + 1) * 36e5).toISOString();
      const idSuffix = `${clientId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 18)}-${index + 1}`;
      return {
        ...warning,
        id: `aw-client-${idSuffix}`,
        state: index === 0 ? 'solved' : 'pending',
        reviewedAt: index === 0 ? new Date(now.getTime() - 18e5).toISOString() : null,
        reviewedBy: index === 0 ? REVIEWER : null,
        createdAt,
        updatedAt: createdAt,
        client: { id: clientId, email },
        transaction: warning.transaction
          ? { ...warning.transaction, id: `tx-client-${idSuffix}`, createdAt }
          : null,
        wallet: warning.wallet
          ? { ...warning.wallet, id: `wallet-client-${idSuffix}` }
          : null,
      };
    });
  }

  private visibleWarnings(warnings: readonly ActivityWarning[]): ActivityWarning[] {
    if (this.canViewAllClients()) return [...warnings];
    if (this.auth.currentRole() !== STAFF_ROLES.compliance) return [];
    return warnings.filter((warning) => this.clientIsAssignedToCurrentCompliance(warning.client?.id));
  }

  private canViewClient(clientId: string): boolean {
    if (this.canViewAllClients()) return true;
    if (this.auth.currentRole() !== STAFF_ROLES.compliance) return false;
    return this.clientIsAssignedToCurrentCompliance(clientId);
  }

  private canManageWarning(warning: ActivityWarning): boolean {
    return this.canManageClient(warning.client?.id);
  }

  private canManageClient(clientId?: string | null): boolean {
    const role = this.auth.currentRole();
    if (role === STAFF_ROLES.complianceOfficer) return true;
    if (role !== STAFF_ROLES.compliance) return false;
    return this.clientIsAssignedToCurrentCompliance(clientId);
  }

  private canViewAllClients(): boolean {
    const role = this.auth.currentRole();
    return role === STAFF_ROLES.admin || role === STAFF_ROLES.operator || role === STAFF_ROLES.complianceOfficer;
  }

  private clientIsAssignedToCurrentCompliance(clientId?: string | null): boolean {
    if (!clientId) return false;
    const userId = this.auth.currentUserId();
    if (!userId) return false;
    return this.readAssignments().some(
      (assignment) => assignment.clientId === clientId && assignment.complianceUserId === userId,
    );
  }

  private registerAssignedClient(clientId: string, clientEmail?: string): void {
    if (this.auth.currentRole() !== STAFF_ROLES.compliance || this.isSeedClientId(clientId)) return;
    this.addCurrentComplianceAssignment(clientId, clientEmail ?? null);
  }

  private addCurrentComplianceAssignment(clientId: string, clientEmail: string | null): void {
    const userId = this.auth.currentUserId();
    if (!userId) return;

    const assignments = this.readAssignments();
    if (assignments.some((assignment) => assignment.clientId === clientId && assignment.complianceUserId === userId)) {
      return;
    }

    this.persistAssignments([
      ...assignments,
      {
        clientId,
        complianceUserId: userId,
        complianceUserEmail: this.auth.currentEmail(),
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  private readAssignments(): StoredClientAssignment[] {
    try {
      const raw = localStorage.getItem(ASSIGNMENTS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((row) => row as Partial<StoredClientAssignment>)
        .filter((row): row is StoredClientAssignment => {
          if (!row.clientId || !row.complianceUserId) return false;
          return !this.isSeedClientId(String(row.clientId));
        })
        .map((row) => ({
          clientId: String(row.clientId),
          complianceUserId: String(row.complianceUserId),
          complianceUserEmail: row.complianceUserEmail ? String(row.complianceUserEmail) : null,
          createdAt: String(row.createdAt || new Date().toISOString()),
        }));
    } catch {
      return [];
    }
  }

  private persistAssignments(assignments: readonly StoredClientAssignment[]): void {
    localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
  }

  private isSeedClientId(clientId: string): boolean {
    return /^client-sample-\d{3}$/.test(clientId);
  }

  private async getClientLimit(clientId: string): Promise<TransactionWarningLimit> {
    const list = this.readClientLimits();
    const current = list.find((limit) => limit.clientId === clientId);
    if (current) return current;

    const now = new Date().toISOString();
    const limit = this.defaultClientLimit(clientId, now);
    this.persistClientLimits([limit, ...list]);
    return limit;
  }

  private readClientLimits(): TransactionWarningLimit[] {
    try {
      const raw = localStorage.getItem(LIMITS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map((row) => this.normalizeLimit(row as TransactionWarningLimit)) : [];
    } catch {
      return [];
    }
  }

  private persistClientLimits(limits: readonly TransactionWarningLimit[]): void {
    localStorage.setItem(LIMITS_KEY, JSON.stringify(limits));
  }

  private normalizeLimit(row: TransactionWarningLimit): TransactionWarningLimit {
    const now = new Date().toISOString();
    return {
      id: String(row.id || this.createId('limit')),
      clientId: String(row.clientId || 'client-sample'),
      fiatSingleTransactionLimit: String(row.fiatSingleTransactionLimit || '15000'),
      fiatBigSingleTransactionLimit: String(row.fiatBigSingleTransactionLimit || '100000'),
      fiatAllLowTransactionsLimit: String(row.fiatAllLowTransactionsLimit || '50000'),
      fiatAllBigTransactionsLimit: String(row.fiatAllBigTransactionsLimit || '100000'),
      createdAt: row.createdAt ?? now,
      updatedAt: row.updatedAt ?? row.createdAt ?? now,
    };
  }

  private defaultClientLimit(clientId: string, now: string): TransactionWarningLimit {
    return {
      id: `limit-${clientId}`,
      clientId,
      fiatSingleTransactionLimit: '15000',
      fiatBigSingleTransactionLimit: '100000',
      fiatAllLowTransactionsLimit: '50000',
      fiatAllBigTransactionsLimit: '100000',
      createdAt: now,
      updatedAt: now,
    };
  }

  private readEscalations(): StoredEscalation[] {
    try {
      const raw = localStorage.getItem(ESCALATIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as StoredEscalation[]) : [];
    } catch {
      return [];
    }
  }

  private persistEscalations(escalations: readonly StoredEscalation[]): void {
    localStorage.setItem(ESCALATIONS_KEY, JSON.stringify(escalations));
  }

  private createId(prefix: string): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private time(value?: string | null): number {
    if (!value) return 0;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
}
