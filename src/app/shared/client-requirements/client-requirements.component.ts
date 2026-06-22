import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TableModule } from 'primeng/table';
import { ConfirmationService, MessageService } from 'primeng/api';

import {
  ApiService,
  Requirement,
  RequirementArchivedDocument,
  RequirementFile,
  RequirementState,
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { STAFF_PERMISSIONS } from '../../core/staff-permissions';

/** Agrupación por estado de las tres pestañas del detalle de cliente. */
type RequirementGroup = 'active' | 'completed' | 'cancelled';

interface GroupTab {
  key: RequirementGroup;
  label: string;
  icon: string;
}

const GROUP_TABS: readonly GroupTab[] = [
  { key: 'active', label: 'Active', icon: 'pi pi-clock' },
  { key: 'completed', label: 'Completed', icon: 'pi pi-check-circle' },
  { key: 'cancelled', label: 'Cancelled', icon: 'pi pi-ban' },
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

/**
 * Requirements de UN cliente, embebidos en el detalle de cliente, con tres pestañas:
 * activos (pending + under_review), completados (approved) y cancelados.
 *
 * - Activos: se listan los ficheros staging (plantillas + entregas del cliente), que se
 *   pueden ver/descargar por el endpoint de fichero de requirement.
 * - Completados: el staging se borró al aprobar; los documentos finales viven en las
 *   tablas documentales del cliente y se piden a GET /api/requirement/:id/documents,
 *   descargándose/visualizándose por el endpoint central de documentos.
 * - Cancelados: sin documentos (el staging se eliminó), solo el detalle.
 *
 * Incluye las mismas acciones de estado que la pagina Requirements para que el
 * staff pueda revisar el requirement sin salir del detalle del cliente.
 */
@Component({
  selector: 'app-client-requirements',
  standalone: true,
  imports: [TableModule],
  templateUrl: './client-requirements.component.html',
  styleUrl: './client-requirements.component.css',
})
export class ClientRequirementsComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  /** Requirements del cliente (colección embebida `requirementsCustomer`). */
  readonly requirements = input<Requirement[]>([]);
  readonly requirementChanged = output<Requirement>();

  /** Ver/descargar documentos (GET + file download) — espejo del backend, sin operator. */
  readonly canRead = this.auth.hasAnyRole(STAFF_PERMISSIONS.requirementsRead);
  readonly canWrite = this.auth.hasAnyRole(STAFF_PERMISSIONS.requirementsWrite);

  readonly tabs = GROUP_TABS;
  readonly activeTab = signal<RequirementGroup>('active');
  readonly selectedId = signal<string | null>(null);
  readonly localOverrides = signal<Record<string, Requirement>>({});

  // ---- Documentos finales archivados (solo requirements aprobados) ----
  readonly archivedDocs = signal<RequirementArchivedDocument[]>([]);
  readonly archivedLoading = signal(false);
  readonly archivedError = signal('');

  // ---- Acciones de fichero en vuelo (ids únicos entre staging y documentos finales) ----
  readonly downloadingId = signal<string | null>(null);
  readonly viewingId = signal<string | null>(null);
  readonly editing = signal(false);
  readonly savingEdit = signal(false);
  readonly editName = signal('');
  readonly editDescription = signal('');
  readonly editFiles = signal<File[]>([]);
  readonly editDeleteFileIds = signal<string[]>([]);
  readonly actionBusyId = signal<string | null>(null);

  private readonly mergedRequirements = computed(() => {
    const overrides = this.localOverrides();
    return this.requirements().map((requirement) => overrides[requirement.id] ?? requirement);
  });

  private readonly sorted = computed(() =>
    [...this.mergedRequirements()].sort((a, b) => this.time(b.createdAt) - this.time(a.createdAt)),
  );

  readonly activeList = computed(() =>
    this.sorted().filter((r) => r.state === 'pending' || r.state === 'under_review'),
  );
  readonly completedList = computed(() => this.sorted().filter((r) => r.state === 'approved'));
  readonly cancelledList = computed(() => this.sorted().filter((r) => r.state === 'cancelled'));

  readonly currentList = computed<Requirement[]>(() => {
    switch (this.activeTab()) {
      case 'completed':
        return this.completedList();
      case 'cancelled':
        return this.cancelledList();
      default:
        return this.activeList();
    }
  });

  readonly selected = computed<Requirement | null>(() => {
    const id = this.selectedId();
    return id ? this.mergedRequirements().find((r) => r.id === id) ?? null : null;
  });

  groupCount(key: RequirementGroup): number {
    switch (key) {
      case 'completed':
        return this.completedList().length;
      case 'cancelled':
        return this.cancelledList().length;
      default:
        return this.activeList().length;
    }
  }

  setTab(key: RequirementGroup): void {
    this.activeTab.set(key);
    this.backToList();
  }

  openDetail(requirement: Requirement): void {
    this.cancelEdit();
    this.selectedId.set(requirement.id);
    this.archivedDocs.set([]);
    this.archivedError.set('');
    // Solo los aprobados tienen documentos finales; el resto no necesita la petición.
    if (requirement.state === 'approved') {
      void this.loadArchivedDocuments(requirement.id);
    }
  }

  backToList(): void {
    this.cancelEdit();
    this.selectedId.set(null);
    this.archivedDocs.set([]);
    this.archivedError.set('');
    this.archivedLoading.set(false);
  }

  private async loadArchivedDocuments(requirementId: string): Promise<void> {
    this.archivedLoading.set(true);
    this.archivedError.set('');
    try {
      const res = await this.api.getRequirementDocuments(requirementId);
      // Evita pisar el resultado si el usuario abrió otro requirement mientras tanto.
      if (this.selectedId() !== requirementId) return;
      this.archivedDocs.set(res.documents ?? []);
    } catch (err: unknown) {
      if (this.selectedId() !== requirementId) return;
      this.archivedError.set(this.errorOf(err));
    } finally {
      if (this.selectedId() === requirementId) this.archivedLoading.set(false);
    }
  }

  // ---- Ficheros staging (plantilla + cliente) de un requirement activo ----

  templateFiles(requirement: Requirement | null): RequirementFile[] {
    return this.filesBySide(requirement, 'staff');
  }
  clientFiles(requirement: Requirement | null): RequirementFile[] {
    return this.filesBySide(requirement, 'client');
  }

  canEdit(requirement: Requirement): boolean {
    return this.canWrite && requirement.state === 'pending';
  }

  canReview(requirement: Requirement): boolean {
    return this.canWrite && requirement.state === 'under_review';
  }

  canCancel(requirement: Requirement): boolean {
    return this.canWrite && (requirement.state === 'pending' || requirement.state === 'under_review');
  }

  startEdit(requirement: Requirement): void {
    this.editName.set(requirement.name);
    this.editDescription.set(requirement.description ?? '');
    this.editFiles.set([]);
    this.editDeleteFileIds.set([]);
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.editName.set('');
    this.editDescription.set('');
    this.editFiles.set([]);
    this.editDeleteFileIds.set([]);
  }

  onEditName(event: Event): void {
    this.editName.set((event.target as HTMLInputElement).value);
  }

  onEditDescription(event: Event): void {
    this.editDescription.set((event.target as HTMLTextAreaElement).value);
  }

  onEditFile(event: Event): void {
    this.editFiles.set(Array.from((event.target as HTMLInputElement).files ?? []));
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

  editFileNames(files: File[]): string {
    if (files.length === 0) return 'Add template files (optional)';
    if (files.length === 1) return files[0].name;
    return `${files.length} files selected`;
  }

  async saveEdit(requirement: Requirement): Promise<void> {
    const name = this.editName().trim();
    const description = this.editDescription().trim();

    if (!name || !description) {
      this.messages.add({
        severity: 'error',
        summary: 'Could not update',
        detail: 'Name and description are required.',
        life: 5000,
      });
      return;
    }

    this.savingEdit.set(true);
    try {
      const res = await this.api.updateRequirement(requirement.id, {
        name,
        description,
        files: this.editFiles(),
        deleteFileIds: this.editDeleteFileIds(),
      });
      const updated = res.data ?? {
        ...requirement,
        name,
        description,
        templateFiles: this.templateFiles(requirement).filter(
          (file) => !this.editDeleteFileIds().includes(file.id),
        ),
      };

      this.localOverrides.update((current) => ({
        ...current,
        [requirement.id]: updated,
      }));
      this.requirementChanged.emit(updated);
      this.cancelEdit();
      this.messages.add({
        severity: 'success',
        summary: 'Requirement updated',
        detail: res.message,
        life: 4000,
      });
    } catch (err: unknown) {
      this.messages.add({
        severity: 'error',
        summary: 'Could not update',
        detail: this.errorOf(err),
        life: 6000,
      });
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
      accept: () => void this.runStateAction(
        requirement,
        () => this.api.closeRequirement(requirement.id),
        'Requirement approved',
        () => this.closedFallback(requirement, 'approved'),
      ),
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
      accept: () => void this.runStateAction(
        requirement,
        () => this.api.rejectRequirement(requirement.id),
        'Files rejected',
        () => ({
          ...requirement,
          state: 'pending',
          files: (requirement.files ?? []).filter((file) => file.side === 'staff'),
          clientFiles: [],
        }),
      ),
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
      accept: () => void this.runStateAction(
        requirement,
        () => this.api.cancelRequirement(requirement.id),
        'Requirement cancelled',
        () => this.closedFallback(requirement, 'cancelled'),
      ),
    });
  }

  private async runStateAction(
    requirement: Requirement,
    action: () => Promise<{ ok: boolean; message: string; data?: Requirement }>,
    successSummary: string,
    fallback: () => Requirement,
  ): Promise<void> {
    this.cancelEdit();
    this.actionBusyId.set(requirement.id);
    try {
      const res = await action();
      const updated = res.data ?? fallback();
      this.applyRequirementUpdate(updated);
      if (this.selectedId() === requirement.id) {
        if (updated.state === 'approved') {
          await this.loadArchivedDocuments(updated.id);
        } else {
          this.archivedDocs.set([]);
          this.archivedError.set('');
          this.archivedLoading.set(false);
        }
      }
      this.messages.add({
        severity: 'success',
        summary: successSummary,
        detail: res.message,
        life: 4000,
      });
    } catch (err: unknown) {
      this.messages.add({
        severity: 'error',
        summary: 'Action failed',
        detail: this.errorOf(err),
        life: 6000,
      });
    } finally {
      this.actionBusyId.set(null);
    }
  }

  private applyRequirementUpdate(requirement: Requirement): void {
    this.localOverrides.update((current) => ({
      ...current,
      [requirement.id]: requirement,
    }));
    this.requirementChanged.emit(requirement);
  }

  private closedFallback(requirement: Requirement, state: 'approved' | 'cancelled'): Requirement {
    return {
      ...requirement,
      state,
      closedDate: requirement.closedDate ?? new Date().toISOString(),
      files: [],
      templateFiles: [],
      clientFiles: [],
    };
  }

  private filesBySide(requirement: Requirement | null, side: 'staff' | 'client'): RequirementFile[] {
    if (!requirement) return [];
    // El detalle de cliente entrega la entidad cruda con `files` (cada uno con `side`);
    // la página Requirements entrega templateFiles/clientFiles ya separados. Soportamos ambos.
    const split = side === 'staff' ? requirement.templateFiles : requirement.clientFiles;
    if (Array.isArray(split)) return split;
    return (requirement.files ?? []).filter((file) => file.side === side);
  }

  // ---- Ver / descargar ----

  async viewFile(file: RequirementFile): Promise<void> {
    const tab = window.open('', '_blank');
    this.viewingId.set(file.id);
    try {
      const blob = await this.api.viewRequirementFile(file.id);
      this.openBlobInTab(blob, tab);
    } catch (err: unknown) {
      tab?.close();
      this.toastError(err);
    } finally {
      this.viewingId.set(null);
    }
  }

  async downloadFile(file: RequirementFile): Promise<void> {
    this.downloadingId.set(file.id);
    try {
      const blob = await this.api.downloadRequirementFile(file.id);
      this.saveBlob(blob, file.name || 'requirement-file');
    } catch (err: unknown) {
      this.toastError(err);
    } finally {
      this.downloadingId.set(null);
    }
  }

  async viewDocument(doc: RequirementArchivedDocument): Promise<void> {
    const tab = window.open('', '_blank');
    this.viewingId.set(doc.id);
    try {
      const blob = await this.api.viewClientDocument(doc.documentType, doc.id);
      this.openBlobInTab(blob, tab);
    } catch (err: unknown) {
      tab?.close();
      this.toastError(err);
    } finally {
      this.viewingId.set(null);
    }
  }

  async downloadDocument(doc: RequirementArchivedDocument): Promise<void> {
    this.downloadingId.set(doc.id);
    try {
      const blob = await this.api.downloadClientDocument(doc.documentType, doc.id);
      this.saveBlob(blob, doc.name || 'document');
    } catch (err: unknown) {
      this.toastError(err);
    } finally {
      this.downloadingId.set(null);
    }
  }

  // ---- Presentación ----

  docTypeLabel(type?: string): string {
    return DOC_TYPE_LABELS[type ?? ''] ?? (type ?? '—');
  }
  stateLabel(state?: RequirementState): string {
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
  stateBadgeClass(state?: RequirementState): string {
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
  shortId(requirement: Requirement): string {
    return `#${requirement.id.slice(0, 8).toUpperCase()}`;
  }
  staffLabel(requirement: Requirement): string {
    return requirement.staffUser?.email ?? '—';
  }
  closedByLabel(requirement: Requirement): string {
    return requirement.closedBy?.email ?? '—';
  }
  formatDate(value?: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  // ---- helpers internos ----

  private time(value?: string | null): number {
    if (!value) return 0;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  private openBlobInTab(blob: Blob, tab: Window | null): void {
    // La pestaña se abrió de forma síncrona en el click para no ser bloqueada como pop-up;
    // aquí solo le asignamos la URL del blob. Si el navegador la bloqueó, avisamos sin descargar.
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
    setTimeout(() => URL.revokeObjectURL(url), 60000);
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

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    this.saveBlobFromUrl(url, filename);
    URL.revokeObjectURL(url);
  }

  private saveBlobFromUrl(url: string, filename: string): void {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  }

  private toastError(err: unknown): void {
    this.messages.add({
      severity: 'error',
      summary: 'Document unavailable',
      detail: this.errorOf(err),
      life: 6000,
    });
  }

  /** Mensaje claro por código de estado (la respuesta es un blob, no legible directamente). */
  private errorOf(err: unknown): string {
    const status = (err as { status?: number }).status;
    if (status === 404) return 'This document is no longer available.';
    if (status === 403) return 'You are not allowed to access this document.';
    const e = err as { error?: { message?: unknown }; message?: unknown };
    if (typeof e.error?.message === 'string' && e.error.message.trim()) return e.error.message;
    if (typeof e.message === 'string' && e.message.trim()) return e.message;
    return 'The request could not be completed.';
  }
}
