import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { TableLazyLoadEvent, TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';

import { ActivityWarning, ActivityWarningStaffScope, ActivityWarningState, ApiService } from '../../services/api.service';
import { activityWarningTypeLabel } from '../../core/activity-warning-labels';
import { AuthService } from '../../services/auth.service';
import { STAFF_PERMISSIONS, STAFF_ROLES } from '../../core/staff-permissions';
import { formatFiatAmount } from '../../shared/amount-format';
import {
  formatKycaidRiskScorePercent,
  hasKycaidRiskScore,
  KYCAID_RISK_LEGEND_ITEMS,
  kycaidRiskScoreBadgeClass,
  kycaidRiskScoreBadgeLabel,
} from '../../shared/kycaid-risk-score';

type WarningTab = 'active' | 'solved';
type ActivityWarningSortBy =
  | 'createdAt'
  | 'updatedAt'
  | 'reviewedAt'
  | 'type'
  | 'state'
  | 'clientEmail'
  | 'reviewedByEmail'
  | 'triggerAmountEur'
  | 'totalAmountEur'
  | 'thresholdAmountEur';
type SortDir = 'asc' | 'desc';

interface StaffScopeTab {
  key: ActivityWarningStaffScope;
  label: string;
  icon: string;
}

const STAFF_SCOPE_TABS: readonly StaffScopeTab[] = [
  { key: 'mine', label: 'My activity warnings', icon: 'pi pi-shield' },
  { key: 'others', label: 'Other compliance activity warnings', icon: 'pi pi-users' },
];

@Component({
  selector: 'app-activity-warnings-page',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, TableModule, TabsModule, DialogModule],
  templateUrl: './activity-warnings.page.html',
  styleUrl: './activity-warnings.page.css',
})
export class ActivityWarningsPage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);
  private readonly router = inject(Router);

  readonly rowsPerPageOptions = [10, 25, 50];
  readonly canManage = this.auth.hasAnyRole(STAFF_PERMISSIONS.activityWarningsManage);
  readonly canEscalate = this.auth.hasAnyRole(STAFF_PERMISSIONS.activityWarningEscalationCreate);
  readonly staffScopeTabs = STAFF_SCOPE_TABS;
  readonly kycaidRiskLegend = KYCAID_RISK_LEGEND_ITEMS;
  readonly showStaffScopeTabs = computed(() => this.auth.currentRole() === STAFF_ROLES.complianceOfficer);
  readonly activeStaffScope = signal<ActivityWarningStaffScope>('mine');
  readonly activeTab = signal<WarningTab>('active');
  readonly warnings = signal<ActivityWarning[]>([]);
  readonly total = signal(0);
  readonly countsByState = signal<Partial<Record<ActivityWarningState, number>>>({});
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly sortBy = signal<ActivityWarningSortBy>('createdAt');
  readonly sortDir = signal<SortDir>('desc');
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly escalationLoading = signal(false);
  readonly escalationOpen = signal(false);
  readonly search = signal('');
  readonly selected = signal<ActivityWarning | null>(null);
  readonly detailVisible = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly escalationForm = this.fb.nonNullable.group({
    body: ['', [Validators.required, Validators.maxLength(8000)]],
  });

  readonly activeWarnings = computed(() => this.warnings());
  readonly solvedWarnings = computed(() => this.warnings());

  get escalationBody() {
    return this.escalationForm.controls.body;
  }

  constructor() {
    void this.load();
  }

  async load(showLoading = true): Promise<void> {
    if (showLoading) {
      this.loading.set(true);
    }
    try {
      const res = await this.api.listActivityWarnings({
        page: this.page(),
        pageSize: this.pageSize(),
        staffScope: this.showStaffScopeTabs() ? this.activeStaffScope() : undefined,
        state: this.warningStateForTab(this.activeTab()),
        q: this.searchTerm(),
        sortBy: this.sortBy(),
        sortDir: this.sortDir(),
      });
      this.warnings.set(res.warnings ?? []);
      this.total.set(res.total ?? 0);
      this.countsByState.set(res.countsByState ?? {});
    } catch (err) {
      this.toast('error', 'Could not load warnings', this.errorOf(err));
    } finally {
      this.loading.set(false);
    }
  }

  refresh(): void {
    void this.load();
  }

  onLazyLoad(event: TableLazyLoadEvent): void {
    const rows = event.rows ?? this.pageSize();
    const first = event.first ?? 0;
    this.pageSize.set(rows);
    this.page.set(Math.floor(first / rows) + 1);
    this.sortBy.set(this.sortFieldForBackend(event.sortField));
    this.sortDir.set(event.sortOrder === 1 ? 'asc' : 'desc');
    void this.load();
  }

  private searchTerm(): string | undefined {
    return this.search().trim() || undefined;
  }

  private warningStateForTab(tab: WarningTab): ActivityWarningState {
    return tab === 'solved' ? 'solved' : 'pending';
  }

  private sortFieldForBackend(field: string | string[] | undefined | null): ActivityWarningSortBy {
    const value = Array.isArray(field) ? field[0] : field;
    switch (value) {
      case 'client.email':
        return 'clientEmail';
      case 'reviewedBy.email':
        return 'reviewedByEmail';
      case 'reviewedAt':
      case 'type':
      case 'state':
      case 'triggerAmountEur':
      case 'totalAmountEur':
      case 'thresholdAmountEur':
      case 'updatedAt':
      case 'createdAt':
        return value;
      default:
        return 'createdAt';
    }
  }

  tabCount(tab: WarningTab): number {
    return this.countsByState()[this.warningStateForTab(tab)] ?? 0;
  }

  onTabChange(key: string | number | undefined): void {
    this.activeTab.set((key as WarningTab) ?? 'active');
    this.page.set(1);
    void this.load();
  }

  setStaffScope(key: ActivityWarningStaffScope): void {
    if (this.activeStaffScope() === key) return;
    this.activeStaffScope.set(key);
    this.page.set(1);
    void this.load();
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      void this.load();
    }, 300);
  }

  clearSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.search.set('');
    this.page.set(1);
    void this.load();
  }

  openWarning(warning: ActivityWarning): void {
    this.selected.set(warning);
    this.cancelEscalation();
    this.detailVisible.set(true);
  }

  closeDetail(): void {
    this.selected.set(null);
    this.cancelEscalation();
  }

  async openClient(warning: ActivityWarning): Promise<void> {
    if (!warning.client?.id) return;
    this.detailVisible.set(false);
    await this.router.navigate(['/clients'], { queryParams: { client: warning.client.id } });
  }

  markSolved(warning: ActivityWarning): void {
    if (!this.canManage || warning.state === 'solved') return;

    this.confirm.confirm({
      header: 'Resolve activity warning',
      message: 'Mark this warning as solved?',
      icon: 'pi pi-check-circle',
      acceptLabel: 'Resolve',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => {
        this.busy.set(true);
        this.api
          .updateActivityWarningState(warning.id, { state: 'solved' })
          .then((res) => {
            this.patchWarning(res.warning);
            this.selected.set(res.warning);
            this.activeTab.set('solved');
            this.page.set(1);
            void this.load(false);
            this.toast('success', 'Warning resolved', res.message ?? 'The warning was updated.');
          })
          .catch((err) => this.toast('error', 'Could not update warning', this.errorOf(err)))
          .finally(() => this.busy.set(false));
      },
    });
  }

  openEscalation(warning: ActivityWarning): void {
    if (!this.canEscalate) return;
    this.selected.set(warning);
    this.escalationForm.reset({ body: '' });
    this.escalationOpen.set(true);
  }

  cancelEscalation(): void {
    this.escalationForm.reset({ body: '' });
    this.escalationOpen.set(false);
  }

  async createEscalation(warning: ActivityWarning): Promise<void> {
    if (!this.canEscalate) return;
    if (this.escalationForm.invalid) {
      this.escalationForm.markAllAsTouched();
      return;
    }

    const message = this.escalationForm.getRawValue().body.trim();
    const creatorId = this.auth.currentUserId();
    if (!creatorId) {
      this.toast('error', 'Could not create escalation', 'The current staff session could not be identified.');
      return;
    }

    this.escalationLoading.set(true);
    try {
      const res = await this.api.createActionRequest({
        staffUserCreatorId: creatorId,
        target: 'COMPLIANCE_OFFICER',
        subject: this.escalationSubjectFor(warning),
        body: this.escalationBodyFor(warning, message),
      });
      this.cancelEscalation();
      this.toast('success', 'Case escalated', res.message ?? 'The compliance officers were notified.');
    } catch (err: unknown) {
      this.toast('error', 'Could not create escalation', this.errorOf(err));
    } finally {
      this.escalationLoading.set(false);
    }
  }

  private patchWarning(updated: ActivityWarning): void {
    this.warnings.update((list) => list.map((w) => (w.id === updated.id ? updated : w)));
  }

  private escalationBodyFor(warning: ActivityWarning, message: string): string {
    const lines = [
      message,
      '',
      '---',
      'Activity warning context',
      `Warning ID: ${warning.id}`,
      `Client: ${warning.client?.email ?? '-'} (${warning.client?.id ?? '-'})`,
      `Type: ${this.prettyType(warning.type)}`,
      `State: ${this.prettyState(warning.state)}`,
      `Created: ${this.formatDate(warning.createdAt)}`,
      `Trigger: ${this.formatAmount(warning.triggerAmountEur ?? warning.totalAmountEur)} EUR`,
      `Threshold: ${this.formatAmount(warning.thresholdAmountEur)} EUR`,
      warning.transaction?.id ? `Transaction: ${warning.transaction.id}` : null,
      warning.wallet?.publicAddress ? `Wallet: ${warning.wallet.publicAddress}` : null,
      warning.kycaidRiskReason ? `KYCAID reason: ${warning.kycaidRiskReason}` : null,
    ].filter((line): line is string => line !== null);

    const body = lines.join('\n');
    return body.length > 10000 ? `${body.slice(0, 9997)}...` : body;
  }

  private escalationSubjectFor(warning: ActivityWarning): string {
    const subject = `Activity warning escalation: ${warning.client?.email ?? 'Client'}`;
    return subject.length > 100 ? `${subject.slice(0, 97)}...` : subject;
  }

  warningTitle(warning: ActivityWarning | null): string {
    if (!warning) return 'Activity warning';
    return `${this.prettyType(warning.type)} - ${warning.client?.email ?? 'Client'}`;
  }

  prettyType(type?: string): string {
    return activityWarningTypeLabel(type);
  }

  warningSummary(warning: ActivityWarning): string {
    if (warning.summary?.trim()) return warning.summary;
    if (warning.kycaidRiskReason) return warning.kycaidRiskReason;
    if (warning.transactionCount) return `${warning.transactionCount} transactions matched the rule.`;
    if (warning.triggerAmountEur && warning.thresholdAmountEur) {
      return `${this.formatAmount(warning.triggerAmountEur)} EUR triggered a ${this.formatAmount(warning.thresholdAmountEur)} EUR threshold.`;
    }
    if (warning.totalAmountEur && warning.thresholdAmountEur) {
      return `${this.formatAmount(warning.totalAmountEur)} EUR total crossed a ${this.formatAmount(warning.thresholdAmountEur)} EUR threshold.`;
    }
    return 'Compliance review required.';
  }

  warningBadge(state?: string): string {
    switch (state) {
      case 'solved':
        return 'cf-badge cf-badge--success';
      case 'pending':
        return 'cf-badge cf-badge--warning';
      default:
        return 'cf-badge cf-badge--neutral';
    }
  }

  riskBadge(state?: string | null): string {
    switch (state) {
      case 'clear':
        return 'cf-badge cf-badge--success';
      case 'high_risk':
      case 'failed':
        return 'cf-badge cf-badge--danger';
      case 'review':
      case 'pending':
        return 'cf-badge cf-badge--warning';
      default:
        return 'cf-badge cf-badge--neutral';
    }
  }

  kycaidRiskScore(value: string | number | null | undefined): string {
    return formatKycaidRiskScorePercent(value);
  }

  hasKycaidRiskScore(value: string | number | null | undefined): boolean {
    return hasKycaidRiskScore(value);
  }

  kycaidRiskScoreBadge(value: string | number | null | undefined, state?: string | null): string {
    return kycaidRiskScoreBadgeClass(value, state);
  }

  kycaidRiskScoreLabel(value: string | number | null | undefined, state?: string | null): string {
    return kycaidRiskScoreBadgeLabel(value, state);
  }

  prettyState(state?: string | null): string {
    if (!state) return '-';
    return state.charAt(0).toUpperCase() + state.slice(1).replace(/_/g, ' ');
  }

  shortId(value?: string): string {
    return value ? `#${value.slice(0, 8).toUpperCase()}` : '-';
  }

  shortAddress(value?: string): string {
    if (!value) return '-';
    return value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
  }

  formatDate(value?: string | null): string {
    if (!value) return '-';
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  formatAmount(value?: string | null): string {
    return formatFiatAmount(value);
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
}
