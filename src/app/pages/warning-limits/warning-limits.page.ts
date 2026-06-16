import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MessageService } from 'primeng/api';

import {
  WarningLimit,
  WarningLimitsService,
} from '../../services/warning-limits.service';

interface Option {
  label: string;
  value: string;
}

const WARNING_TYPES: readonly Option[] = [
  { label: 'Single transaction limit', value: 'SINGLE' },
  { label: 'Large single transaction', value: 'SINGLE_100K' },
  { label: 'Total volume review', value: 'ALL_50k' },
  { label: 'High total volume review', value: 'ALL_100k' },
  { label: 'Transaction velocity', value: 'THREE_TRANSACTION_24H' },
  { label: 'Wallet reputation review', value: 'WALLET_REPUTATION' },
  { label: 'Sanctions Match', value: 'SANCTIONS_MATCH' },
  { label: 'High-Risk Wallet Exposure', value: 'HIGH_RISK_WALLET_EXPOSURE' },
  { label: 'Mixer or Obfuscation Exposure', value: 'MIXER_OBFUSCATION_EXPOSURE' },
  { label: 'Third-Party Fiat Funding', value: 'THIRD_PARTY_FIAT_FUNDING' },
  { label: 'Third-Party Fiat Payout', value: 'THIRD_PARTY_FIAT_PAYOUT' },
  { label: 'Same Bank Account Used by Multiple Customers', value: 'SAME_BANK_ACCOUNT_MULTIPLE_CUSTOMERS' },
  { label: 'Same Wallet Used by Multiple Customers', value: 'SAME_WALLET_MULTIPLE_CUSTOMERS' },
  { label: 'Multiple Fiat Sources to One Wallet', value: 'MULTIPLE_FIAT_SOURCES_ONE_WALLET' },
  { label: 'Multiple Wallets to One Fiat Account', value: 'MULTIPLE_WALLETS_ONE_FIAT_ACCOUNT' },
  { label: 'Structuring Below Thresholds', value: 'STRUCTURING_BELOW_THRESHOLDS' },
  { label: 'High-Value New Customer Transaction', value: 'HIGH_VALUE_NEW_CUSTOMER' },
  { label: 'Activity Inconsistent With Customer Profile', value: 'ACTIVITY_INCONSISTENT_PROFILE' },
  { label: 'Unusual Transaction Velocity', value: 'UNUSUAL_TRANSACTION_VELOCITY' },
  { label: 'Rapid Repeated Wallet Changes', value: 'RAPID_REPEATED_WALLET_CHANGES' },
  { label: 'High-Risk Jurisdiction Indicator', value: 'HIGH_RISK_JURISDICTION' },
  { label: 'VPN, Proxy, TOR, or Location Mismatch', value: 'VPN_PROXY_TOR_LOCATION_MISMATCH' },
  { label: 'Crypto-to-Fiat From Risky Source Wallet', value: 'CRYPTO_FIAT_RISKY_SOURCE_WALLET' },
  { label: 'Fiat-to-Crypto To Risky Destination Wallet', value: 'FIAT_CRYPTO_RISKY_DESTINATION_WALLET' },
  { label: 'Privacy Coin or High-Anonymity Asset Use', value: 'PRIVACY_COIN_HIGH_ANONYMITY' },
  { label: 'Chain-Hopping or Asset-Hopping', value: 'CHAIN_HOPPING_ASSET_HOPPING' },
  { label: 'Bridge Exposure', value: 'BRIDGE_EXPOSURE' },
  { label: 'Travel Rule Information Missing or Incomplete', value: 'TRAVEL_RULE_INFO_MISSING' },
  { label: 'Counterparty CASP/VASP High Risk', value: 'COUNTERPARTY_VASP_HIGH_RISK' },
  { label: 'Payment Reversal After Crypto Delivery', value: 'PAYMENT_REVERSAL_AFTER_CRYPTO' },
  { label: 'Repeated Cancelled or Failed Payment Attempts', value: 'REPEATED_CANCELLED_FAILED_PAYMENTS' },
  { label: 'Dormant Customer Reactivation', value: 'DORMANT_CUSTOMER_REACTIVATION' },
  { label: 'Repeated Alerts on Same Customer', value: 'REPEATED_ALERTS_SAME_CUSTOMER' },
  { label: 'Source of Funds Not Supported', value: 'SOURCE_OF_FUNDS_NOT_SUPPORTED' },
];

const SEVERITIES: readonly Option[] = [
  { label: 'Info', value: 'info' },
  { label: 'Warning', value: 'warning' },
  { label: 'Critical', value: 'critical' },
];

const STATUSES: readonly Option[] = [
  { label: 'Active', value: 'active' },
  { label: 'Draft', value: 'draft' },
  { label: 'Paused', value: 'paused' },
];

@Component({
  selector: 'app-warning-limits-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './warning-limits.page.html',
  styleUrl: './warning-limits.page.css',
})
export class WarningLimitsPage implements OnInit {
  private readonly service = inject(WarningLimitsService);
  private readonly fb = inject(FormBuilder);
  private readonly messages = inject(MessageService);

  readonly warningTypes = WARNING_TYPES;
  readonly severities = SEVERITIES;
  readonly statuses = STATUSES;

