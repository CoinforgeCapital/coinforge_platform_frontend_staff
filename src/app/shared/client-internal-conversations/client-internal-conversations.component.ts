import { Component, computed, effect, inject, input, OnDestroy, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';

import { STAFF_ROLES } from '../../core/staff-permissions';
import { ApiService, InternalConversation, InternalMessage } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { RealtimeService } from '../../services/realtime.service';
import { SessionService } from '../../services/session.service';

/**
 * Conversaciones internas (compliance) de un cliente concreto, embebido en el detalle de cliente.
 *
 * Reutiliza los endpoints existentes (`/api/compliance-conversation`). Crear/responder/cerrar solo
 * se muestra si `canWrite` (lo decide el contenedor: compliance officer con cualquier cliente,
 * compliance con sus asignados). En solo lectura, igualmente se pueden ver los mensajes.
 */
@Component({
  selector: 'app-client-internal-conversations',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './client-internal-conversations.component.html',
  styleUrl: './client-internal-conversations.component.css',
})
export class ClientInternalConversationsComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly messages = inject(MessageService);
  private readonly realtime = inject(RealtimeService);
  private readonly session = inject(SessionService);
  private readonly auth = inject(AuthService);

  readonly clientId = input.required<string>();
  readonly clientEmail = input<string>('');
  readonly canWrite = input<boolean>(false);

  readonly myId = this.session.userId();

  readonly conversations = signal<InternalConversation[]>([]);
  readonly loading = signal(false);
  readonly sendLoading = signal(false);
  readonly createLoading = signal(false);
  readonly closingId = signal<string | null>(null);

  readonly view = signal<'list' | 'detail' | 'create'>('list');
  readonly selectedId = signal<string | null>(null);

  readonly replyForm = this.fb.nonNullable.group({
    body: ['', [Validators.required, Validators.maxLength(10000)]],
  });
  readonly createForm = this.fb.nonNullable.group({
    subject: ['', [Validators.required, Validators.maxLength(100)]],
    body: ['', [Validators.required, Validators.maxLength(10000)]],
  });

  readonly activeConversations = computed(() =>
    this.sortByLatest(this.conversations().filter((c) => c.status !== 'closed')),
  );
  readonly closedConversations = computed(() =>
    this.sortByLatest(this.conversations().filter((c) => c.status === 'closed')),
  );

  readonly selectedConversation = computed(() => {
    const id = this.selectedId();
    return id ? this.conversations().find((c) => c.id === id) ?? null : null;
  });
  readonly selectedMessages = computed(() => {
    const conversation = this.selectedConversation();
    if (!conversation?.messages) return [];
    return [...conversation.messages].sort((a, b) => this.time(a.createdAt) - this.time(b.createdAt));
  });
  readonly canReply = computed(() => this.canWrite() && this.selectedConversation()?.status === 'open');

  get replyBody() {
    return this.replyForm.controls.body;
  }
  get createSubject() {
    return this.createForm.controls.subject;
  }
  get createBody() {
    return this.createForm.controls.body;
  }

  private loadedForId: string | null = null;
  private socketSub?: Subscription;

  constructor() {
    // Carga las conversaciones cuando cambia el cliente (guard por id para no recargar en bucle).
    effect(() => {
      const id = this.clientId();
      if (!id || id === this.loadedForId) return;
      this.loadedForId = id;
      this.view.set('list');
      this.selectedId.set(null);
      void this.load();
    });
  }

  ngOnInit(): void {
    // Refresco en vivo cuando llega un mensaje interno por socket.
    this.socketSub = this.realtime.internalMessageCreated$.subscribe(() => void this.load(false));
  }

  ngOnDestroy(): void {
    this.socketSub?.unsubscribe();
  }

  async load(showLoading = true): Promise<void> {
    const id = this.clientId();
    if (!id) return;
    if (showLoading) this.loading.set(true);
    try {
      this.conversations.set(await this.fetchConversations(id));

      const selected = this.selectedId();
      if (selected && !this.conversations().some((c) => c.id === selected)) {
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
    this.selectedId.set(null);
  }
  showCreate(): void {
    this.createForm.reset({ subject: '', body: '' });
    this.view.set('create');
  }

  openDetail(conversation: InternalConversation): void {
    this.selectedId.set(conversation.id);
    this.replyForm.reset({ body: '' });
    this.view.set('detail');
  }
  back(): void {
    this.selectedId.set(null);
    this.view.set('list');
  }

  async onSend(): Promise<void> {
    const conversation = this.selectedConversation();
    if (!conversation || this.replyForm.invalid) {
      this.replyForm.markAllAsTouched();
      return;
    }
    this.sendLoading.set(true);
    try {
      const res = await this.api.createInternalMessage(conversation.id, {
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

  async onCreate(): Promise<void> {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    const clientId = this.clientId();
    const value = this.createForm.getRawValue();
    this.createLoading.set(true);
    try {
      const res = await this.api.createInternalConversation({
        customerUserId: clientId,
        // El backend usa el staff autenticado; el DTO exige el campo (igual que en la página).
        supportUserId: this.myId ?? clientId,
        subject: value.subject.trim(),
        body: value.body.trim(),
      });
      this.createForm.reset({ subject: '', body: '' });
      await this.load(false);
      this.view.set('list');
      this.toast('success', 'Conversation created', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not create', this.errorOf(err));
    } finally {
      this.createLoading.set(false);
    }
  }

  async onClose(conversationId: string): Promise<void> {
    this.closingId.set(conversationId);
    try {
      const res = await this.api.closeInternalConversation(conversationId);
      await this.load(false);
      this.toast('success', 'Conversation closed', res.message ?? 'Conversation closed.');
    } catch (err: unknown) {
      this.toast('error', 'Could not close', this.errorOf(err));
    } finally {
      this.closingId.set(null);
    }
  }

  /**
   * El backend separa endpoints: `GET /:userId` (admin / operator / compliance officer) y
   * `GET /` (las conversaciones propias, que es lo que puede el compliance). Elegimos según el
   * rol para no provocar un 403 al cargar.
   */
  private async fetchConversations(clientId: string): Promise<InternalConversation[]> {
    const role = this.auth.currentRole();
    if (role === STAFF_ROLES.admin || role === STAFF_ROLES.operator || role === STAFF_ROLES.complianceOfficer) {
      const res = await this.api.listInternalConversationsByUser(clientId);
      return res.conversations ?? [];
    }
    const res = await this.api.listInternalConversations();
    return (res.conversations ?? []).filter((c) => c.customerUser?.id === clientId);
  }

  // ---- labels / helpers ----

  isOwn(message: InternalMessage): boolean {
    return !!this.myId && message.sender?.id === this.myId;
  }
  senderLabel(message: InternalMessage): string {
    if (this.isOwn(message)) return 'You';
    return message.sender?.email || message.sender?.id || 'Client';
  }
  statusLabel(status?: string): string {
    return status === 'closed' ? 'Closed' : 'Open';
  }
  statusBadgeClass(status?: string): string {
    return status === 'closed' ? 'cf-badge cf-badge--neutral' : 'cf-badge cf-badge--success';
  }
  shortId(conversation: InternalConversation): string {
    return `#${conversation.id.slice(0, 8).toUpperCase()}`;
  }
  latestMessage(conversation: InternalConversation): string {
    return this.latestOf(conversation)?.body ?? 'No messages yet';
  }
  latestDate(conversation: InternalConversation): string {
    const last = this.latestOf(conversation);
    return this.formatDate(last?.createdAt ?? conversation.updatedAt ?? conversation.createdAt);
  }
  formatDate(value?: string | Date | null): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  private latestOf(conversation: InternalConversation): InternalMessage | null {
    const list = conversation.messages ?? [];
    if (!list.length) return null;
    return [...list].sort((a, b) => this.time(b.createdAt) - this.time(a.createdAt))[0] ?? null;
  }
  private sortByLatest(list: InternalConversation[]): InternalConversation[] {
    return [...list].sort((a, b) => this.latestTime(b) - this.latestTime(a));
  }
  private latestTime(conversation: InternalConversation): number {
    const last = this.latestOf(conversation);
    return this.time(last?.createdAt ?? conversation.updatedAt ?? conversation.createdAt);
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
