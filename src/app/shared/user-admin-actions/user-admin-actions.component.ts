import { Component, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';

import { ApiService } from '../../services/api.service';

/** Usuario sobre el que operan las acciones admin del detalle. */
export interface AdminActionsUser {
  id: string;
  email: string;
  nickname?: string | null;
  /** staff => muestra nickname y "Reset password"; cliente => solo email. */
  isStaff: boolean;
  /** true si es la propia cuenta (no se puede borrar a uno mismo). */
  isSelf: boolean;
}

/**
 * Acciones de administración sobre un usuario (editar datos, reset de contraseña, borrar).
 *
 * Reutilizable: se usa como categoría "Admin actions" en el detalle de cliente y de staff. El
 * contenedor decide si mostrarla (gating admin / `usersWrite`); aquí solo se renderizan las
 * acciones permitidas según `isStaff` / `isSelf`. Emite `updated`/`deleted` para que el
 * contenedor sincronice su listado.
 */
@Component({
  selector: 'app-user-admin-actions',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './user-admin-actions.component.html',
  styleUrl: './user-admin-actions.component.css',
})
export class UserAdminActionsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmationService);
  private readonly messages = inject(MessageService);

  readonly user = input.required<AdminActionsUser>();
  /** Nuevos datos tras editar (email / nickname). */
  readonly updated = output<{ email: string; nickname: string | null }>();
  /** Id del usuario tras la baja lógica. */
  readonly deleted = output<string>();

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly resetting = signal(false);
  readonly deleting = signal(false);

  readonly editForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    nickname: ['', []],
  });

  get editEmail() {
    return this.editForm.controls.email;
  }
  get editNickname() {
    return this.editForm.controls.nickname;
  }

  startEdit(): void {
    const u = this.user();
    this.editForm.reset({ email: u.email, nickname: u.nickname ?? '' });
    const nick = this.editForm.controls.nickname;
    if (u.isStaff) {
      nick.setValidators([Validators.required, Validators.maxLength(100)]);
    } else {
      nick.clearValidators();
    }
    nick.updateValueAndValidity();
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  async onSaveDetails(): Promise<void> {
    const u = this.user();
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }
    const value = this.editForm.getRawValue();
    const body: { email: string; nickname?: string } = { email: value.email.trim() };
    if (u.isStaff) body.nickname = value.nickname.trim();

    this.saving.set(true);
    try {
      const res = await this.api.updateUser(u.id, body);
      this.toast('success', 'User updated', res.message);
      this.updated.emit({ email: body.email, nickname: u.isStaff ? (body.nickname ?? null) : (u.nickname ?? null) });
      this.editing.set(false);
    } catch (err: unknown) {
      this.toast('error', 'Could not update', this.errorOf(err));
    } finally {
      this.saving.set(false);
    }
  }

  onResetPassword(): void {
    const u = this.user();
    this.confirm.confirm({
      header: 'Reset password',
      message: `Reset the password for ${u.email}? A secure link to set a new password will be emailed to them, and their current password stops working immediately.`,
      icon: 'pi pi-key',
      acceptLabel: 'Reset password',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => {
        this.resetting.set(true);
        this.api
          .resetStaffPassword(u.id)
          .then((res) => this.toast('success', 'Password reset', res.message))
          .catch((err) => this.toast('error', 'Could not reset password', this.errorOf(err)))
          .finally(() => this.resetting.set(false));
      },
    });
  }

  onDelete(): void {
    const u = this.user();
    this.confirm.confirm({
      header: 'Delete user',
      message: `Delete ${u.email}? The account will be marked as deleted and the user will no longer be able to sign in.`,
      icon: 'pi pi-trash',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => {
        this.deleting.set(true);
        this.api
          .deleteUser(u.id)
          .then(() => {
            this.toast('success', 'User deleted', 'The account was marked as deleted.');
            this.deleted.emit(u.id);
          })
          .catch((err) => this.toast('error', 'Could not delete', this.errorOf(err)))
          .finally(() => this.deleting.set(false));
      },
    });
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
