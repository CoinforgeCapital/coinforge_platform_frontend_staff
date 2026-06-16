import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { STAFF_PERMISSIONS } from '../../core/staff-permissions';

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

/**
 * Cola de pendientes de aprobación acotada a UN cliente, embebida en el detalle de cliente.
 *
 * Reutiliza exactamente los mismos endpoints y acciones que la página `Pending approvals`
 * (wallets/cuentas/transacciones/KYC), pero filtrando cada listado por `client.id`. Como los
 * endpoints ya acotan por rol en el backend (CO/operator/admin = todos; compliance = asignados),
 * el filtrado por cliente conserva los mismos permisos sin tocar el backend: un compliance que
 * no tenga asignado a este cliente verá las pestañas vacías.
 */
@Component({
  selector: 'app-client-pending-approvals',
  standalone: true,
  imports: [FormsModule, TableModule, TabsModule, DialogModule],
  templateUrl: './client-pending-approvals.component.html',
  styleUrl: './client-pending-approvals.component.css',
})
export class ClientPendingApprovalsComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  /** Cliente cuyos pendientes se muestran. */
  readonly clientId = input.required<string>();
  readonly clientEmail = input<string>('');

  // ---- Permisos (espejo del backend; idénticos a la página Pending approvals) ----
  readonly canChangeTxState = this.auth.hasAnyRole(STAFF_PERMISSIONS.transactionStateChange);
  readonly canKyc = this.auth.hasAnyRole(STAFF_PERMISSIONS.kycReview);

  readonly tabs: ApprovalTab[] = this.buildTabs();
  readonly activeTab = signal<TabKey>(this.tabs[0]?.key ?? 'wallets');

  // ---- Datos por pestaña (ya filtrados por cliente) ----
  readonly walletRows = signal<PendingWallet[]>([]);
  readonly walletLoading = signal(false);

  readonly bankRows = signal<PendingBankAccount[]>([]);
  readonly bankLoading = signal(false);

  readonly txRows = signal<PendingTransaction[]>([]);
  readonly txLoading = signal(false);

  readonly kycRows = signal<PendingKyc[]>([]);
  readonly kycLoading = signal(false);

  /** Pestañas ya cargadas para el cliente actual (para no repetir la petición). */
  private readonly loadedTabs = new Set<TabKey>();
  /** id del cliente ya cargado: el effect solo recarga cuando cambia de verdad (evita bucles). */
  private loadedForId: string | null = null;

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
    // Al fijarse o cambiar el cliente, reinicia el estado y carga la pestaña activa.
    effect(() => {
      const id = this.clientId();
      if (!id || id === this.loadedForId) return;
      this.loadedForId = id;
      this.loadedTabs.clear();
      this.walletRows.set([]);
      this.bankRows.set([]);
      this.txRows.set([]);
      this.kycRows.set([]);
      this.ensureLoaded(this.activeTab());
    });
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

  // ---- Loaders (lista cross-cliente del backend, filtrada por este cliente) ----

  loadWallets(): void {
    this.walletLoading.set(true);
    this.api
      .listPendingWallets()
      .then((r) => {
        this.walletRows.set(this.forClient(r.items));
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
        this.bankRows.set(this.forClient(r.items));
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
        this.txRows.set(this.forClient(r.items));
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
        this.kycRows.set(this.forClient(r.items));
        this.loadedTabs.add('kyc');
      })
      .catch((err) => this.toast('error', 'Could not load KYC', this.errorOf(err)))
      .finally(() => this.kycLoading.set(false));
  }

  /** Filtra un listado cross-cliente dejando solo los pendientes de ESTE cliente. */
  private forClient<T extends { client: { id: string } }>(items: T[] | undefined): T[] {
    const id = this.clientId();
    return (items ?? []).filter((it) => it.client.id === id);
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

  // ---- Acciones (mismas que la página Pending approvals) ----

  verifyWallet(w: PendingWallet): void {
    this.confirmRun('Verify wallet', `Verify the wallet ${this.shortAddr(w.publicAddress)}?`, false, () => this.api.verifyWallet(w.id), 'Wallet verified', () => this.loadWallets());
  }
  blockWallet(w: PendingWallet): void {
    this.confirmRun('Block wallet', `Block the wallet ${this.shortAddr(w.publicAddress)}?`, true, () => this.api.blockWallet(w.id), 'Wallet blocked', () => this.loadWallets());
  }
  verifyBank(b: PendingBankAccount): void {
    this.confirmRun('Verify bank account', `Verify the account ${b.iban}?`, false, () => this.api.verifyClientBankAccount(b.id), 'Bank account verified', () => this.loadBank());
  }
  blockBank(b: PendingBankAccount): void {
    this.confirmRun('Block bank account', `Block the account ${b.iban}?`, true, () => this.api.blockClientBankAccount(b.id), 'Bank account blocked', () => this.loadBank());
  }
  setTxState(t: PendingTransaction): void {
    if (!this.txTarget) return;
    const target = this.txTarget;
    this.confirmRun('Update transaction', `Set the transaction to "${this.prettyState(target)}"?`, false, () => this.api.updateTransactionState(t.id, target), 'Transaction updated', () => this.loadTransactions());
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

  private confirmRun(
    header: string,
    message: string,
    danger: boolean,
    action: () => Promise<{ ok: boolean; message: string }>,
    summary: string,
    reload: () => void,
  ): void {
    this.confirm.confirm({
      header,
      message,
      icon: danger ? 'pi pi-exclamation-triangle' : 'pi pi-check-circle',
      acceptLabel: 'Confirm',
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
  formatAmount(value?: string): string {
    if (!value) return '—';
    const n = Number(value);
    return Number.isNaN(n) ? value : n.toLocaleString(undefined, { maximumFractionDigits: 8 });
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
