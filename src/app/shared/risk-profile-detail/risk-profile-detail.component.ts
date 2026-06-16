import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MessageService } from 'primeng/api';

import { ApiService, RiskFlag, RiskLevel, RiskNote, RiskProfile } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { STAFF_PERMISSIONS } from '../../core/staff-permissions';

/** Identidad mínima del cliente cuyo perfil de riesgo se muestra/gestiona. */
export interface RiskProfileClientRef {
  id: string;
  email: string;
}

interface LevelOption {
  label: string;
  value: RiskLevel;
}
interface FlagOption {
  label: string;
  value: RiskFlag;
}

const LEVEL_OPTIONS: readonly LevelOption[] = [
  { label: 'Pending review', value: 'pending_review' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
];

const FLAG_OPTIONS: readonly FlagOption[] = [
  { label: 'None', value: 'none' },
  { label: 'Review', value: 'review' },
  { label: 'High risk', value: 'high_risk' },
  { label: 'Suspicious', value: 'suspicious' },
];

/**
 * Detalle de perfil de riesgo de un cliente (cargar, crear, editar nivel/flag y notas).
 *
 * Componente compartido para reutilizar el MISMO detalle desde dos sitios:
 *  - la página de risk profiles (listado -> detalle),
 *  - el detalle de cliente en la página de clients (categoría "Risk profile").
 *
 * Recibe el cliente por `client` y recarga el perfil cuando cambia. Emite `profileSynced`
 * tras cargar/crear/editar para que el contenedor mantenga su listado en sincronía.
 */
@Component({
  selector: 'app-risk-profile-detail',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './risk-profile-detail.component.html',
  styleUrl: './risk-profile-detail.component.css',
})
export class RiskProfileDetailComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly messages = inject(MessageService);
  private readonly auth = inject(AuthService);

  readonly client = input<RiskProfileClientRef | null>(null);
  readonly profileSynced = output<RiskProfile | null>();

  /** Crear/editar perfil y notas solo para compliance / compliance officer. */
  readonly canWrite = this.auth.hasAnyRole(STAFF_PERMISSIONS.riskProfilesWrite);
  readonly levelOptions = LEVEL_OPTIONS;
  readonly flagOptions = FLAG_OPTIONS;

  readonly profile = signal<RiskProfile | null>(null);
  readonly loading = signal(false);
  readonly notFound = signal(false);
  readonly errorMsg = signal('');
  readonly editing = signal(false);
  readonly addingNote = signal(false);
  readonly savingProfile = signal(false);
  readonly savingNote = signal(false);

  readonly profileForm = this.fb.nonNullable.group({
    level: ['' as RiskLevel | '', [Validators.required]],
    flag: ['' as RiskFlag | '', [Validators.required]],
  });

  readonly noteForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(250)]],
    description: ['', [Validators.required, Validators.maxLength(10000)]],
  });

  readonly notes = computed<RiskNote[]>(() => {
    const list = this.profile()?.notes ?? [];
    return [...list].sort((a, b) => this.time(b.createdAt) - this.time(a.createdAt));
  });

  get noteTitle() {
    return this.noteForm.controls.title;
  }
  get noteDescription() {
    return this.noteForm.controls.description;
  }

  /** Último id cargado. Evita recargas en bucle si el contenedor reemplaza la referencia del cliente. */
  private loadedForId: string | null = null;

  constructor() {
    // Carga el perfil SOLO cuando cambia el id del cliente. Si el contenedor pasa una nueva
    // referencia con el MISMO id (p. ej. al sincronizar su listado tras emitir profileSynced),
    // no se recarga: así se evita el bucle infinito de carga.
    effect(() => {
      const id = this.client()?.id ?? null;
      if (!id || id === this.loadedForId) return;
      this.loadedForId = id;
      void this.loadProfile(id);
    });
  }

  async loadProfile(userId: string): Promise<void> {
    this.loading.set(true);
    this.errorMsg.set('');
    this.notFound.set(false);
    this.profile.set(null);
    this.editing.set(false);
    this.addingNote.set(false);

    try {
      const res = await this.api.getRiskProfileByUser(userId);
      this.profile.set(res.riskProfile);
      this.profileSynced.emit(res.riskProfile);
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 404) {
        this.notFound.set(true);
        // Formulario de creación con valores por defecto sensatos.
        this.profileForm.reset({ level: 'pending_review', flag: 'none' });
        this.profileSynced.emit(null);
      } else {
        this.errorMsg.set(this.errorOf(err));
      }
    } finally {
      this.loading.set(false);
    }
  }

  startEdit(): void {
    const current = this.profile();
    if (!current) return;
    this.profileForm.reset({ level: current.level, flag: current.flag });
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  startAddNote(): void {
    this.noteForm.reset({ title: '', description: '' });
    this.addingNote.set(true);
  }

  cancelAddNote(): void {
    this.addingNote.set(false);
  }

  async onSaveProfile(): Promise<void> {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }
    const client = this.client();
    if (!client) return;

    const value = this.profileForm.getRawValue();
    const level = value.level as RiskLevel;
    const flag = value.flag as RiskFlag;

    this.savingProfile.set(true);
    try {
      const existing = this.profile();
      if (existing) {
        const res = await this.api.updateRiskProfile(existing.id, { level, flag });
        this.toast('success', 'Risk profile updated', res.message);
      } else {
        const res = await this.api.createRiskProfile({ userId: client.id, level, flag });
        this.toast('success', 'Risk profile created', res.message);
      }
      await this.loadProfile(client.id);
    } catch (err: unknown) {
      this.toast('error', 'Could not save', this.errorOf(err));
    } finally {
      this.savingProfile.set(false);
    }
  }

  async onAddNote(): Promise<void> {
    const profile = this.profile();
    const client = this.client();
    if (!profile || !client || this.noteForm.invalid) {
      this.noteForm.markAllAsTouched();
      return;
    }

    const value = this.noteForm.getRawValue();
    this.savingNote.set(true);
    try {
      const res = await this.api.createRiskNote(profile.id, {
        title: value.title.trim(),
        description: value.description.trim(),
      });
      this.noteForm.reset({ title: '', description: '' });
      await this.loadProfile(client.id);
      this.toast('success', 'Note added', res.message);
    } catch (err: unknown) {
      this.toast('error', 'Could not add note', this.errorOf(err));
    } finally {
      this.savingNote.set(false);
    }
  }

  // ---- labels / badges ----

  levelLabel(level?: string): string {
    return LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? (level ?? '—');
  }
  flagLabel(flag?: string): string {
    return FLAG_OPTIONS.find((o) => o.value === flag)?.label ?? (flag ?? '—');
  }
  levelBadgeClass(level?: string): string {
    switch (level) {
      case 'high':
        return 'cf-badge cf-badge--danger';
      case 'medium':
        return 'cf-badge cf-badge--warning';
      case 'low':
        return 'cf-badge cf-badge--success';
      default:
        return 'cf-badge cf-badge--neutral';
    }
  }
  flagBadgeClass(flag?: string): string {
    switch (flag) {
      case 'high_risk':
      case 'suspicious':
        return 'cf-badge cf-badge--danger';
      case 'review':
        return 'cf-badge cf-badge--warning';
      default:
        return 'cf-badge cf-badge--neutral';
    }
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