  readonly limits = signal<WarningLimit[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly search = signal('');

  readonly filteredLimits = computed(() => {
    const query = this.search().trim().toLowerCase();
    const rows = [...this.limits()].sort((a, b) => this.time(b.updatedAt) - this.time(a.updatedAt));
    if (!query) return rows;
    return rows.filter((limit) =>
      [
        limit.name,
        limit.warningType,
        limit.severity,
        limit.status,
        limit.description,
      ].some((value) => String(value).toLowerCase().includes(query)),
    );
  });

  readonly activeCount = computed(() => this.limits().filter((limit) => limit.status === 'active').length);
  readonly draftCount = computed(() => this.limits().filter((limit) => limit.status === 'draft').length);
  readonly criticalCount = computed(() => this.limits().filter((limit) => limit.severity === 'critical').length);

  readonly form = this.fb.nonNullable.group({
    id: [''],
    name: ['', [Validators.required, Validators.maxLength(80)]],
    warningType: ['SINGLE', [Validators.required]],
    amountEur: [0, [Validators.required, Validators.min(0)]],
    transactionCount: [0, [Validators.min(0)]],
    windowHours: [0, [Validators.min(0)]],
    severity: ['warning', [Validators.required]],
    status: ['active', [Validators.required]],
    description: ['', [Validators.maxLength(1200)]],
  });

  ngOnInit(): void {
    void this.load();
  }

  get name() {
    return this.form.controls.name;
  }

  get amountEur() {
    return this.form.controls.amountEur;
  }

  get description() {
    return this.form.controls.description;
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.limits.set(await this.service.list());
    } catch (err: unknown) {
      this.toast('error', 'Could not load warning limits', this.errorOf(err));
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  clearSearch(): void {
    this.search.set('');
  }

  createNew(): void {
    this.selectedId.set(null);
    this.form.reset({
      id: '',
      name: '',
      warningType: 'SINGLE',
      amountEur: 0,
      transactionCount: 0,
      windowHours: 0,
      severity: 'warning',
      status: 'active',
      description: '',
    });
  }

  edit(limit: WarningLimit): void {
    this.selectedId.set(limit.id);
    this.form.reset({
      id: limit.id,
      name: limit.name,
      warningType: limit.warningType,
      amountEur: limit.amountEur,
      transactionCount: limit.transactionCount ?? 0,
      windowHours: limit.windowHours ?? 0,
      severity: limit.severity,
      status: limit.status,
      description: limit.description,
    });
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.saving.set(true);
    try {
      const saved = await this.service.save({
        id: value.id || undefined,
        name: value.name,
        warningType: value.warningType,
        amountEur: Number(value.amountEur),
        transactionCount: Number(value.transactionCount),
        windowHours: Number(value.windowHours),
        severity: value.severity as WarningLimit['severity'],
        status: value.status as WarningLimit['status'],
        description: value.description,
      });
      const list = await this.service.list();
      this.limits.set(list);
      this.edit(saved);
      this.toast('success', 'Warning limit saved', 'The warning limit was saved.');
    } catch (err: unknown) {
      this.toast('error', 'Could not save warning limit', this.errorOf(err));
    } finally {
      this.saving.set(false);
    }
  }

  async restoreDefaults(): Promise<void> {
    this.loading.set(true);
    try {
      const list = await this.service.reset();
      this.limits.set(list);
      this.createNew();
      this.toast('success', 'Warning limits restored', 'The default warning limits were restored.');
    } catch (err: unknown) {
      this.toast('error', 'Could not restore warning limits', this.errorOf(err));
    } finally {
      this.loading.set(false);
    }
  }

  limitTypeLabel(type: string): string {
    return this.warningTypes.find((option) => option.value === type)?.label ?? this.pretty(type);
  }

  optionLabel(options: readonly Option[], value: string): string {
    return options.find((option) => option.value === value)?.label ?? this.pretty(value);
  }

  formatAmount(value: number): string {
    if (!value) return '-';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  }

  formatTrigger(limit: WarningLimit): string {
    if (limit.warningType === 'THREE_TRANSACTION_24H') {
      return `${limit.transactionCount ?? 0} transactions / ${limit.windowHours ?? 0}h`;
    }
    if (limit.warningType === 'WALLET_REPUTATION') {
      return 'External risk result';
    }
    return `${this.formatAmount(limit.amountEur)} EUR`;
  }

  badgeClass(kind: 'severity' | 'status', value: string): string {
    if (kind === 'severity') {
      if (value === 'critical') return 'cf-badge cf-badge--danger';
      if (value === 'info') return 'cf-badge cf-badge--info';
      return 'cf-badge cf-badge--warning';
    }
    if (value === 'active') return 'cf-badge cf-badge--success';
    if (value === 'paused') return 'cf-badge cf-badge--neutral';
    return 'cf-badge cf-badge--info';
  }

  private pretty(value: string): string {
    return value
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private time(value: string): number {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  private toast(severity: 'success' | 'error', summary: string, detail: string): void {
    this.messages.add({ severity, summary, detail, life: severity === 'error' ? 6000 : 4200 });
  }

  private errorOf(err: unknown): string {
    const error = err as { error?: { message?: unknown }; message?: unknown };
    if (typeof error.error?.message === 'string' && error.error.message.trim()) return error.error.message;
    if (typeof error.message === 'string' && error.message.trim()) return error.message;
    return 'The request could not be completed.';
  }
}
