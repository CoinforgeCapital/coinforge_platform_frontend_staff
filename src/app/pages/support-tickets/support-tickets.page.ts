import { Component, computed, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { PaginatorModule } from 'primeng/paginator';

import {
  ApiService,
  StaffUser,
  SupportTicket,
  SupportTicketDocument,
  SupportTicketMessage,
} from '../../services/api.service';
import { SessionService } from '../../services/session.service';
import { UserAutocompleteComponent } from '../../shared/user-autocomplete/user-autocomplete.component';
import { assertUploadFilesWithinLimit, uploadFileSizeError } from '../../shared/upload-file-size';
import { STAFF_ROLES } from '../../core/staff-permissions';

type View = 'mine' | 'unassigned' | 'pendingReassignment' | 'detail';
type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';

interface StatusOption {
  label: string;
  value: TicketStatus;
}

const STATUS_OPTIONS: readonly StatusOption[] = [
  { label: 'Open', value: 'open' },
  { label: 'Pending', value: 'pending' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Closed', value: 'closed' },
];

@Component({
  selector: 'app-support-tickets-page',
  standalone: true,
  imports: [ReactiveFormsModule, UserAutocompleteComponent, DialogModule, PaginatorModule],
  templateUrl: './support-tickets.page.html',
  styleUrl: './support-tickets.page.css',
})
export class SupportTicketsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);
  private readonly session = inject(SessionService);

  /** Autocomplete de asignación: lo limpiamos tras confirmar o cancelar. */
  private readonly assignPicker = viewChild(UserAutocompleteComponent);

  readonly myId = this.session.userId();
  readonly isSupportOfficer = this.session.role() === 'SUPPORT_OFFICER';
  readonly assignSupportRoles = [STAFF_ROLES.support, STAFF_ROLES.supportOfficer] as const;
  readonly statusOptions = STATUS_OPTIONS;

  readonly mine = signal<SupportTicket[]>([]);
  readonly unassigned = signal<SupportTicket[]>([]);
  readonly pendingReassignment = signal<SupportTicket[]>([]);
  readonly selectedTicket = signal<SupportTicket | null>(null);

  /** Paginación server-side: página + tamaño por pestaña (mismo estilo que clients/staff). */
  readonly rowsPerPageOptions = [10, 25, 50];
  readonly minePage = signal(1);
  readonly minePageSize = signal(10);
  readonly mineTotal = signal(0);
  readonly unassignedPage = signal(1);
  readonly unassignedPageSize = signal(10);
  readonly unassignedTotal = signal(0);
  readonly pendingPage = signal(1);
  readonly pendingPageSize = signal(10);
  readonly pendingTotal = signal(0);

  readonly loading = signal(false);
  readonly detailLoading = signal(false);
  readonly replyLoading = signal(false);
  readonly claimingId = signal<string | null>(null);
  readonly statusBusy = signal(false);
  readonly assignBusy = signal(false);
  /** Ticket sin asignar (de la pestaña "Unassigned") para el que el officer abrió el selector. */
  readonly assignTargetId = signal<string | null>(null);
  /** Visibilidad del diálogo de "asignar a otro support". */
  readonly assignOpen = signal(false);
  readonly downloadingDocId = signal<string | null>(null);

  readonly view = signal<View>('mine');
  readonly statusValue = signal<TicketStatus>('open');
  readonly replyFiles = signal<File[]>([]);

  readonly replyForm = this.fb.nonNullable.group({
    body: ['', [Validators.required, Validators.maxLength(10000)]],
  });

  // El backend ya devuelve cada página ordenada; no reordenamos en cliente para no romper el orden entre páginas.
  readonly mineList = computed(() => this.mine());
  readonly unassignedList = computed(() => this.unassigned());
  readonly pendingReassignmentList = computed(() => this.pendingReassignment());

  readonly selectedMessages = computed(() => {
    const t = this.selectedTicket();
    if (!t?.messages) return [];
    return [...t.messages].sort((a, b) => this.time(a.createdAt) - this.time(b.createdAt));
  });

  readonly replyFileNames = computed(() => this.replyFiles().map((f) => f.name).join(', '));

  get replyBody() {
    return this.replyForm.controls.body;
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(showLoading = true): Promise<void> {
    if (showLoading) this.loading.set(true);
    try {
      const [mineRes, unassignedRes] = await Promise.all([
        this.api.listSupportTickets(this.minePage(), this.minePageSize()),
        this.api.listUnassignedSupportTickets(this.unassignedPage(), this.unassignedPageSize()),
      ]);
      const pendingRes = this.isSupportOfficer
        ? await this.api.listPendingReassignmentSupportTickets(this.pendingPage(), this.pendingPageSize())
        : { tickets: [], total: 0, page: 1, pageSize: this.pendingPageSize() };
      this.mine.set(mineRes.tickets ?? []);
      this.mineTotal.set(mineRes.total ?? 0);
      this.unassigned.set(unassignedRes.tickets ?? []);
      this.unassignedTotal.set(unassignedRes.total ?? 0);
      this.pendingReassignment.set(pendingRes.tickets ?? []);
      this.pendingTotal.set(pendingRes.total ?? 0);
    } catch {
      /* el interceptor ya muestra el aviso */
    } finally {
      this.loading.set(false);
    }
  }

  private async loadMine(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.api.listSupportTickets(this.minePage(), this.minePageSize());
      this.mine.set(res.tickets ?? []);
      this.mineTotal.set(res.total ?? 0);
    } catch {
      /* el interceptor ya muestra el aviso */
    } finally {
      this.loading.set(false);
    }
  }

  private async loadUnassigned(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.api.listUnassignedSupportTickets(this.unassignedPage(), this.unassignedPageSize());
      this.unassigned.set(res.tickets ?? []);
      this.unassignedTotal.set(res.total ?? 0);
    } catch {
      /* el interceptor ya muestra el aviso */
    } finally {
      this.loading.set(false);
    }
  }

  private async loadPending(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.api.listPendingReassignmentSupportTickets(this.pendingPage(), this.pendingPageSize());
      this.pendingReassignment.set(res.tickets ?? []);
      this.pendingTotal.set(res.total ?? 0);
    } catch {
      /* el interceptor ya muestra el aviso */
    } finally {
      this.loading.set(false);
    }
  }

  onMinePage(event: { page?: number; rows?: number }): void {
    this.minePageSize.set(event.rows ?? this.minePageSize());
    this.minePage.set((event.page ?? 0) + 1);
    void this.loadMine();
  }

  onUnassignedPage(event: { page?: number; rows?: number }): void {
    this.unassignedPageSize.set(event.rows ?? this.unassignedPageSize());
    this.unassignedPage.set((event.page ?? 0) + 1);
    void this.loadUnassigned();
  }

  onPendingPage(event: { page?: number; rows?: number }): void {
    this.pendingPageSize.set(event.rows ?? this.pendingPageSize());
    this.pendingPage.set((event.page ?? 0) + 1);
    void this.loadPending();
  }

  showMine(): void {
    this.view.set('mine');
  }
  showUnassigned(): void {
    this.view.set('unassigned');
  }
  showPendingReassignment(): void {
    this.view.set('pendingReassignment');
  }

  async selectTicket(ticket: SupportTicket): Promise<void> {
    this.view.set('detail');
    this.replyForm.reset({ body: '' });
    this.replyFiles.set([]);
    await this.loadDetail(ticket.id);
  }

  async loadDetail(ticketId: string): Promise<void> {
    this.detailLoading.set(true);
    try {
      const res = await this.api.getSupportTicket(ticketId);
      this.selectedTicket.set(res.ticket);
      this.statusValue.set((res.ticket.status as TicketStatus) ?? 'open');
    } catch (err: unknown) {
      this.toast('error', 'Could not load ticket', this.errorOf(err));
      this.view.set('mine');
    } finally {
      this.detailLoading.set(false);
    }
  }

  back(): void {
    this.selectedTicket.set(null);
    this.view.set('mine');
  }

  onReplyFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const error = uploadFileSizeError(files);
    if (error) {
      this.toast('error', 'File too large', error);
      input.value = '';
      return;
    }
    this.replyFiles.set(files);
  }

  removeReplyFile(index: number): void {
    this.replyFiles.update((files) => files.filter((_, i) => i !== index));
  }

  async onReply(): Promise<void> {
    const ticket = this.selectedTicket();
    if (!ticket || this.replyForm.invalid) {
      this.replyForm.markAllAsTouched();
      return;
    }

    this.replyLoading.set(true);
    try {
      const formData = new FormData();
      formData.append('body', this.replyForm.getRawValue().body.trim());
      assertUploadFilesWithinLimit(this.replyFiles());
      this.replyFiles().forEach((file, index) => formData.append(`file_${index + 1}`, file));

      const res = await this.api.createSupportTicketMessage(ticket.id, formData);
      this.replyForm.reset({ body: '' });
      this.replyFiles.set([]);
      await this.loadDetail(ticket.id);
      await this.load(false);
      this.toast('success', 'Reply sent', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not send', this.errorOf(err));
    } finally {
      this.replyLoading.set(false);
    }
  }

  async onClaim(ticketId: string): Promise<void> {
    this.claimingId.set(ticketId);
    try {
      const res = await this.api.assignSupportTicketToMe(ticketId);
      await this.load(false);
      if (this.view() === 'detail') await this.loadDetail(ticketId);
      this.toast('success', 'Ticket claimed', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not claim', this.errorOf(err));
    } finally {
      this.claimingId.set(null);
    }
  }

  async onUpdateStatus(): Promise<void> {
    const ticket = this.selectedTicket();
    if (!ticket) return;
    this.statusBusy.set(true);
    try {
      const res = await this.api.updateSupportTicketStatus(ticket.id, { status: this.statusValue() });
      await this.loadDetail(ticket.id);
      await this.load(false);
      this.toast('success', 'Status updated', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not update status', this.errorOf(err));
    } finally {
      this.statusBusy.set(false);
    }
  }

  /** Selección desde el detalle del ticket. */
  onAssignPick(user: StaffUser): void {
    this.requestAssign(this.selectedTicket(), user);
  }

  /** Abre el diálogo de asignación para un ticket sin asignar (pestaña "Unassigned", solo officer). */
  startAssignOther(ticket: SupportTicket): void {
    this.assignTargetId.set(ticket.id);
    this.assignOpen.set(true);
  }

  cancelAssignOther(): void {
    this.assignOpen.set(false);
  }

  /** Limpieza al cerrarse el diálogo (X, máscara o tras asignar). */
  afterAssignDialogHide(): void {
    this.assignTargetId.set(null);
    this.assignPicker()?.reset();
  }

  /** Selección desde la fila de un ticket sin asignar. */
  onAssignOtherPick(user: StaffUser): void {
    const ticket = this.unassigned().find((t) => t.id === this.assignTargetId()) ?? null;
    this.requestAssign(ticket, user);
  }

  private requestAssign(ticket: SupportTicket | null, user: StaffUser): void {
    if (!ticket) return;
    if (
      (user.role !== STAFF_ROLES.support && user.role !== STAFF_ROLES.supportOfficer) ||
      user.state !== 'approved'
    ) {
      this.toast('error', 'Invalid assignee', 'Tickets can only be assigned to approved support users.');
      this.assignPicker()?.reset();
      return;
    }

    const reassign = !!ticket.supportUser;
    this.confirm.confirm({
      header: reassign ? 'Reassign ticket' : 'Assign ticket',
      message: `${reassign ? 'Reassign' : 'Assign'} this ticket to ${user.email}?`,
      icon: 'pi pi-user-plus',
      acceptLabel: reassign ? 'Reassign' : 'Assign',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => void this.doAssign(ticket.id, user),
      reject: () => this.assignPicker()?.reset(),
    });
  }

  private async doAssign(ticketId: string, user: StaffUser): Promise<void> {
    this.assignBusy.set(true);
    try {
      const res = await this.api.assignSupportTicket(ticketId, user.id);
      if (this.view() === 'detail') await this.loadDetail(ticketId);
      await this.load(false);
      this.toast('success', 'Ticket assigned', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not assign', this.errorOf(err));
    } finally {
      this.assignBusy.set(false);
      this.assignOpen.set(false);
      this.assignTargetId.set(null);
      this.assignPicker()?.reset();
    }
  }

  async downloadDocument(doc: SupportTicketDocument): Promise<void> {
    this.downloadingDocId.set(doc.id);
    try {
      const blob = await this.api.downloadSupportTicketDocument(doc.id);
      this.saveBlob(blob, doc.name || 'attachment');
    } catch (err: unknown) {
      this.toast('error', 'Could not download', this.errorOf(err));
    } finally {
      this.downloadingDocId.set(null);
    }
  }

  // ---- reglas / helpers ----

  isAssignedToMe(t: SupportTicket): boolean {
    return t.supportUser?.id === this.myId;
  }
  /**
   * Responder y cambiar el estado SOLO lo permite el support ASIGNADO al ticket (espejo del
   * backend: tanto `createSupportTicketMessageAction` como `updateSupportTicketStatusAction`
   * exigen `ticket.supportUser` y que su id sea el del usuario). Un support officer no asignado
   * puede ver y asignar (y reclamar si está libre), pero NO responder ni editar el estado.
   */
  canUpdateStatus(t: SupportTicket): boolean {
    return this.isAssignedToMe(t);
  }
  canReply(t: SupportTicket): boolean {
    return t.status !== 'closed' && this.isAssignedToMe(t);
  }
  canClaim(t: SupportTicket): boolean {
    return !t.supportUser && t.status !== 'closed';
  }

  isOwn(message: SupportTicketMessage): boolean {
    return !!this.myId && message.sender?.id === this.myId;
  }
  senderLabel(message: SupportTicketMessage): string {
    if (this.isOwn(message)) return 'You';
    return message.sender?.email || message.sender?.id || 'User';
  }
  customerLabel(t: SupportTicket): string {
    return t.customerUser?.email || '—';
  }
  assignedLabel(t: SupportTicket): string {
    return t.supportUser?.email || 'Unassigned';
  }
  statusLabel(status?: string): string {
    return STATUS_OPTIONS.find((s) => s.value === status)?.label ?? 'Open';
  }
  priorityLabel(priority?: string): string {
    if (!priority) return 'Normal';
    return priority.charAt(0).toUpperCase() + priority.slice(1);
  }
  statusBadgeClass(status?: string): string {
    switch (status) {
      case 'closed':
        return 'cf-badge cf-badge--neutral';
      case 'resolved':
        return 'cf-badge cf-badge--success';
      case 'pending':
        return 'cf-badge cf-badge--warning';
      default:
        return 'cf-badge cf-badge--info';
    }
  }
  priorityBadgeClass(priority?: string): string {
    switch (priority) {
      case 'urgent':
        return 'cf-badge cf-badge--danger';
      case 'high':
        return 'cf-badge cf-badge--warning';
      case 'low':
        return 'cf-badge cf-badge--neutral';
      default:
        return 'cf-badge cf-badge--info';
    }
  }
  shortId(t: SupportTicket): string {
    return `#${t.id.slice(0, 8).toUpperCase()}`;
  }
  formatDate(value?: string | Date | null): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  onStatusChange(event: Event): void {
    this.statusValue.set((event.target as HTMLSelectElement).value as TicketStatus);
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
