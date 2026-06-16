import { Component, computed, effect, inject, input, OnDestroy, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';

import { ActionRequest, ActionRequestMessage, ApiService } from '../../services/api.service';
import { RealtimeService } from '../../services/realtime.service';
import { SessionService } from '../../services/session.service';

/**
 * Chats de action request entre el staff autenticado y OTRO staff (el del detalle), embebido en
 * el detalle de staff member. Solo lectura + responder/cerrar (no crear).
 *
 * Carga `listOwnActionRequests()` (mis action requests; accesible a cualquier rol staff) y filtra
 * por el staff del detalle según `mode`: 'created' (ese staff es el creador, yo el asignado) o
 * 'assigned' (ese staff es el asignado, yo el creador). En ambos casos soy participante, así que
 * puedo responder los que estén abiertos.
 */
@Component({
  selector: 'app-staff-action-requests',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './staff-action-requests.component.html',
  styleUrl: './staff-action-requests.component.css',
})
export class StaffActionRequestsComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly messages = inject(MessageService);
  private readonly realtime = inject(RealtimeService);
  private readonly session = inject(SessionService);

  readonly peerId = input.required<string>();
  readonly peerEmail = input<string>('');
  /** Rol del staff del detalle en el action request: 'created' (creador) o 'assigned' (asignado). */
  readonly mode = input<'created' | 'assigned'>('created');

  readonly myId = this.session.userId();

  /** Mis action requests (own): creador o asignado yo. */
  readonly all = signal<ActionRequest[]>([]);
  readonly loading = signal(false);
  readonly sendLoading = signal(false);
  readonly closingId = signal<string | null>(null);

  readonly view = signal<'list' | 'detail'>('list');
  readonly selectedId = signal<string | null>(null);

  readonly replyForm = this.fb.nonNullable.group({
    body: ['', [Validators.required, Validators.maxLength(10000)]],
  });

  readonly conversations = computed(() => {
    const peer = this.peerId();
    const created = this.mode() === 'created';
    const filtered = this.all().filter((a) =>
      created ? a.staffUserCreator?.id === peer : a.staffUserAssigned?.id === peer,
    );
    return this.sortByLatest(filtered);
  });
  readonly activeConversations = computed(() => this.conversations().filter((a) => a.status !== 'closed'));
  readonly closedConversations = computed(() => this.conversations().filter((a) => a.status === 'closed'));

  readonly selected = computed<ActionRequest | null>(() => {
    const id = this.selectedId();
    return id ? this.all().find((a) => a.id === id) ?? null : null;
  });
  readonly selectedMessages = computed(() => {
    const a = this.selected();
    if (!a?.messages) return [];
    return [...a.messages].sort((x, y) => this.time(x.createdAt) - this.time(y.createdAt));
  });
  readonly canReply = computed(() => {
    const a = this.selected();
    return !!a && a.status !== 'closed';
  });

  get replyBody() {
    return this.replyForm.controls.body;
  }

  private loadedForId: string | null = null;
  private socketSub?: Subscription;

  constructor() {
    effect(() => {
      const id = this.peerId();
      if (!id || id === this.loadedForId) return;
      this.loadedForId = id;
      this.view.set('list');
      this.selectedId.set(null);
      void this.load();
    });
  }

  ngOnInit(): void {
    this.socketSub = this.realtime.actionRequestMessageCreated$.subscribe(() => void this.load(false));
  }
  ngOnDestroy(): void {
    this.socketSub?.unsubscribe();
  }

  async load(showLoading = true): Promise<void> {
    if (showLoading) this.loading.set(true);
    try {
      const res = await this.api.listOwnActionRequests();
      this.all.set(res.conversations ?? []);

      const selected = this.selectedId();
      if (selected && !this.all().some((a) => a.id === selected)) {
        this.selectedId.set(null);
        if (this.view() === 'detail') this.view.set('list');
      }
    } catch {
      /* el interceptor ya muestra el aviso */
    } finally {
      this.loading.set(false);
    }
  }

  openDetail(actionRequest: ActionRequest): void {
    this.selectedId.set(actionRequest.id);
    this.replyForm.reset({ body: '' });
    this.view.set('detail');
  }
  back(): void {
    this.selectedId.set(null);
    this.view.set('list');
  }

  async onSend(): Promise<void> {
    const actionRequest = this.selected();
    if (!actionRequest || this.replyForm.invalid) {
      this.replyForm.markAllAsTouched();
      return;
    }
    this.sendLoading.set(true);
    try {
      const res = await this.api.createActionRequestMessage(actionRequest.id, {
        body: this.replyForm.getRawValue().body.trim(),
      });
      this.replyForm.reset({ body: '' });
      await this.load(false);
      this.toast('success', 'Message sent', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not send', this.errorOf(err));
    } finally {
      this.sendLoading.set(false);
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

  // ---- labels / helpers ----

  isOwn(message: ActionRequestMessage): boolean {
    return !!this.myId && message.sender?.id === this.myId;
  }
  senderLabel(message: ActionRequestMessage): string {
    if (this.isOwn(message)) return 'You';
    return message.sender?.email || message.sender?.id || 'Staff';
  }
  statusLabel(status?: string): string {
    return status === 'closed' ? 'Closed' : 'Open';
  }
  statusBadgeClass(status?: string): string {
    return status === 'closed' ? 'cf-badge cf-badge--neutral' : 'cf-badge cf-badge--success';
  }
  targetLabel(target?: string): string {
    return String(target ?? '').replace(/_/g, ' ');
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
  formatDate(value?: string | Date | null): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
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
