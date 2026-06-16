import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';

import {
  ApiService,
  InternalConversation,
  InternalMessage,
  StaffUser,
} from '../../services/api.service';
import { NotificationsService } from '../../services/notifications.service';
import { RealtimeService } from '../../services/realtime.service';
import { SessionService } from '../../services/session.service';
import { UserAutocompleteComponent } from '../../shared/user-autocomplete/user-autocomplete.component';

type MessagesView = 'active' | 'closed' | 'create' | 'detail';

@Component({
  selector: 'app-internal-messages-page',
  standalone: true,
  imports: [ReactiveFormsModule, UserAutocompleteComponent],
  templateUrl: './internal-messages.page.html',
  styleUrl: './internal-messages.page.css',
})
export class InternalMessagesPage implements OnInit, OnDestroy {
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

  readonly conversations = signal<InternalConversation[]>([]);
  readonly loading = signal(false);
  readonly sendLoading = signal(false);
  readonly createLoading = signal(false);
  readonly closingId = signal<string | null>(null);

  readonly view = signal<MessagesView>('active');
  readonly selectedId = signal<string | null>(null);

  readonly replyForm = this.fb.nonNullable.group({
    body: ['', [Validators.required, Validators.maxLength(10000)]],
  });

  readonly createForm = this.fb.nonNullable.group({
    customerUserId: ['', [Validators.required]],
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

  readonly canReply = computed(() => this.selectedConversation()?.status === 'open');

  get replyBody() {
    return this.replyForm.controls.body;
  }
  get createSubject() {
    return this.createForm.controls.subject;
  }
  get createBody() {
    return this.createForm.controls.body;
  }
  get createCustomer() {
    return this.createForm.controls.customerUserId;
  }

  ngOnInit(): void {
    this.notifications.markTypeRead('internal_message');

    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const id = params.get('conversation');
      if (id) {
        this.pendingOpenId = id;
        this.tryOpenPending();
      }
    });

    this.socketSub = this.realtime.internalMessageCreated$.subscribe(() => {
      this.notifications.markTypeRead('internal_message');
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
      const res = await this.api.listInternalConversations();
      this.conversations.set(res.conversations ?? []);

      // Si la conversación abierta ya no existe, volvemos al listado.
      const id = this.selectedId();
      if (id && !this.conversations().some((c) => c.id === id)) {
        this.selectedId.set(null);
        if (this.view() === 'detail') this.view.set('active');
      }

      this.tryOpenPending();
    } catch {
      /* el interceptor ya muestra el aviso */
    } finally {
      this.loading.set(false);
    }
  }

  showActive(): void {
    this.view.set('active');
  }

  showClosed(): void {
    this.view.set('closed');
  }

  showCreate(): void {
    this.view.set('create');
  }

  onClientPicked(user: StaffUser): void {
    this.createForm.controls.customerUserId.setValue(user.id);
    this.createForm.controls.customerUserId.markAsTouched();
  }

  openDetail(conversation: InternalConversation): void {
    this.selectedId.set(conversation.id);
    this.replyForm.reset({ body: '' });
    this.view.set('detail');
  }

  back(): void {
    const closed = this.selectedConversation()?.status === 'closed';
    this.selectedId.set(null);
    this.view.set(closed ? 'closed' : 'active');
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

    const value = this.createForm.getRawValue();
    this.createLoading.set(true);
    try {
      const res = await this.api.createInternalConversation({
        customerUserId: value.customerUserId,
        supportUserId: this.myId ?? value.customerUserId, // el backend usa el staff autenticado; campo requerido por el DTO
        subject: value.subject.trim(),
        body: value.body.trim(),
      });
      this.createForm.reset({ customerUserId: '', subject: '', body: '' });
      await this.load(false);
      this.view.set('active');
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

  // ---- labels / helpers ----

  peerLabel(conversation: InternalConversation): string {
    const client = conversation.customerUser;
    return client?.email || client?.id || 'Client';
  }

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

  shortId(conversation: InternalConversation): string {
    return `#${conversation.id.slice(0, 8).toUpperCase()}`;
  }

  latestMessage(conversation: InternalConversation): string {
    const last = this.latestOf(conversation);
    return last?.body ?? 'No messages yet';
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

  private tryOpenPending(): void {
    if (!this.pendingOpenId) return;
    const conversation = this.conversations().find((c) => c.id === this.pendingOpenId);
    if (conversation) {
      this.openDetail(conversation);
      this.pendingOpenId = null;
    }
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
