import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';

import { ActivityWarning, ActivityWarningState } from '../../services/api.service';
import { activityWarningTypeLabel } from '../../core/activity-warning-labels';
import { ActivityWarningsStoreService } from '../../services/activity-warnings-store.service';
import { AuthService } from '../../services/auth.service';
import { STAFF_PERMISSIONS } from '../../core/staff-permissions';
import { formatFiatAmount } from '../../shared/amount-format';

type WarningTab = 'active' | 'solved';

@Component({
  selector: 'app-activity-warnings-page',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, TableModule, TabsModule, DialogModule],
  templateUrl: './activity-warnings.page.html',
  styleUrl: './activity-warnings.page.css',
})
export class ActivityWarningsPage {
  private readonly activityWarnings = inject(ActivityWarningsStoreService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);
  private readonly router = inject(Router);

  readonly pageSize = 20;
  readonly canManage = this.auth.hasAnyRole(STAFF_PERMISSIONS.activityWarningsManage);
  readonly canEscalate = this.auth.hasAnyRole(STAFF_PERMISSIONS.activityWarningEscalationCreate);
  readonly activeTab = signal<WarningTab>('active');
  readonly warnings = signal<ActivityWarning[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly escalationLoading = signal(false);
  readonly escalationOpen = signal(false);
  readonly search = signal('');
  readonly selected = signal<ActivityWarning | null>(null);
  readonly detailVisible = signal(false);

  readonly escalationForm = this.fb.nonNullable.group({
    body: ['', [Validators.required, Validators.maxLength(8000)]],
  });

  readonly activeWarnings = computed(() => this.filterWarnings('pending'));
  readonly solvedWarnings = computed(() => this.filterWarnings('solved'));

  get escalationBody() {
    return this.escalationForm.controls.body;
  }

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.activityWarnings.listActivityWarnings();
      this.warnings.set(res.warnings ?? []);
    } catch (err) {
      this.toast('error', 'Could not load warnings', this.errorOf(err));
    } finally {
      this.loading.set(false);
    }
  }

  onTabChange(key: string | number | undefined): void {
    this.activeTab.set((key as WarningTab) ?? 'active');
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  clearSearch(): void {
    this.search.set('');
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
        this.activityWarnings
          .updateActivityWarningState(warning.id, { state: 'solved' })
          .then((res) => {
            this.patchWarning(res.warning);
            this.selected.set(res.warning);
            this.activeTab.set('solved');
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
    this.escalationLoading.set(true);
    try {
      const res = await this.activityWarnings.createEscalation(warning, this.escalationBodyFor(warning, message));
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

  private filterWarnings(state: ActivityWarningState): ActivityWarning[] {
    const query = this.search().trim().toLowerCase();
    return this.warnings().filter((warning) => {
      if (warning.state !== state) return false;
      if (!query) return true;
      return [
        warning.client?.email,
        warning.type,
        warning.kycaidRiskReason,
        warning.wallet?.publicAddress,
        warning.transaction?.id,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
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
