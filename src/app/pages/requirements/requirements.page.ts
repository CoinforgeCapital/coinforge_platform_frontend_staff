import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';

import {
  ApiService,
  ClientBankAccount,
  ClientTransaction,
  Requirement,
  RequirementArchivedDocument,
  RequirementDocumentType,
  RequirementFile,
  RequirementState,
  StaffUser,
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { STAFF_PERMISSIONS } from '../../core/staff-permissions';
import { UserAutocompleteComponent } from '../../shared/user-autocomplete/user-autocomplete.component';
import { formatCryptoAmount, formatFiatAmount } from '../../shared/amount-format';

type View = 'list' | 'detail' | 'create';

interface DocTypeOption {
  label: string;
  value: RequirementDocumentType;
}

/** Todos los tipos de documento son creables; los dos vinculados piden un recurso. */
const ALL_DOC_TYPES: readonly DocTypeOption[] = [
  { label: 'KYC', value: 'kyc' },
  { label: 'Legal declaration', value: 'legal_declaration' },
  { label: 'Source of funds', value: 'source_of_funds' },
  { label: 'Source of wealth', value: 'source_of_wealth' },
  { label: 'Other', value: 'other' },
  { label: 'Transaction evidence', value: 'additional_evidence_transaction' },
  { label: 'Bank account', value: 'client_bank' },
];

const DOC_TYPE_LABELS: Record<string, string> = {
  additional_evidence_transaction: 'Transaction evidence',
  client_bank: 'Bank account',
  kyc: 'KYC',
  legal_declaration: 'Legal declaration',
  source_of_funds: 'Source of funds',
  source_of_wealth: 'Source of wealth',
  other: 'Other',
};

interface StateTab {
  key: RequirementState;
  label: string;
  icon: string;
}

/** Una pestaña por estado para filtrar fácilmente. */
const STATE_TABS: readonly StateTab[] = [
  { key: 'pending', label: 'Pending', icon: 'pi pi-clock' },
  { key: 'under_review', label: 'Under review', icon: 'pi pi-hourglass' },
  { key: 'approved', label: 'Approved', icon: 'pi pi-check-circle' },
  { key: 'cancelled', label: 'Cancelled', icon: 'pi pi-ban' },
];

@Component({
  selector: 'app-requirements-page',
  standalone: true,
  imports: [ReactiveFormsModule, TableModule, UserAutocompleteComponent],
  templateUrl: './requirements.page.html',
  styleUrl: './requirements.page.css',
})
export class RequirementsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Crear/editar/aprobar/rechazar/cancelar: solo compliance / compliance officer. */
  readonly canWrite = this.auth.hasAnyRole(STAFF_PERMISSIONS.requirementsWrite);
  readonly docTypeOptions = ALL_DOC_TYPES;
  readonly tabs = STATE_TABS;
  readonly activeTab = signal<RequirementState>('pending');

  readonly requirements = signal<Requirement[]>([]);
  readonly loading = signal(false);
  readonly view = signal<View>('list');
  readonly selectedId = signal<string | null>(null);

  readonly editing = signal(false);
  readonly createLoading = signal(false);
  readonly savingEdit = signal(false);
  readonly actionBusyId = signal<string | null>(null);
  readonly downloading = signal<string | null>(null);
  readonly viewing = signal<string | null>(null);
  readonly archivedDocuments = signal<RequirementArchivedDocument[]>([]);
  readonly archivedLoading = signal(false);
  readonly archivedError = signal('');
  readonly archivedRequirementId = signal<string | null>(null);

  readonly createFiles = signal<File[]>([]);
  readonly editFiles = signal<File[]>([]);
  readonly editDeleteFileIds = signal<string[]>([]);

  // ---- Estado de la creación con recurso vinculado (cuenta bancaria / transacción) ----
  readonly createClient = signal<StaffUser | null>(null);
  readonly createDocType = signal<RequirementDocumentType | ''>('');
  readonly bankAccounts = signal<ClientBankAccount[]>([]);
  readonly transactions = signal<ClientTransaction[]>([]);
  readonly loadingResources = signal(false);
  readonly selectedBank = signal<ClientBankAccount | null>(null);
  readonly selectedTx = signal<ClientTransaction | null>(null);

  readonly requiresBank = computed(() => this.createDocType() === 'client_bank');
  readonly requiresTx = computed(() => this.createDocType() === 'additional_evidence_transaction');

  readonly createForm = this.fb.nonNullable.group({
    customerUserId: ['', [Validators.required]],
    name: ['', [Validators.required, Validators.maxLength(350)]],
    description: ['', [Validators.required, Validators.maxLength(10000)]],
    documentType: ['' as RequirementDocumentType | '', [Validators.required]],
  });

  readonly editForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(350)]],
    description: ['', [Validators.required, Validators.maxLength(10000)]],
  });

  readonly list = computed(() =>
    [...this.requirements()].sort((a, b) => this.time(b.createdAt) - this.time(a.createdAt)),
  );

  readonly filteredList = computed(() => this.list().filter((r) => r.state === this.activeTab()));

  readonly selected = computed<Requirement | null>(() => {
    const id = this.selectedId();
    return id ? this.requirements().find((r) => r.id === id) ?? null : null;
  });

  get createCustomer() {
    return this.createForm.controls.customerUserId;
  }
  get createName() {
    return this.createForm.controls.name;
  }
  get createDescription() {
    return this.createForm.controls.description;
  }
  get createDocTypeCtrl() {
    return this.createForm.controls.documentType;
  }
  get editName() {
    return this.editForm.controls.name;
  }
  get editDescription() {
    return this.editForm.controls.description;
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(showLoading = true): Promise<void> {
    if (showLoading) this.loading.set(true);
    try {
      const res = await this.api.listRequirements();
      this.requirements.set(res.requirements ?? []);

      const id = this.selectedId();
      if (id && !this.requirements().some((r) => r.id === id)) {
        this.selectedId.set(null);
        if (this.view() === 'detail') this.view.set('list');
      }
    } catch {
      /* el interceptor ya muestra el aviso */
    } finally {
      this.loading.set(false);
    }
  }

  showList(): void {
    this.view.set('list');
  }

  setTab(key: RequirementState): void {
    this.activeTab.set(key);
  }

  tabCount(key: RequirementState): number {
    return this.list().filter((r) => r.state === key).length;
  }

  showCreate(): void {
    this.createForm.reset({ customerUserId: '', name: '', description: '', documentType: '' });
    this.createFiles.set([]);
    this.createClient.set(null);
    this.createDocType.set('');
    this.clearResources();
    this.view.set('create');
  }

  openDetail(requirement: Requirement): void {
    this.selectedId.set(requirement.id);
    this.editing.set(false);
    this.view.set('detail');
    this.prepareArchivedDocuments(requirement);
  }

  back(): void {
    this.selectedId.set(null);
    this.editing.set(false);
    this.view.set('list');
    this.clearArchivedDocuments();
  }

  async openClient(requirement: Requirement): Promise<void> {
    const clientId = requirement.customerUser?.id;
    if (!clientId) return;
    await this.router.navigate(['/clients'], { queryParams: { client: clientId } });
  }

  // ---- Creación ----

  onClientPicked(user: StaffUser): void {
    this.createClient.set(user);
    this.createForm.controls.customerUserId.setValue(user.id);
    this.createForm.controls.customerUserId.markAsTouched();
    this.refreshResources();
  }

  onDocTypeChange(event: Event): void {
    this.createDocType.set((event.target as HTMLSelectElement).value as RequirementDocumentType | '');
    this.refreshResources();
  }

  private refreshResources(): void {
    this.clearResources();
    const client = this.createClient();
    if (!client) return;
    if (this.requiresBank()) void this.loadBankAccounts(client.id);
    else if (this.requiresTx()) void this.loadTransactions(client.id);
  }

  private clearResources(): void {
    this.bankAccounts.set([]);
    this.transactions.set([]);
    this.selectedBank.set(null);
    this.selectedTx.set(null);
  }

  private async loadBankAccounts(clientId: string): Promise<void> {
    this.loadingResources.set(true);
    try {
      const res = await this.api.listClientBankAccountsByStaff(clientId);
      this.bankAccounts.set(res.bankAccounts ?? []);
    } catch (err: unknown) {
      this.toast('error', 'Could not load bank accounts', this.errorOf(err));
    } finally {
      this.loadingResources.set(false);
    }
  }

  private async loadTransactions(clientId: string): Promise<void> {
    this.loadingResources.set(true);
    try {
      const res = await this.api.listClientTransactionsByStaff(clientId);
      this.transactions.set(res.transactions ?? []);
    } catch (err: unknown) {
      this.toast('error', 'Could not load transactions', this.errorOf(err));
    } finally {
      this.loadingResources.set(false);
    }
  }

  onPickBank(account: ClientBankAccount): void {
    this.confirm.confirm({
      header: 'Link bank account',
      message: `Link this requirement to account ${account.iban}?`,
      icon: 'pi pi-building-columns',
      acceptLabel: 'Link',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => this.selectedBank.set(account),
    });
  }

  onPickTransaction(tx: ClientTransaction): void {
    this.confirm.confirm({
      header: 'Link transaction',
      message: `Link this requirement to transaction ${this.txShort(tx)}?`,
      icon: 'pi pi-sync',
      acceptLabel: 'Link',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => this.selectedTx.set(tx),
    });
  }

  clearBankSelection(): void {
    this.selectedBank.set(null);
  }

  clearTxSelection(): void {
    this.selectedTx.set(null);
  }

  onCreateFile(event: Event): void {
    this.createFiles.set(Array.from((event.target as HTMLInputElement).files ?? []));
  }

  onEditFile(event: Event): void {
    this.editFiles.set(Array.from((event.target as HTMLInputElement).files ?? []));
  }

  async onCreate(): Promise<void> {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    const value = this.createForm.getRawValue();
    const documentType = value.documentType as RequirementDocumentType;

    if (documentType === 'client_bank' && !this.selectedBank()) {
      this.toast('error', 'Bank account required', 'Select the client bank account to link.');
      return;
    }
    if (documentType === 'additional_evidence_transaction' && !this.selectedTx()) {
      this.toast('error', 'Transaction required', 'Select the client transaction to link.');
      return;
    }

    this.createLoading.set(true);
    try {
      const res = await this.api.createRequirement({
        customerUserId: value.customerUserId,
        name: value.name.trim(),
        description: value.description.trim(),
        documentType,
        clientBankId: documentType === 'client_bank' ? this.selectedBank()?.id : undefined,
        transactionOrderId:
          documentType === 'additional_evidence_transaction' ? this.selectedTx()?.id : undefined,
        files: this.createFiles(),
      });
      await this.load(false);
      this.view.set('list');
      this.toast('success', 'Requirement created', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not create', this.errorOf(err));
    } finally {
      this.createLoading.set(false);
    }
  }

  // ---- Edición / acciones ----

  startEdit(): void {
    const requirement = this.selected();
    if (!requirement) return;
    this.editForm.reset({ name: requirement.name, description: requirement.description ?? '' });
    this.editFiles.set([]);
    this.editDeleteFileIds.set([]);
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editDeleteFileIds.set([]);
    this.editFiles.set([]);
    this.editing.set(false);
  }

  toggleEditFileRemoval(file: RequirementFile): void {
    const current = this.editDeleteFileIds();
    this.editDeleteFileIds.set(
      current.includes(file.id)
        ? current.filter((id) => id !== file.id)
        : [...current, file.id],
    );
  }

  isEditFileMarkedForRemoval(file: RequirementFile): boolean {
    return this.editDeleteFileIds().includes(file.id);
  }

  async onSaveEdit(): Promise<void> {
    const requirement = this.selected();
    if (!requirement || this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }
    const value = this.editForm.getRawValue();
    this.savingEdit.set(true);
    try {
      const res = await this.api.updateRequirement(requirement.id, {
        name: value.name.trim(),
        description: value.description.trim(),
        files: this.editFiles(),
        deleteFileIds: this.editDeleteFileIds(),
      });
      this.editing.set(false);
      this.editDeleteFileIds.set([]);
      this.editFiles.set([]);
      await this.load(false);
      this.toast('success', 'Requirement updated', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not update', this.errorOf(err));
    } finally {
      this.savingEdit.set(false);
    }
  }

  onApprove(requirement: Requirement): void {
    this.confirm.confirm({
      header: 'Approve requirement',
      message: `Approve "${requirement.name}"? The client's submitted files will be archived and the requirement closed.`,
      icon: 'pi pi-check-circle',
      acceptLabel: 'Approve',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => void this.runAction(requirement.id, () => this.api.closeRequirement(requirement.id), 'Requirement approved'),
    });
  }

  onReject(requirement: Requirement): void {
    this.confirm.confirm({
      header: 'Reject files',
      message: `Reject the files for "${requirement.name}"? The client's uploads will be removed and they'll be asked to upload again.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Reject',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => void this.runAction(requirement.id, () => this.api.rejectRequirement(requirement.id), 'Files rejected'),
    });
  }

  onCancel(requirement: Requirement): void {
    this.confirm.confirm({
      header: 'Cancel requirement',
      message: `Cancel "${requirement.name}"? It becomes read-only and its files are removed. This cannot be undone.`,
      icon: 'pi pi-ban',
      acceptLabel: 'Cancel requirement',
      rejectLabel: 'Keep',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => void this.runAction(requirement.id, () => this.api.cancelRequirement(requirement.id), 'Requirement cancelled'),
    });
  }

  private async runAction(
    id: string,
    action: () => Promise<{ ok: boolean; message: string }>,
    successSummary: string,
  ): Promise<void> {
    this.actionBusyId.set(id);
    try {
      const res = await action();
      await this.load(false);
      const current = this.selected();
      if (this.view() === 'detail' && current?.id === id) {
        this.prepareArchivedDocuments(current);
      }
      this.toast('success', successSummary, res.message);
    } catch (err: unknown) {
      this.toast('error', 'Action failed', this.errorOf(err));
    } finally {
      this.actionBusyId.set(null);
    }
  }

  async viewFile(file: RequirementFile): Promise<void> {
    const tab = window.open('', '_blank');
    this.viewing.set(file.id);
    try {
      const blob = await this.api.viewRequirementFile(file.id);
      this.openBlob(blob, tab);
    } catch (err: unknown) {
      tab?.close();
      this.toast('error', 'Could not open', this.errorOf(err));
    } finally {
      this.viewing.set(null);
    }
  }

  async download(file: RequirementFile): Promise<void> {
    this.downloading.set(file.id);
    try {
      const blob = await this.api.downloadRequirementFile(file.id);
      this.saveBlob(blob, file.name || 'requirement-file');
    } catch (err: unknown) {
      this.toast('error', 'Could not download', this.errorOf(err));
    } finally {
      this.downloading.set(null);
    }
  }

  async viewArchivedDocument(document: RequirementArchivedDocument): Promise<void> {
    const tab = window.open('', '_blank');
    this.viewing.set(document.id);
    try {
      const blob = await this.api.viewClientDocument(document.documentType, document.id);
      this.openBlob(blob, tab);
    } catch (err: unknown) {
      tab?.close();
      this.toast('error', 'Could not open document', this.errorOf(err));
    } finally {
      this.viewing.set(null);
    }
  }

  async downloadArchivedDocument(document: RequirementArchivedDocument): Promise<void> {
    this.downloading.set(document.id);
    try {
      const blob = await this.api.downloadClientDocument(document.documentType, document.id);
      this.saveBlob(blob, document.name || 'requirement-document');
    } catch (err: unknown) {
      this.toast('error', 'Could not download document', this.errorOf(err));
    } finally {
      this.downloading.set(null);
    }
  }

  private prepareArchivedDocuments(requirement: Requirement): void {
    if (requirement.state !== 'approved') {
      this.clearArchivedDocuments();
      return;
    }
    void this.loadArchivedDocuments(requirement.id);
  }

  private async loadArchivedDocuments(requirementId: string): Promise<void> {
    this.archivedRequirementId.set(requirementId);
    this.archivedLoading.set(true);
    this.archivedError.set('');
    try {
      const res = await this.api.getRequirementDocuments(requirementId);
      if (this.archivedRequirementId() === requirementId) {
        this.archivedDocuments.set(res.documents ?? []);
      }
    } catch (err: unknown) {
      if (this.archivedRequirementId() === requirementId) {
        this.archivedDocuments.set([]);
        this.archivedError.set(this.errorOf(err));
      }
    } finally {
      if (this.archivedRequirementId() === requirementId) {
        this.archivedLoading.set(false);
      }
    }
  }

  private clearArchivedDocuments(): void {
    this.archivedRequirementId.set(null);
    this.archivedDocuments.set([]);
    this.archivedError.set('');
    this.archivedLoading.set(false);
  }

  // ---- reglas / helpers ----

  canEdit(r: Requirement): boolean {
    return this.canWrite && r.state === 'pending';
  }
  canReview(r: Requirement): boolean {
    return this.canWrite && r.state === 'under_review';
  }
  canCancel(r: Requirement): boolean {
    return this.canWrite && (r.state === 'pending' || r.state === 'under_review');
  }
  canDownloadTemplate(r: Requirement): boolean {
    return this.templateFiles(r).length > 0 && r.state !== 'approved' && r.state !== 'cancelled';
  }
  canDownloadClientFile(r: Requirement): boolean {
    return this.clientFiles(r).length > 0 && r.state !== 'approved' && r.state !== 'cancelled';
  }
  canUseStagingFiles(r: Requirement): boolean {
    return r.state !== 'approved' && r.state !== 'cancelled';
  }
  templateFiles(r: Requirement): RequirementFile[] {
    return r.templateFiles ?? [];
  }
  clientFiles(r: Requirement): RequirementFile[] {
    return r.clientFiles ?? [];
  }
  fileNames(files: File[]): string {
    if (files.length === 0) return 'Attach template files (optional)';
    if (files.length === 1) return files[0].name;
    return `${files.length} files selected`;
  }
  editFileNames(files: File[]): string {
    if (files.length === 0) return 'Add template files (optional)';
    if (files.length === 1) return files[0].name;
    return `${files.length} files selected`;
  }

  clientLabel(r: Requirement): string {
    return r.customerUser?.email || '—';
  }
  staffLabel(r: Requirement): string {
    return r.staffUser?.email || '—';
  }
  closedByLabel(r: Requirement): string {
    return r.closedBy?.email || '—';
  }
  docTypeLabel(type?: string): string {
    return DOC_TYPE_LABELS[type ?? ''] ?? (type ?? '—');
  }
  stateLabel(state?: string): string {
    switch (state) {
      case 'under_review':
        return 'Under review';
      case 'approved':
        return 'Approved';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Pending';
    }
  }
  stateBadgeClass(state?: string): string {
    switch (state) {
      case 'approved':
        return 'cf-badge cf-badge--success';
      case 'under_review':
        return 'cf-badge cf-badge--warning';
      case 'cancelled':
        return 'cf-badge cf-badge--neutral';
      default:
        return 'cf-badge cf-badge--info';
    }
  }
  shortId(r: Requirement): string {
    return `#${r.id.slice(0, 8).toUpperCase()}`;
  }

  // Helpers para las tablas de recursos
  txShort(tx: ClientTransaction): string {
    return `#${tx.id.slice(0, 8).toUpperCase()}`;
  }
  prettyState(state?: string): string {
    if (!state) return '—';
    return state.charAt(0).toUpperCase() + state.slice(1).replace(/_/g, ' ');
  }
  formatFiatAmount(value?: string): string {
    return formatFiatAmount(value, '—');
  }
  formatCryptoAmount(value?: string): string {
    return formatCryptoAmount(value, '—');
  }

  formatDate(value?: string | Date | null): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  private time(value?: string | Date | null): number {
    if (!value) return 0;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private openBlob(blob: Blob, tab: Window | null): void {
    if (!this.canPreviewBlob(blob)) {
      throw new Error('This file type cannot be previewed. Use Download instead.');
    }

    const url = URL.createObjectURL(blob);
    if (tab) {
      tab.location.href = url;
    } else {
      URL.revokeObjectURL(url);
      throw new Error('The browser blocked the preview window. Allow pop-ups and try again.');
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  private canPreviewBlob(blob: Blob): boolean {
    const mimeType = blob.type.toLowerCase().split(';', 1)[0];
    return (
      mimeType === 'application/pdf' ||
      mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('text/')
    );
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
