import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';

import { ApiService, ComplianceAssignment, StaffUser } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { STAFF_PERMISSIONS, STAFF_ROLES } from '../../core/staff-permissions';
import { UserAutocompleteComponent } from '../../shared/user-autocomplete/user-autocomplete.component';
import { matchesClientIdentity } from '../../shared/client-identity-search';

type Tab = 'assignments' | 'unassigned' | 'by-compliance';

@Component({
  selector: 'app-compliance-assignments-page',
  standalone: true,
  imports: [TableModule, UserAutocompleteComponent],
  templateUrl: './compliance-assignments.page.html',
  styleUrl: './compliance-assignments.page.css',
})
export class ComplianceAssignmentsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);
  private readonly router = inject(Router);

  readonly canCreate = this.auth.hasAnyRole(STAFF_PERMISSIONS.complianceAssignmentCreate);
  readonly canReassign = this.auth.hasAnyRole(STAFF_PERMISSIONS.complianceAssignmentReassign);
  readonly canViewByCompliance = this.auth.hasAnyRole(STAFF_PERMISSIONS.complianceAssignmentByUser);
  readonly isComplianceOfficer = computed(() => this.auth.currentRole() === STAFF_ROLES.complianceOfficer);
  readonly assignableComplianceRoles = ['COMPLIANCE'] as const;
  readonly reassignableComplianceRoles = ['COMPLIANCE', 'COMPLIANCE_OFFICER'] as const;

  readonly assignments = signal<ComplianceAssignment[]>([]);
  readonly unassignedClients = signal<StaffUser[]>([]);
  readonly userSearch = signal('');
  readonly filteredAssignments = computed(() => this.filterAssignments(this.assignments()));
  readonly filteredUnassignedClients = computed(() => this.filterClients(this.unassignedClients()));
  readonly filteredByAssignments = computed(() => this.filterAssignments(this.byAssignments()));
  readonly loading = signal(false);
  readonly loadingClients = signal(false);
  readonly unassignedLoaded = signal(false);
  readonly creating = signal(false);
  readonly reassigningId = signal<string | null>(null);

  readonly tab = signal<Tab>('assignments');
  readonly selectedClient = signal<StaffUser | null>(null);
  readonly selectedCompliance = signal<StaffUser | null>(null);
  readonly selectedReassignment = signal<ComplianceAssignment | null>(null);
  readonly selectedReassignmentCompliance = signal<StaffUser | null>(null);
  readonly reassignmentReason = signal('');
  /** Solo aplica al compliance officer: true = se asigna a sí mismo. */
  readonly selfAssign = signal(false);

  // ---- Vista "por compliance" (admin / CO / operator) ----
  readonly complianceUsers = signal<StaffUser[]>([]);
  readonly complianceUsersLoaded = signal(false);
  readonly byFilterId = signal<string>('');
  readonly byAssignments = signal<ComplianceAssignment[]>([]);
  readonly loadingBy = signal(false);

  ngOnInit(): void {
    void this.loadAssignments();
  }

  setTab(tab: Tab): void {
    this.tab.set(tab);
    if (tab === 'unassigned') {
      this.cancelReassignment();
      this.resetSelection();
      if (!this.unassignedLoaded()) void this.loadUnassignedClients();
    } else if (tab === 'by-compliance') {
      this.cancelReassignment();
      if (!this.complianceUsersLoaded()) void this.loadComplianceUsers();
    }
  }

  refresh(): void {
    if (this.tab() === 'assignments') void this.loadAssignments();
    else if (this.tab() === 'unassigned') void this.loadUnassignedClients();
    else if (this.byFilterId()) void this.loadByCompliance(this.byFilterId());
  }

  onUserSearchInput(event: Event): void {
    this.userSearch.set((event.target as HTMLInputElement).value);
  }

  clearUserSearch(): void {
    this.userSearch.set('');
  }

  /** Abre el detalle del cliente (misma página que Clients) a partir de una asignación. */
  openClientDetail(assignment: ComplianceAssignment): void {
    const clientId = assignment.clientUser?.id;
    if (clientId) void this.router.navigate(['/clients'], { queryParams: { client: clientId } });
  }

  async loadAssignments(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.api.listComplianceAssignments();
      this.assignments.set(res.assignments ?? []);
    } catch {
      /* el interceptor ya muestra el aviso */
    } finally {
      this.loading.set(false);
    }
  }

  async loadUnassignedClients(): Promise<void> {
    this.loadingClients.set(true);
    try {
      const res = await this.api.listUnassignedClients();
      this.unassignedClients.set(res.clients ?? []);
      this.unassignedLoaded.set(true);
    } catch (err: unknown) {
      this.toast('error', 'Could not load clients', this.errorOf(err));
    } finally {
      this.loadingClients.set(false);
    }
  }

  private resetSelection(): void {
    this.selectedClient.set(null);
    this.selectedCompliance.set(null);
    this.selfAssign.set(false);
  }

  // ---- vista por compliance ----

  async loadComplianceUsers(): Promise<void> {
    try {
      const res = await this.api.listStaffMembers();
      this.complianceUsers.set(
        (res.users ?? []).filter((u) => u.role === 'COMPLIANCE' || u.role === 'COMPLIANCE_OFFICER'),
      );
      this.complianceUsersLoaded.set(true);
    } catch (err: unknown) {
      this.toast('error', 'Could not load compliance users', this.errorOf(err));
    }
  }

  onFilterCompliance(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.byFilterId.set(id);
    if (id) void this.loadByCompliance(id);
    else this.byAssignments.set([]);
  }

  async loadByCompliance(complianceUserId: string): Promise<void> {
    this.loadingBy.set(true);
    try {
      const res = await this.api.listComplianceAssignmentsByComplianceUser(complianceUserId);
      this.byAssignments.set(res.assignments ?? []);
    } catch (err: unknown) {
      this.toast('error', 'Could not load assignments', this.errorOf(err));
    } finally {
      this.loadingBy.set(false);
    }
  }

  // ---- creación (solo compliance / compliance officer) ----

  onPickClient(client: StaffUser): void {
    if (!this.canCreate) return;
    this.selectedClient.set(client);
  }

  clearClient(): void {
    this.selectedClient.set(null);
  }

  setSelfAssign(value: boolean): void {
    this.selfAssign.set(value);
    if (value) this.selectedCompliance.set(null);
  }

  onPickCompliance(user: StaffUser): void {
    if (user.role !== 'COMPLIANCE') {
      this.toast('error', 'Invalid user', 'Pick a compliance user (role COMPLIANCE).');
      return;
    }
    this.selectedCompliance.set(user);
  }

  clearCompliance(): void {
    this.selectedCompliance.set(null);
  }

  onCreate(): void {
    const client = this.selectedClient();
    if (!client) {
      this.toast('error', 'Client required', 'Select a client to assign.');
      return;
    }
    if (this.isComplianceOfficer() && !this.selfAssign() && !this.selectedCompliance()) {
      this.toast('error', 'Compliance required', 'Select a compliance user, or choose "Assign to me".');
      return;
    }

    const assignToSelf = !this.isComplianceOfficer() || this.selfAssign();
    const target = assignToSelf ? 'yourself' : this.selectedCompliance()!.email;
    this.confirm.confirm({
      header: 'Create assignment',
      message: `Assign ${client.email} to ${target}?`,
      icon: 'pi pi-link',
      acceptLabel: 'Assign',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => void this.doCreate(),
    });
  }

  private async doCreate(): Promise<void> {
    const client = this.selectedClient();
    if (!client) return;

    // El compliance officer que se autoasigna NO envía complianceUserId (lo resuelve el backend).
    // El compliance "raso" tampoco lo envía (siempre se asigna a sí mismo).
    let complianceUserId: string | undefined;
    if (this.isComplianceOfficer() && !this.selfAssign()) {
      complianceUserId = this.selectedCompliance()?.id;
    }

    this.creating.set(true);
    try {
      const res = await this.api.createComplianceAssignment({ clientUserId: client.id, complianceUserId });
      this.resetSelection();
      await Promise.all([this.loadAssignments(), this.loadUnassignedClients()]);
      this.tab.set('assignments');
      this.toast('success', 'Assignment created', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not create', this.errorOf(err));
    } finally {
      this.creating.set(false);
    }
  }

  // ---- reasignación (solo compliance officer) ----

  startReassignment(assignment: ComplianceAssignment): void {
    if (!this.canReassign) return;
    this.selectedReassignment.set(assignment);
    this.selectedReassignmentCompliance.set(null);
    this.reassignmentReason.set('');
  }

  cancelReassignment(): void {
    this.selectedReassignment.set(null);
    this.selectedReassignmentCompliance.set(null);
    this.reassignmentReason.set('');
  }

  onPickReassignmentCompliance(user: StaffUser): void {
    if (user.role !== 'COMPLIANCE' && user.role !== 'COMPLIANCE_OFFICER') {
      this.toast('error', 'Invalid user', 'Pick a compliance staff user.');
      return;
    }
    if (user.state !== 'approved') {
      this.toast('error', 'Invalid user', 'The target compliance staff user must be approved.');
      return;
    }

    const assignment = this.selectedReassignment();
    if (assignment?.complianceUser?.id === user.id) {
      this.toast('error', 'Invalid user', 'This client is already assigned to that user.');
      return;
    }

    this.selectedReassignmentCompliance.set(user);
  }

  clearReassignmentCompliance(): void {
    this.selectedReassignmentCompliance.set(null);
  }

  onReassignmentReasonInput(event: Event): void {
    this.reassignmentReason.set((event.target as HTMLTextAreaElement).value);
  }

  onReassign(): void {
    const assignment = this.selectedReassignment();
    const target = this.selectedReassignmentCompliance();
    if (!assignment || !target) {
      this.toast('error', 'Compliance required', 'Select the new compliance staff user.');
      return;
    }

    this.confirm.confirm({
      header: 'Reassign client',
      message: `Move ${this.clientLabel(assignment)} from ${this.complianceLabel(assignment)} to ${target.email}? Open requirements and conversations will be transferred.`,
      icon: 'pi pi-users',
      acceptLabel: 'Reassign',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => void this.doReassign(assignment, target),
    });
  }

  private async doReassign(assignment: ComplianceAssignment, target: StaffUser): Promise<void> {
    const reason = this.reassignmentReason().trim();
    this.reassigningId.set(assignment.id);
    try {
      const res = await this.api.reassignComplianceAssignment(assignment.id, {
        complianceUserId: target.id,
        reason: reason || undefined,
      });
      this.cancelReassignment();
      await this.loadAssignments();
      if (this.byFilterId()) await this.loadByCompliance(this.byFilterId());
      this.toast('success', 'Assignment reassigned', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not reassign', this.errorOf(err));
    } finally {
      this.reassigningId.set(null);
    }
  }

  // ---- labels / helpers ----

  clientLabel(a: ComplianceAssignment): string {
    return a.clientUser?.email || '—';
  }
  clientNameLabel(client?: StaffUser | null): string {
    return [
      client?.personalData?.name,
      client?.personalData?.surname,
    ]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .join(' ');
  }
  complianceLabel(a: ComplianceAssignment): string {
    return a.complianceUser?.email || a.complianceUser?.nickname || '—';
  }
  assignedByLabel(a: ComplianceAssignment): string {
    return a.assignedByUser?.email || 'System';
  }
  roleLabel(role?: string): string {
    return String(role ?? '').replace(/_/g, ' ');
  }
  formatDate(value?: string | Date | null): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
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

  private filterAssignments(assignments: ComplianceAssignment[]): ComplianceAssignment[] {
    const term = this.userSearch().trim();
    if (!term) return assignments;

    return assignments.filter((assignment) => this.clientMatchesSearch(assignment.clientUser, term));
  }

  private filterClients(clients: StaffUser[]): StaffUser[] {
    const term = this.userSearch().trim();
    if (!term) return clients;

    return clients.filter((client) => this.clientMatchesSearch(client, term));
  }

  private clientMatchesSearch(client: StaffUser | null | undefined, term: string): boolean {
    if (!client) return false;
    const normalizedTerm = term.toLowerCase();
    return (
      matchesClientIdentity(client, normalizedTerm) ||
      String(client.id ?? '').toLowerCase().includes(normalizedTerm) ||
      String(client.nickname ?? '').toLowerCase().includes(normalizedTerm)
    );
  }
}
