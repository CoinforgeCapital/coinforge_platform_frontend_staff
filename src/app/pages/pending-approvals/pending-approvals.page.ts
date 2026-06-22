import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { DialogModule } from 'primeng/dialog';
import { ConfirmationService, MessageService } from 'primeng/api';

import {
  ApiService,
  PendingBankAccount,
  PendingKyc,
  PendingTransaction,
  PendingWallet,
  SettableTransactionState,
  StaffUser,
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { STAFF_PERMISSIONS } from '../../core/staff-permissions';
import { formatCryptoAmount, formatFiatAmount } from '../../shared/amount-format';
import { ApprovalRequirementWarningService } from '../../services/approval-requirement-warning.service';
import { matchesClientIdentity } from '../../shared/client-identity-search';

type TabKey = 'wallets' | 'bank-accounts' | 'transactions' | 'kyc';

interface ApprovalTab {
  key: TabKey;
  label: string;
  icon: string;
}

/** Fila seleccionada para el diálogo de cambio de estado (discriminada por tipo). */
type DialogRow =
  | { type: 'wallet'; data: PendingWallet }
  | { type: 'bank'; data: PendingBankAccount }
  | { type: 'transaction'; data: PendingTransaction }
  | { type: 'kyc'; data: PendingKyc };

interface ApprovalRequirementCheck {
  header: string;
  baseMessage: string;
  checkRequirements: () => Promise<string | null>;
  action: () => Promise<{ ok: boolean; message: string }>;
  summary: string;
  reload: () => void;
}

interface ConfirmRunOptions {
  icon?: string;
  acceptLabel?: string;
}

/**
 * Cola de elementos pendientes de aprobación (wallets, cuentas, transacciones, KYC).
 * Cada pestaña trae la lista completa de pendientes que el rol puede ver (el backend
 * acota: CO/operator/admin = todos; compliance = asignados) y se pagina en el cliente
 * (20 por página). Al pulsar una fila se abre un diálogo con las acciones disponibles.
 */
@Component({
  selector: 'app-pending-approvals-page',
  standalone: true,
  imports: [FormsModule, TableModule, TabsModule, DialogModule],
  templateUrl: './pending-approvals.page.html',
  styleUrl: './pending-approvals.page.css',
})
export class PendingApprovalsPage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);
  private readonly router = inject(Router);
  private readonly requirementWarnings = inject(ApprovalRequirementWarningService);

  /** Filas por página (paginación en cliente). */
  readonly pageSize = 20;

  // ---- Permisos (espejo del backend) ----
  readonly canFinancials = this.auth.hasAnyRole(STAFF_PERMISSIONS.clientFinancials);
  readonly canChangeTxState = this.auth.hasAnyRole(STAFF_PERMISSIONS.transactionStateChange);
  readonly canKyc = this.auth.hasAnyRole(STAFF_PERMISSIONS.kycReview);

  readonly tabs: ApprovalTab[] = this.buildTabs();
  readonly activeTab = signal<TabKey>(this.tabs[0]?.key ?? 'wallets');

  // ---- Datos por pestaña (lista completa; la tabla pagina en cliente) ----
  readonly walletRows = signal<PendingWallet[]>([]);
  readonly walletLoading = signal(false);

  readonly bankRows = signal<PendingBankAccount[]>([]);
  readonly bankLoading = signal(false);

  readonly txRows = signal<PendingTransaction[]>([]);
  readonly txLoading = signal(false);

  readonly kycRows = signal<PendingKyc[]>([]);
  readonly kycLoading = signal(false);

  /** Filtro por identidad de cliente, compartido por las 4 pestañas. */
  readonly search = signal('');
  readonly clientSearchIndex = signal<Map<string, StaffUser>>(new Map());

  readonly walletRowsView = computed(() => this.filterByClientIdentity(this.walletRows(), this.search()));
  readonly bankRowsView = computed(() => this.filterByClientIdentity(this.bankRows(), this.search()));
  readonly txRowsView = computed(() => this.filterByClientIdentity(this.txRows(), this.search()));
  readonly kycRowsView = computed(() => this.filterByClientIdentity(this.kycRows(), this.search()));

  /** Pestañas ya cargadas (para no repetir la petición al volver a entrar). */
  private readonly loadedTabs = new Set<TabKey>();

  // ---- Diálogo de cambio de estado ----
  readonly dialog = signal<DialogRow | null>(null);
  readonly dialogVisible = signal(false);
  readonly busy = signal(false);
  txTarget: SettableTransactionState | '' = '';

  readonly txStateOptions: readonly { label: string; value: SettableTransactionState }[] = [
    { label: 'Payment received', value: 'payment_received' },
    { label: 'In progress', value: 'in_progress' },
    { label: 'Completed', value: 'completed' },
  ];

  constructor() {
    void this.loadClientSearchIndex();
    this.ensureLoaded(this.activeTab());
  }

  private buildTabs(): ApprovalTab[] {
    const tabs: ApprovalTab[] = [];
    if (this.auth.hasAnyRole(STAFF_PERMISSIONS.clientFinancials)) {
      tabs.push({ key: 'wallets', label: 'Wallets', icon: 'pi pi-wallet' });
      tabs.push({ key: 'bank-accounts', label: 'Bank accounts', icon: 'pi pi-building-columns' });
      tabs.push({ key: 'transactions', label: 'Transactions', icon: 'pi pi-sync' });
    }
    if (this.auth.hasAnyRole(STAFF_PERMISSIONS.kycReview)) {
      tabs.push({ key: 'kyc', label: 'KYC', icon: 'pi pi-verified' });
    }
    return tabs;
  }

  onTabChange(key: string | number | undefined): void {
    const tab = (key as TabKey) ?? this.tabs[0]?.key ?? 'wallets';
    this.activeTab.set(tab);
    this.ensureLoaded(tab);
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }
  clearSearch(): void {
    this.search.set('');
  }

  private async loadClientSearchIndex(): Promise<void> {
    try {
      const res = await this.api.listClients();
      this.clientSearchIndex.set(new Map((res.users ?? []).map((client) => [client.id, client])));
    } catch {
      this.clientSearchIndex.set(new Map());
    }
  }

  /** Filtra pendientes por email o por nombre/apellido del cliente cuando está disponible. */
  private filterByClientIdentity<T extends { client: { id: string; email: string } }>(rows: T[], q: string): T[] {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => {
      const indexedClient = this.clientSearchIndex().get(r.client.id);
      const searchableClient = indexedClient ? { ...indexedClient, email: r.client.email } : { email: r.client.email };
      return matchesClientIdentity(searchableClient, term);
    });
  }

  private ensureLoaded(key: TabKey): void {
    if (this.loadedTabs.has(key)) return;
    switch (key) {
      case 'wallets':
        this.loadWallets();
        break;
      case 'bank-accounts':
        this.loadBank();
        break;
      case 'transactions':
        this.loadTransactions();
        break;
      case 'kyc':
        this.loadKyc();
        break;
    }
  }

  // ---- Loaders (lista completa) ----

  loadWallets(): void {
    this.walletLoading.set(true);
    this.api
      .listPendingWallets()
      .then((r) => {
        this.walletRows.set(r.items ?? []);
        this.loadedTabs.add('wallets');
      })
      .catch((err) => this.toast('error', 'Could not load wallets', this.errorOf(err)))
      .finally(() => this.walletLoading.set(false));
  }

  loadBank(): void {
    this.bankLoading.set(true);
    this.api
      .listPendingBankAccounts()
      .then((r) => {
        this.bankRows.set(r.items ?? []);
        this.loadedTabs.add('bank-accounts');
      })
      .catch((err) => this.toast('error', 'Could not load bank accounts', this.errorOf(err)))
      .finally(() => this.bankLoading.set(false));
  }

  loadTransactions(): void {
    this.txLoading.set(true);
    this.api
      .listPendingTransactions()
      .then((r) => {
        this.txRows.set(r.items ?? []);
        this.loadedTabs.add('transactions');
      })
      .catch((err) => this.toast('error', 'Could not load transactions', this.errorOf(err)))
      .finally(() => this.txLoading.set(false));
  }

  loadKyc(): void {
    this.kycLoading.set(true);
    this.api
      .listPendingKyc()
      .then((r) => {
        this.kycRows.set(r.items ?? []);
        this.loadedTabs.add('kyc');
      })
      .catch((err) => this.toast('error', 'Could not load KYC', this.errorOf(err)))
      .finally(() => this.kycLoading.set(false));
  }

  // ---- Apertura del diálogo ----

  openWallet(w: PendingWallet): void {
    this.dialog.set({ type: 'wallet', data: w });
    this.dialogVisible.set(true);
  }
  openBank(b: PendingBankAccount): void {
    this.dialog.set({ type: 'bank', data: b });
    this.dialogVisible.set(true);
  }
  openTransaction(t: PendingTransaction): void {
    this.txTarget = '';
    this.dialog.set({ type: 'transaction', data: t });
    this.dialogVisible.set(true);
  }
  openKyc(k: PendingKyc): void {
    this.dialog.set({ type: 'kyc', data: k });
    this.dialogVisible.set(true);
  }

  async openClient(row: DialogRow['data']): Promise<void> {
    if (!row.client?.id) return;
    this.dialogVisible.set(false);
    await this.router.navigate(['/clients'], { queryParams: { client: row.client.id } });
  }

  // ---- Acciones ----

  verifyWallet(w: PendingWallet): void {
    void this.confirmApprovalWithRequirementCheck({
      header: 'Verify wallet',
      baseMessage: `Verify the wallet ${this.shortAddr(w.publicAddress)}?`,
      checkRequirements: () => this.requirementWarnings.forWalletClient(w.client.id),
      action: () => this.api.verifyWallet(w.id),
      summary: 'Wallet verified',
      reload: () => this.loadWallets(),
    });
  }
  blockWallet(w: PendingWallet): void {
    this.confirmRun('Block wallet', `Block the wallet ${this.shortAddr(w.publicAddress)}?`, true, () => this.api.blockWallet(w.id), 'Wallet blocked', () => this.loadWallets());
  }
  verifyBank(b: PendingBankAccount): void {
    void this.confirmApprovalWithRequirementCheck({
      header: 'Verify bank account',
      baseMessage: `Verify the account ${b.iban}?`,
      checkRequirements: () => this.requirementWarnings.forBankAccount(b.id),
      action: () => this.api.verifyClientBankAccount(b.id),
      summary: 'Bank account verified',
      reload: () => this.loadBank(),
    });
  }
  blockBank(b: PendingBankAccount): void {
    this.confirmRun('Block bank account', `Block the account ${b.iban}?`, true, () => this.api.blockClientBankAccount(b.id), 'Bank account blocked', () => this.loadBank());
  }
  setTxState(t: PendingTransaction): void {
    if (!this.txTarget) return;
    const target = this.txTarget;
    void this.confirmApprovalWithRequirementCheck({
      header: 'Update transaction',
      baseMessage: `Set the transaction to "${this.prettyState(target)}"?`,
      checkRequirements: () => this.requirementWarnings.forTransaction(t.id),
      action: () => this.api.updateTransactionState(t.id, target),
      summary: 'Transaction updated',
      reload: () => this.loadTransactions(),
    });
  }
  verifyKyc(k: PendingKyc): void {
    this.confirmRun('Verify KYC', `Approve the KYC of ${k.client.email}?`, false, () => this.api.verifyKyc(k.client.id), 'KYC verified', () => this.loadKyc());
  }
  syncKyc(k: PendingKyc): void {
    this.confirmRun('Sync KYC', `Re-sync KYCAID data for ${k.client.email}?`, false, () => this.api.syncKyc(k.client.id), 'KYC synced', () => this.loadKyc());
  }
  restrictKyc(k: PendingKyc): void {
    this.confirmRun('Restrict KYC', `Set the KYC of ${k.client.email} to restricted?`, true, () => this.api.restrictKyc(k.client.id), 'KYC restricted', () => this.loadKyc());
  }
  resetKyc(k: PendingKyc): void {
    this.confirmRun('Reset KYC', `Reset the KYC of ${k.client.email}? Documents will be deleted and the client must verify again.`, true, () => this.api.resetKyc(k.client.id), 'KYC reset', () => this.loadKyc());
  }

  // ---- Runner ----

  private async confirmApprovalWithRequirementCheck(config: ApprovalRequirementCheck): Promise<void> {
    this.busy.set(true);
    let requirementWarning: string | null = null;
    try {
      requirementWarning = await config.checkRequirements();
    } finally {
      this.busy.set(false);
    }

    this.confirmRun(
      config.header,
      requirementWarning ? `${config.baseMessage} ${requirementWarning}` : config.baseMessage,
      false,
      config.action,
      config.summary,
      config.reload,
      requirementWarning ? { icon: 'pi pi-exclamation-triangle', acceptLabel: 'Continue' } : undefined,
    );
  }

  private confirmRun(
    header: string,
    message: string,
    danger: boolean,
    action: () => Promise<{ ok: boolean; message: string }>,
    summary: string,
    reload: () => void,
    options?: ConfirmRunOptions,
  ): void {
    this.confirm.confirm({
      header,
      message,
      icon: options?.icon ?? (danger ? 'pi pi-exclamation-triangle' : 'pi pi-check-circle'),
      acceptLabel: options?.acceptLabel ?? 'Confirm',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: danger ? 'p-button-danger' : undefined,
      rejectButtonStyleClass: 'p-button-text',
      accept: () => {
        this.busy.set(true);
        action()
          .then((res) => {
            this.toast('success', summary, res.message ?? 'Done.');
            this.dialogVisible.set(false);
            reload();
          })
          .catch((err) => this.toast('error', 'Action failed', this.errorOf(err)))
          .finally(() => this.busy.set(false));
      },
    });
  }

  // ---- helpers de presentación ----

  dialogTitle(): string {
    const d = this.dialog();
    if (!d) return '';
    switch (d.type) {
      case 'wallet':
        return `Wallet · ${d.data.client.email}`;
      case 'bank':
        return `Bank account · ${d.data.client.email}`;
      case 'transaction':
        return `Transaction · ${d.data.client.email}`;
      case 'kyc':
        return `KYC · ${d.data.client.email}`;
    }
  }

  blockchainName(w: PendingWallet): string {
    return w.blockchain && typeof w.blockchain === 'object' ? (w.blockchain.name ?? '—') : '—';
  }
  shortAddr(value?: string): string {
    if (!value) return '—';
    return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
  }
  shortId(value?: string): string {
    return value ? `#${value.slice(0, 8).toUpperCase()}` : '—';
  }
  formatFiatAmount(value?: string): string {
    return formatFiatAmount(value, '—');
  }
  formatCryptoAmount(value?: string): string {
    return formatCryptoAmount(value, '—');
  }
  prettyState(state?: string): string {
    if (!state) return '—';
    return state.charAt(0).toUpperCase() + state.slice(1).replace(/_/g, ' ');
  }
  resourceStateBadge(state?: string): string {
    switch (state) {
      case 'verified':
      case 'completed':
        return 'cf-badge cf-badge--success';
      case 'blocked':
      case 'restricted':
        return 'cf-badge cf-badge--danger';
      case 'payment_received':
      case 'in_progress':
      case 'send':
      case 'under_review':
        return 'cf-badge cf-badge--warning';
      case 'pending':
        return 'cf-badge cf-badge--info';
      default:
        return 'cf-badge cf-badge--neutral';
    }
  }
  formatDate(value?: string): string {
    if (!value) return '-';
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date.toLocaleString();
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
