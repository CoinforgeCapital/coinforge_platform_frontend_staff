import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';

import {
  ActionRequest,
  ActionRequestMessage,
  ApiService,
  ListActionRequestsResponse,
} from '../../services/api.service';
import { STAFF_ROLES } from '../../core/staff-permissions';
import { NotificationsService } from '../../services/notifications.service';
import { RealtimeService } from '../../services/realtime.service';
import { SessionService } from '../../services/session.service';

/** Pestañas de listado. La de "assigned" (todos los asignados) es solo admin. */
type ListTab = 'unassigned' | 'mine' | 'assigned';
type View = ListTab | 'create' | 'detail';

interface TargetOption {
  label: string;
  value: string;
}

const TARGET_OPTIONS: readonly TargetOption[] = [
  { label: 'Support', value: 'SUPPORT' },
  { label: 'Support officer', value: 'SUPPORT_OFFICER' },
  { label: 'Compliance', value: 'COMPLIANCE' },
  { label: 'Compliance officer', value: 'COMPLIANCE_OFFICER' },
  { label: 'Operator', value: 'OPERATOR' },
  { label: 'Admin', value: 'ADMIN' },
];

@Component({
  selector: 'app-action-requests-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './action-requests.page.html',
  styleUrl: './action-requests.page.css',
})
export class ActionRequestsPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly messages = inject(MessageService);
  private readonly realtime = inject(RealtimeService);
  private readonly session = inject(SessionService);
  private readonly notifications = inject(NotificationsService);

  private socketSub?: Subscription;
  private routeSub?: Subscription;
  private pendingOpenId: string | null = null;

  readonly myId = this.session.userId();
  readonly myRole = this.session.role();
  readonly targetOptions = TARGET_OPTIONS;

  /**
   * La pestaña "All assigned" (todas las conversaciones ya asignadas) es exclusiva de admin:
   * solo el admin puede ver todos los action requests asignados (GET /api/action-request).
   */
  readonly isAdmin = this.myRole === STAFF_ROLES.admin;

  // Sin asignar (por rol), asignados a mí / creados por mí, y —solo admin— todos los asignados.
  readonly unassigned = signal<ActionRequest[]>([]);
  readonly mine = signal<ActionRequest[]>([]);
  readonly assigned = signal<ActionRequest[]>([]);
  readonly loading = signal(false);
  readonly sendLoading = signal(false);
  readonly createLoading = signal(false);
  readonly claimingId = signal<string | null>(null);
  readonly closingId = signal<string | null>(null);

  readonly view = signal<View>('unassigned');
  readonly returnView = signal<ListTab>('unassigned');
  readonly selectedId = signal<string | null>(null);

  readonly replyForm = this.fb.nonNullable.group({
    body: ['', [Validators.required, Validators.maxLength(10000)]],
  });

  readonly createForm = this.fb.nonNullable.group({
    target: ['', [Validators.required]],
    subject: ['', [Validators.required, Validators.maxLength(100)]],
    body: ['', [Validators.required, Validators.maxLength(10000)]],
  });

  readonly unassignedList = computed(() => this.sortByLatest(this.unassigned()));
  readonly mineList = computed(() => this.sortByLatest(this.mine()));
  /** "All assigned" = conversaciones ya asignadas (el endpoint admin devuelve todas, filtramos). */
  readonly assignedList = computed(() =>
    this.sortByLatest(this.assigned().filter((a) => !!a.staffUserAssigned)),
  );

  readonly selected = computed<ActionRequest | null>(() => {
    const id = this.selectedId();
    if (!id) return null;
    return (
      this.unassigned().find((a) => a.id === id) ??
      this.mine().find((a) => a.id === id) ??
      this.assigned().find((a) => a.id === id) ??
      null
    );
  });

  readonly selectedMessages = computed(() => {
    const a = this.selected();
    if (!a?.messages) return [];
    return [...a.messages].sort((x, y) => this.time(x.createdAt) - this.time(y.createdAt));
  });

  get replyBody() {
    return this.replyForm.controls.body;
  }
  get createTarget() {
    return this.createForm.controls.target;
  }
  get createSubject() {
    return this.createForm.controls.subject;
  }
  get createBody() {
    return this.createForm.controls.body;
  }

  ngOnInit(): void {
    this.notifications.markTypeRead('action_request');

    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const id = params.get('conversation');
      if (id) {
        this.pendingOpenId = id;
        this.tryOpenPending();
      }
    });

    this.socketSub = this.realtime.actionRequestMessageCreated$.subscribe(() => {
      this.notifications.markTypeRead('action_request');
      void this.load(false);
    });

    void this.load();
  }

  ngOnDestroy(): void {
    this.socketSub?.unsubscribe();
    this.routeSub?.unsubscribe();
  }

  async load(showLoading = true): Promise<void> {
    if (showLoading) this.loading.set(true);
    try {
      const emptyResponse: ListActionRequestsResponse = { conversations: [] };
      const [unassignedRes, mineRes, assignedRes] = await Promise.all([
        this.api.listUnassignedActionRequests(),
        this.api.listOwnActionRequests(),
        // Solo admin consulta la lista global; el resto recibe una respuesta vacía.
        this.isAdmin ? this.api.listActionRequests() : Promise.resolve(emptyResponse),
      ]);
      this.unassigned.set(unassignedRes.conversations ?? []);
      this.mine.set(mineRes.conversations ?? []);
      this.assigned.set(assignedRes.conversations ?? []);

      const id = this.selectedId();
      if (id && !this.selected()) {
        this.selectedId.set(null);
        if (this.view() === 'detail') this.view.set('unassigned');
      }

      this.tryOpenPending();
    } catch {
      /* el interceptor ya muestra el aviso */
    } finally {
      this.loading.set(false);
    }
  }

  showUnassigned(): void {
    this.view.set('unassigned');
  }
  showMine(): void {
    this.view.set('mine');
  }
  showAssigned(): void {
    this.view.set('assigned');
  }
  showCreate(): void {
    this.view.set('create');
  }

  openDetail(actionRequest: ActionRequest): void {
    const current = this.view();
    if (current === 'unassigned' || current === 'mine' || current === 'assigned') {
      this.returnView.set(current);
    }
    this.selectedId.set(actionRequest.id);
    this.replyForm.reset({ body: '' });
    this.view.set('detail');
  }

  back(): void {
    this.selectedId.set(null);
    this.view.set(this.returnView());
  }

  async onSend(): Promise<void> {
    const a = this.selected();
    if (!a || this.replyForm.invalid) {
      this.replyForm.markAllAsTouched();
      return;
    }
    this.sendLoading.set(true);
    try {
      const res = await this.api.createActionRequestMessage(a.id, { body: this.replyForm.getRawValue().body.trim() });
      this.replyForm.reset({ body: '' });
      await this.load(false);
      this.toast('success', 'Message sent', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not send', this.errorOf(err));
    } finally {
      this.sendLoading.set(false);
    }
  }

  async onCreate(): Promise<void> {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    const value = this.createForm.getRawValue();
    this.createLoading.set(true);
    try {
      const res = await this.api.createActionRequest({
        staffUserCreatorId: this.myId ?? '',
        target: value.target,
        subject: value.subject.trim(),
        body: value.body.trim(),
      });
      this.createForm.reset({ target: '', subject: '', body: '' });
      await this.load(false);
      this.view.set('mine');
      this.toast('success', 'Action request created', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not create', this.errorOf(err));
    } finally {
      this.createLoading.set(false);
    }
  }

  async onClaim(id: string): Promise<void> {
    this.claimingId.set(id);
    try {
      const res = await this.api.attachActionRequest(id);
      await this.load(false);
      this.toast('success', 'Action request claimed', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not claim', this.errorOf(err));
    } finally {
      this.claimingId.set(null);
    }
  }

  async onClose(id: string): Promise<void> {
    this.closingId.set(id);
    try {
      const res = await this.api.closeActionRequest(id);
      await this.load(false);
      this.toast('success', 'Action request closed', res.message ?? 'Closed.');
    } catch (err: unknown) {
      this.toast('error', 'Could not close', this.errorOf(err));
    } finally {
      this.closingId.set(null);
    }
  }

  // ---- reglas / helpers ----

  isParticipant(a: ActionRequest): boolean {
    return a.staffUserCreator?.id === this.myId || a.staffUserAssigned?.id === this.myId;
  }

  /** Cualquier participante puede responder mientras la conversación esté abierta. */
  canReply(a: ActionRequest): boolean {
    return a.status !== 'closed' && this.isParticipant(a);
  }

  /** Solo los dos usuarios que participan (creador o asignado) pueden cerrar la conversación. */
  canClose(a: ActionRequest): boolean {
    return a.status !== 'closed' && this.isParticipant(a);
  }

  canClaim(a: ActionRequest): boolean {
    if (a.status === 'closed' || a.staffUserAssigned || a.staffUserCreator?.id === this.myId) return false;
    return this.roleMatchesTarget(a.target);
  }

  isOwn(message: ActionRequestMessage): boolean {
    return !!this.myId && message.sender?.id === this.myId;
  }

  senderLabel(message: ActionRequestMessage): string {
    if (this.isOwn(message)) return 'You';
    return message.sender?.email || message.sender?.id || 'Staff';
  }

  creatorLabel(a: ActionRequest): string {
    return a.staffUserCreator?.email || '—';
  }

  assignedLabel(a: ActionRequest): string {
    return a.staffUserAssigned?.email || 'Unassigned';
  }

  targetLabel(target?: string): string {
    return String(target ?? '').replace(/_/g, ' ');
  }

  statusLabel(status?: string): string {
    return status === 'closed' ? 'Closed' : 'Open';
  }

  shortId(a: ActionRequest): string {
    return `#${a.id.slice(0, 8).toUpperCase()}`;
  }

  latestMessage(a: ActionRequest): string {
    return this.latestOf(a)?.body ?? 'No messages yet';
  }

  latestDate(a: ActionRequest): string {
    return this.formatDate(this.latestOf(a)?.createdAt ?? a.updatedAt ?? a.createdAt);
  }

  emptyLabel(): string {
    switch (this.view()) {
      case 'mine':
        return 'You have no action requests yet.';
      case 'assigned':
        return 'No assigned action requests.';
      default:
        return 'No unassigned action requests for your area.';
    }
  }

  formatDate(value?: string | Date | null): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  private roleMatchesTarget(target?: string): boolean {
    if (!target || !this.myRole) return false;
    if (this.myRole === target) return true;
    if (this.myRole === 'COMPLIANCE_OFFICER' && target === 'COMPLIANCE') return true;
    if (this.myRole === 'SUPPORT_OFFICER' && target === 'SUPPORT') return true;
    return false;
  }

  private tryOpenPending(): void {
    if (!this.pendingOpenId) return;
    const found =
      this.unassigned().find((a) => a.id === this.pendingOpenId) ??
      this.mine().find((a) => a.id === this.pendingOpenId) ??
      this.assigned().find((a) => a.id === this.pendingOpenId);
    if (found) {
      this.openDetail(found);
      this.pendingOpenId = null;
    }
  }

  private latestOf(a: ActionRequest): ActionRequestMessage | null {
    const list = a.messages ?? [];
    if (!list.length) return null;
    return [...list].sort((x, y) => this.time(y.createdAt) - this.time(x.createdAt))[0] ?? null;
  }

  private sortByLatest(list: ActionRequest[]): ActionRequest[] {
    return [...list].sort((a, b) => this.latestTime(b) - this.latestTime(a));
  }

  private latestTime(a: ActionRequest): number {
    return this.time(this.latestOf(a)?.createdAt ?? a.updatedAt ?? a.createdAt);
  }

  private time(value?: string | Date | null): number {
    if (!value) return 0;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
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
