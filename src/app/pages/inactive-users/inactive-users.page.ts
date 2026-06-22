import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';

import { ApiService, InactiveUser } from '../../services/api.service';

interface InfoField {
  label: string;
  value: string;
  mono?: boolean;
}

@Component({
  selector: 'app-inactive-users-page',
  standalone: true,
  imports: [DatePipe, TableModule],
  templateUrl: './inactive-users.page.html',
  styleUrl: './inactive-users.page.css',
})
export class InactiveUsersPage {
  private readonly api = inject(ApiService);
  private readonly messages = inject(MessageService);

  readonly rows = signal<InactiveUser[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly search = signal('');
  readonly loading = signal(false);
  readonly first = computed(() => (this.page() - 1) * this.pageSize());

  readonly view = signal<'list' | 'detail'>('list');
  readonly selected = signal<InactiveUser | null>(null);
  readonly detail = signal<InactiveUser | null>(null);
  readonly detailLoading = signal(false);

  readonly accountFields = computed<InfoField[]>(() => {
    const user = this.detail() ?? this.selected();
    if (!user) {
      return [];
    }

    return [
      { label: 'Email', value: user.email },
      { label: 'Activation code', value: user.activationCode || '-', mono: true },
      { label: 'Role', value: this.roleLabel(user.role) },
      { label: 'State', value: this.stateLabel(user.state) },
      { label: 'Type', value: String(user.type ?? '-') },
      { label: 'Created', value: this.formatDate(user.createdAt) },
      { label: 'Updated', value: this.formatDate(user.updatedAt) },
      { label: 'User ID', value: user.id, mono: true },
    ];
  });

  readonly metadataFields = computed<InfoField[]>(() => {
    const metadata = this.detail()?.clientMetadata;
    if (!metadata) {
      return [];
    }

    return [
      { label: 'Discovery source', value: this.formatLabel(metadata.discoverySource) },
      { label: 'Understands and continues', value: this.yesNo(metadata.understandAndContinue) },
      { label: 'Acknowledges Axora Fintech', value: this.yesNo(metadata.acknowledgesAxoraFintech) },
      { label: 'Created', value: this.formatDate(metadata.createdAt) },
      { label: 'Updated', value: this.formatDate(metadata.updatedAt) },
      { label: 'Metadata ID', value: metadata.id ?? '-', mono: true },
    ];
  });

  private pendingListKey = '';
  private lastLoadedListKey = '';

  constructor() {
    void this.loadPage(1, this.pageSize());
  }

  async loadPage(page: number, pageSize: number): Promise<void> {
    const q = this.search().trim();
    const key = `${page}:${pageSize}:${q}`;
    if (this.pendingListKey === key || this.lastLoadedListKey === key) {
      return;
    }

    this.pendingListKey = key;
    this.loading.set(true);
    try {
      const response = await this.api.listInactiveUsers(page, pageSize, q);
      this.rows.set(response.users ?? []);
      this.total.set(response.total ?? 0);
      this.page.set(response.page ?? page);
      this.pageSize.set(response.pageSize ?? pageSize);
      this.lastLoadedListKey = key;
    } catch (err: unknown) {
      this.toast('error', 'Could not load inactive users', this.errorOf(err));
    } finally {
      if (this.pendingListKey === key) {
        this.pendingListKey = '';
      }
      this.loading.set(false);
    }
  }

  onLazyLoad(event: { first?: number | null; rows?: number | null }): void {
    const pageSize = Number(event.rows ?? this.pageSize());
    const first = Number(event.first ?? 0);
    const page = Math.floor(first / pageSize) + 1;
    void this.loadPage(page, pageSize);
  }

  onSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  applySearch(event?: Event): void {
    event?.preventDefault();
    this.lastLoadedListKey = '';
    void this.loadPage(1, this.pageSize());
  }

  clearSearch(): void {
    this.search.set('');
    this.applySearch();
  }

  async openDetail(user: InactiveUser): Promise<void> {
    this.selected.set(user);
    this.detail.set(null);
    this.view.set('detail');
    this.detailLoading.set(true);
    try {
      const response = await this.api.getInactiveUser(user.id);
      this.detail.set(response.user);
    } catch (err: unknown) {
      this.toast('error', 'Could not load inactive user', this.errorOf(err));
    } finally {
      this.detailLoading.set(false);
    }
  }

  backToList(): void {
    this.view.set('list');
    this.selected.set(null);
    this.detail.set(null);
  }

  roleLabel(value?: string): string {
    return this.formatLabel(value);
  }

  stateLabel(value?: string): string {
    return this.formatLabel(value);
  }

  stateBadgeClass(value?: string): string {
    const normalized = String(value ?? '').toLowerCase();
    if (normalized === 'new') {
      return 'cf-badge cf-badge--info';
    }
    if (normalized === 'blocked' || normalized === 'deleted') {
      return 'cf-badge cf-badge--danger';
    }
    return 'cf-badge cf-badge--neutral';
  }

  private formatDate(value?: string | null): string {
    if (!value) {
      return '-';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  private formatLabel(value?: string | null): string {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return '-';
    }

    return raw
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private yesNo(value: unknown): string {
    if (value === true) {
      return 'Yes';
    }
    if (value === false) {
      return 'No';
    }
    return '-';
  }

  private toast(severity: 'success' | 'info' | 'warn' | 'error', summary: string, detail?: string): void {
    this.messages.add({ severity, summary, detail });
  }

  private errorOf(err: unknown): string {
    if (err && typeof err === 'object' && 'error' in err) {
      const payload = (err as { error?: { message?: string } }).error;
      if (payload?.message) {
        return payload.message;
      }
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'Request failed.';
  }
}
