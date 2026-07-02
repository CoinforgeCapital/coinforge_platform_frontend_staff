import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ApiService, ParametersRequest } from '../../services/api.service';

/**
 * Parámetros de la plataforma (SMTP y tareas programadas), solo admin.
 * Es un registro único: si no existe se crea (POST), si existe se actualiza (PATCH).
 */
@Component({
  selector: 'app-parameters-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './parameters.page.html',
  styleUrl: './parameters.page.css',
})
export class ParametersPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly messages = inject(MessageService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly showPassword = signal(false);
  /** null = sin cargar; true = ya existe config; false = aún no creada. */
  readonly configured = signal<boolean | null>(null);
  readonly loadError = signal('');

  readonly form = this.fb.nonNullable.group({
    smtpHost: ['', [Validators.required, Validators.maxLength(50)]],
    smtpPort: [587, [Validators.required, Validators.min(1), Validators.max(65535)]],
    smtpUser: ['', [Validators.required, Validators.maxLength(50)]],
    smtpPass: ['', [Validators.required, Validators.maxLength(50)]],
    backupTransactionsPdfDays: [1, [Validators.required, Validators.min(1)]],
    recoverPasswordCodeTtlHours: [1, [Validators.required, Validators.min(1), Validators.max(8760)]],
    changePasswordCodeTtlHours: [1, [Validators.required, Validators.min(1), Validators.max(8760)]],
    changeEmailCodeTtlHours: [1, [Validators.required, Validators.min(1), Validators.max(8760)]],
    setPasswordCodeTtlHours: [72, [Validators.required, Validators.min(1), Validators.max(8760)]],
    activationCodeTtlHours: [24, [Validators.required, Validators.min(1), Validators.max(8760)]],
    globalCommissionPercentage: [8.5, [Validators.required, Validators.min(0), Validators.max(100)]],
  });

  ngOnInit(): void {
    void this.load();
  }

  get smtpHost() {
    return this.form.controls.smtpHost;
  }
  get smtpPort() {
    return this.form.controls.smtpPort;
  }
  get smtpUser() {
    return this.form.controls.smtpUser;
  }
  get smtpPass() {
    return this.form.controls.smtpPass;
  }
  get backupTransactionsPdfDays() {
    return this.form.controls.backupTransactionsPdfDays;
  }
  get recoverPasswordCodeTtlHours() {
    return this.form.controls.recoverPasswordCodeTtlHours;
  }
  get changePasswordCodeTtlHours() {
    return this.form.controls.changePasswordCodeTtlHours;
  }
  get changeEmailCodeTtlHours() {
    return this.form.controls.changeEmailCodeTtlHours;
  }
  get setPasswordCodeTtlHours() {
    return this.form.controls.setPasswordCodeTtlHours;
  }
  get activationCodeTtlHours() {
    return this.form.controls.activationCodeTtlHours;
  }
  get globalCommissionPercentage() {
    return this.form.controls.globalCommissionPercentage;
  }

  togglePassword(): void {
    this.showPassword.update((visible) => !visible);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const p = await this.api.getParameters();
      this.form.patchValue({
        smtpHost: p.smtpHost,
        smtpPort: p.smtpPort,
        smtpUser: p.smtpUser,
        smtpPass: p.smtpPass ?? '',
        backupTransactionsPdfDays: p.backupTransactionsPdfDays,
        recoverPasswordCodeTtlHours: p.recoverPasswordCodeTtlHours,
        changePasswordCodeTtlHours: p.changePasswordCodeTtlHours,
        changeEmailCodeTtlHours: p.changeEmailCodeTtlHours,
        setPasswordCodeTtlHours: p.setPasswordCodeTtlHours,
        activationCodeTtlHours: p.activationCodeTtlHours,
        globalCommissionPercentage: this.toPercentageNumber(p.globalCommissionPercentage, 8.5),
      });
      this.configured.set(true);
    } catch (err: unknown) {
      // 404 => todavía no hay parámetros creados (modo creación).
      if ((err as { status?: number })?.status === 404) {
        this.configured.set(false);
      } else {
        this.configured.set(null);
        this.loadError.set(this.toErrorMessage(err));
      }
    } finally {
      this.loading.set(false);
    }
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const body: ParametersRequest = {
      smtpHost: value.smtpHost.trim(),
      smtpPort: Number(value.smtpPort),
      smtpUser: value.smtpUser.trim(),
      smtpPass: value.smtpPass,
      backupTransactionsPdfDays: Number(value.backupTransactionsPdfDays),
      recoverPasswordCodeTtlHours: Number(value.recoverPasswordCodeTtlHours),
      changePasswordCodeTtlHours: Number(value.changePasswordCodeTtlHours),
      changeEmailCodeTtlHours: Number(value.changeEmailCodeTtlHours),
      setPasswordCodeTtlHours: Number(value.setPasswordCodeTtlHours),
      activationCodeTtlHours: Number(value.activationCodeTtlHours),
      globalCommissionPercentage: Number(value.globalCommissionPercentage),
    };

    this.saving.set(true);
    try {
      if (this.configured()) {
        await this.api.updateParameters(body);
      } else {
        await this.api.createParameters(body);
      }

      this.messages.add({
        severity: 'success',
        summary: 'Parameters saved',
        detail: 'SMTP configuration was saved and the mailer was reloaded.',
        life: 5000,
      });

      await this.load();
    } catch (err: unknown) {
      this.messages.add({
        severity: 'error',
        summary: 'Could not save',
        detail: this.toErrorMessage(err),
        life: 6000,
      });
    } finally {
      this.saving.set(false);
    }
  }

  private toErrorMessage(err: unknown): string {
    const error = err as { error?: { message?: unknown }; message?: unknown };
    if (typeof error.error?.message === 'string' && error.error.message.trim()) return error.error.message;
    if (typeof error.message === 'string' && error.message.trim()) return error.message;
    return 'The request could not be completed. Please try again.';
  }

  private toPercentageNumber(value: string | number | null | undefined, fallback: number): number {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
