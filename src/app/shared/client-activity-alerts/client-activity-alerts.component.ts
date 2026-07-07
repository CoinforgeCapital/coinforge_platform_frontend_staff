import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';

import {
  ActivityWarning,
  ActivityWarningState,
  ApiService,
} from '../../services/api.service';
import { activityWarningTypeLabel } from '../../core/activity-warning-labels';
import { formatFiatAmount } from '../amount-format';
import {
  formatKycaidRiskScorePercent,
  hasKycaidRiskScore,
  KYCAID_RISK_LEGEND_ITEMS,
  kycaidRiskScoreBadgeClass,
  kycaidRiskScoreBadgeLabel,
} from '../kycaid-risk-score';

type WarningTab = 'active' | 'solved';

@Component({
  selector: 'app-client-activity-alerts',
  standalone: true,
  imports: [FormsModule, TableModule, TabsModule, DialogModule],
  templateUrl: './client-activity-alerts.component.html',
  styleUrl: './client-activity-alerts.component.css',
})
export class ClientActivityAlertsComponent {
  private readonly api = inject(ApiService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  readonly clientId = input.required<string>();
  readonly clientEmail = input<string>('');
  readonly canManage = input<boolean>(false);

  readonly pageSize = 10;
  readonly kycaidRiskLegend = KYCAID_RISK_LEGEND_ITEMS;
  readonly activeTab = signal<WarningTab>('active');
  readonly warnings = signal<ActivityWarning[]>([]);
  readonly warningsLoading = signal(false);
  readonly busy = signal(false);
  readonly selected = signal<ActivityWarning | null>(null);
  readonly detailVisible = signal(false);

  readonly activeWarnings = computed(() => this.filterWarnings('pending'));
  readonly solvedWarnings = computed(() => this.filterWarnings('solved'));

  private loadedForId: string | null = null;

  constructor() {
    effect(() => {
      const id = this.clientId();
      if (!id || id === this.loadedForId) return;
      this.loadedForId = id;
      this.warnings.set([]);
      this.selected.set(null);
      this.detailVisible.set(false);
      void this.reload();
    });
  }

  async reload(): Promise<void> {
    const id = this.clientId();
    await this.loadWarnings(id);
  }

  onTabChange(key: string | number | undefined): void {
    this.activeTab.set((key as WarningTab) ?? 'active');
  }

  openWarning(warning: ActivityWarning): void {
    this.selected.set(warning);
    this.detailVisible.set(true);
  }

  markSolved(warning: ActivityWarning): void {
    if (!this.canManage() || warning.state === 'solved') return;

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
            this.toast('success', 'Warning resolved', res.message ?? 'The warning was updated.');
          })
          .catch((err) => this.toast('error', 'Could not update warning', this.errorOf(err)))
          .finally(() => this.busy.set(false));
      },
    });
  }

  warningTitle(warning: ActivityWarning | null): string {
    if (!warning) return 'Activity warning';
    return `${this.warningDisplayName(warning)} - ${warning.client?.email ?? this.clientEmail()}`;
  }

  prettyType(type?: string): string {
    return activityWarningTypeLabel(type);
  }

  warningDisplayName(warning: ActivityWarning): string {
    return warning.ruleSnapshot?.name?.trim() || warning.rule?.name || this.prettyType(warning.type);
  }

  warningSummary(warning: ActivityWarning): string {
    if (warning.summary?.trim()) return warning.summary;
    if (warning.ruleSnapshot?.description?.trim()) return warning.ruleSnapshot.description;
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

  private async loadWarnings(clientId: string): Promise<void> {
    this.warningsLoading.set(true);
    try {
      const res = await this.api.listClientActivityWarnings(clientId);
      this.warnings.set(res.warnings ?? []);
    } catch (err) {
      this.toast('error', 'Could not load warnings', this.errorOf(err));
    } finally {
      this.warningsLoading.set(false);
    }
  }

  private patchWarning(updated: ActivityWarning): void {
    this.warnings.update((list) => list.map((w) => (w.id === updated.id ? updated : w)));
  }

  private filterWarnings(state: ActivityWarningState): ActivityWarning[] {
    return this.warnings().filter((warning) => warning.state === state);
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
