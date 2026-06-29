import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { ApiService } from '../../services/api.service';

type SettingsFlow = 'password' | 'email';

type ApiErrorLike = {
  error?: { message?: unknown };
  message?: unknown;
};

/**
 * Ajustes de la cuenta del propio miembro del staff: cambio de contraseña y de
 * email en dos pasos (iniciar -> llega un código al email actual -> confirmar).
 * Réplica funcional del apartado de ajustes del frontend de cliente.
 */
@Component({
  selector: 'app-account-settings-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './account-settings.page.html',
  styleUrl: './account-settings.page.css',
})
export class AccountSettingsPage {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  readonly passwordStartLoading = signal(false);
  readonly passwordConfirmLoading = signal(false);
  readonly emailStartLoading = signal(false);
  readonly emailConfirmLoading = signal(false);

  readonly passwordStartMessage = signal('');
  readonly passwordConfirmMessage = signal('');
  readonly emailStartMessage = signal('');
  readonly emailConfirmMessage = signal('');

  readonly passwordErrorMessage = signal('');
  readonly emailErrorMessage = signal('');

  readonly showNewPassword = signal(false);

  readonly passwordStartForm = this.fb.nonNullable.group({
    newPassword: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
    confirmPassword: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
  });

  readonly passwordConfirmForm = this.fb.nonNullable.group({
    token: ['', [Validators.required, Validators.maxLength(256)]],
  });

  readonly emailStartForm = this.fb.nonNullable.group({
    newEmail: ['', [Validators.required, Validators.email, Validators.maxLength(128)]],
  });

  readonly emailConfirmForm = this.fb.nonNullable.group({
    token: ['', [Validators.required, Validators.maxLength(256)]],
  });

  constructor() {
    // Permite prerrellenar el código si se llega desde un enlace del email.
    const query = this.route.snapshot.queryParamMap;
    const genericToken = query.get('token') ?? query.get('code');
    const flow = query.get('flow') as SettingsFlow | null;

    const passwordToken =
      query.get('passwordToken') ??
      query.get('passwordCode') ??
      (flow === 'password' ? genericToken : null);

    const emailToken =
      query.get('emailToken') ??
      query.get('emailCode') ??
      (flow === 'email' ? genericToken : null);

    if (passwordToken) this.passwordConfirmForm.controls.token.setValue(passwordToken);
    if (emailToken) this.emailConfirmForm.controls.token.setValue(emailToken);
  }

  get newPassword() {
    return this.passwordStartForm.controls.newPassword;
  }

  get confirmPassword() {
    return this.passwordStartForm.controls.confirmPassword;
  }

  get passwordToken() {
    return this.passwordConfirmForm.controls.token;
  }

  get newEmail() {
    return this.emailStartForm.controls.newEmail;
  }

  get emailToken() {
    return this.emailConfirmForm.controls.token;
  }

  toggleNewPassword(): void {
    this.showNewPassword.update((visible) => !visible);
  }

  async onStartPasswordChange(): Promise<void> {
    this.clearMessages('password');

    if (this.passwordStartForm.invalid) {
      this.passwordStartForm.markAllAsTouched();
      return;
    }

    if (this.newPassword.value !== this.confirmPassword.value) {
      this.confirmPassword.setErrors({ passwordMismatch: true });
      this.passwordErrorMessage.set('Passwords do not match.');
      return;
    }

    this.passwordStartLoading.set(true);
    try {
      const response = await this.api.startChangePassword({ newPassword: this.newPassword.value });
      this.passwordStartMessage.set(response.message);
      this.passwordStartForm.reset();
    } catch (err: unknown) {
      this.passwordErrorMessage.set(this.toErrorMessage(err));
    } finally {
      this.passwordStartLoading.set(false);
    }
  }

  async onConfirmPasswordChange(): Promise<void> {
    this.passwordErrorMessage.set('');
    this.passwordConfirmMessage.set('');

    if (this.passwordConfirmForm.invalid) {
      this.passwordConfirmForm.markAllAsTouched();
      return;
    }

    this.passwordConfirmLoading.set(true);
    try {
      const response = await this.api.endChangePassword({
        token: this.passwordToken.value.trim(),
      });
      this.passwordConfirmMessage.set(response.message);
      this.passwordConfirmForm.reset();
    } catch (err: unknown) {
      this.passwordErrorMessage.set(this.toErrorMessage(err));
    } finally {
      this.passwordConfirmLoading.set(false);
    }
  }

  async onStartEmailChange(): Promise<void> {
    this.clearMessages('email');

    if (this.emailStartForm.invalid) {
      this.emailStartForm.markAllAsTouched();
      return;
    }

    this.emailStartLoading.set(true);
    try {
      const response = await this.api.startChangeEmail({
        newEmail: this.newEmail.value.trim().toLowerCase(),
      });
      this.emailStartMessage.set(response.message);
      this.emailStartForm.reset();
    } catch (err: unknown) {
      this.emailErrorMessage.set(this.toErrorMessage(err));
    } finally {
      this.emailStartLoading.set(false);
    }
  }

  async onConfirmEmailChange(): Promise<void> {
    this.emailErrorMessage.set('');
    this.emailConfirmMessage.set('');

    if (this.emailConfirmForm.invalid) {
      this.emailConfirmForm.markAllAsTouched();
      return;
    }

    this.emailConfirmLoading.set(true);
    try {
      const response = await this.api.endChangeEmail({
        token: this.emailToken.value.trim(),
      });
      this.emailConfirmMessage.set(response.message);
      this.emailConfirmForm.reset();
    } catch (err: unknown) {
      this.emailErrorMessage.set(this.toErrorMessage(err));
    } finally {
      this.emailConfirmLoading.set(false);
    }
  }

  private clearMessages(flow: SettingsFlow): void {
    if (flow === 'password') {
      this.passwordErrorMessage.set('');
      this.passwordStartMessage.set('');
      this.passwordConfirmMessage.set('');
      return;
    }

    this.emailErrorMessage.set('');
    this.emailStartMessage.set('');
    this.emailConfirmMessage.set('');
  }

  private toErrorMessage(err: unknown): string {
    const error = err as ApiErrorLike;
    const apiMessage = error.error?.message;
    const message = error.message;

    if (typeof apiMessage === 'string' && apiMessage.trim()) return apiMessage;
    if (typeof message === 'string' && message.trim()) return message;
    return 'The request could not be completed. Please try again.';
  }
}
