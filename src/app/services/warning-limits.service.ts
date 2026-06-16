import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type WarningLimitStatus = 'active' | 'draft' | 'paused';
export type WarningLimitSeverity = 'info' | 'warning' | 'critical';

export interface WarningLimit {
  id: string;
  name: string;
  warningType: string;
  amountEur: number;
  transactionCount: number | null;
  windowHours: number | null;
  severity: WarningLimitSeverity;
  status: WarningLimitStatus;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export type WarningLimitDraft = Omit<WarningLimit, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
};

const STORAGE_KEY = 'cf_staff_warning_limits';

/**
 * Gestiona los limites de alertas mostrados en la consola staff.
 */
@Injectable({ providedIn: 'root' })
export class WarningLimitsService {
  private readonly http = inject(HttpClient);
  private readonly seedUrl = '/warning-limits.json';

  async list(): Promise<WarningLimit[]> {
    const seeded = await this.loadSeed();
    const stored = this.readStored();
    if (stored) {
      const merged = this.mergeStoredWithSeed(stored, seeded);
      this.persist(merged);
      return merged;
    }

    this.persist(seeded);
    return seeded;
  }

  async save(draft: WarningLimitDraft): Promise<WarningLimit> {
    const list = await this.list();
    const now = new Date().toISOString();
    const current = draft.id ? list.find((item) => item.id === draft.id) : undefined;
    const limit: WarningLimit = {
      id: current?.id ?? draft.id ?? this.createId(),
      name: draft.name.trim(),
      warningType: draft.warningType,
      amountEur: this.toNumber(draft.amountEur),
      transactionCount: this.toNullableInteger(draft.transactionCount),
      windowHours: this.toNullableInteger(draft.windowHours),
      severity: draft.severity,
      status: draft.status,
      description: draft.description.trim(),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };

    const next = current
      ? list.map((item) => (item.id === current.id ? limit : item))
      : [limit, ...list];

    this.persist(next);
    return limit;
  }

  async reset(): Promise<WarningLimit[]> {
    const seeded = await this.loadSeed();
    this.persist(seeded);
    return seeded;
  }

  private async loadSeed(): Promise<WarningLimit[]> {
    const rows = await firstValueFrom(this.http.get<WarningLimit[]>(this.seedUrl));
    return Array.isArray(rows) ? rows.map((row) => this.normalize(row)) : [];
  }

  private readStored(): WarningLimit[] | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((row) => this.normalize(row as WarningLimit)) : null;
    } catch {
      return null;
    }
  }

  private persist(list: readonly WarningLimit[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  private mergeStoredWithSeed(stored: readonly WarningLimit[], seeded: readonly WarningLimit[]): WarningLimit[] {
    const storedIds = new Set(stored.map((item) => item.id));
    return [
      ...stored,
      ...seeded.filter((item) => !storedIds.has(item.id)),
    ];
  }

  private normalize(row: WarningLimit): WarningLimit {
    const now = new Date().toISOString();
    return {
      id: String(row.id || this.createId()),
      name: String(row.name || 'Untitled limit'),
      warningType: String(row.warningType || 'SINGLE'),
      amountEur: this.toNumber(row.amountEur),
      transactionCount: this.toNullableInteger(row.transactionCount),
      windowHours: this.toNullableInteger(row.windowHours),
      severity: this.asSeverity(row.severity),
      status: this.asStatus(row.status),
      description: String(row.description || ''),
      createdAt: String(row.createdAt || now),
      updatedAt: String(row.updatedAt || now),
    };
  }

  private createId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `limit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private toNumber(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
  }

  private toNullableInteger(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return Math.floor(numeric);
  }

  private asSeverity(value: unknown): WarningLimitSeverity {
    if (value === 'info' || value === 'critical') return value;
    return 'warning';
  }

  private asStatus(value: unknown): WarningLimitStatus {
    if (value === 'draft' || value === 'paused') return value;
    return 'active';
  }
}
