import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.page.html',
  styleUrl: './login.page.css',
})
export class LoginPage {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  readonly loading = signal(false);
  readonly errorMessage = signal('');

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
  });

  get email() {
    return this.form.controls.email;
  }

  get password() {
    return this.form.controls.password;
  }

  async onSubmit(): Promise<void> {
    this.errorMessage.set('');

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    try {
      await this.auth.login(this.form.getRawValue());
    } catch (err: unknown) {
      this.errorMessage.set(this.toErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  private toErrorMessage(err: unknown): string {
    const error = err as { error?: { message?: unknown }; message?: unknown };
    const apiMessage = error.error?.message;
    const message = error.message;

    if (typeof apiMessage === 'string' && apiMessage.trim()) return apiMessage;
    if (typeof message === 'string' && message.trim()) return message;
    return 'Unable to sign in. Please check your credentials and try again.';
  }
}
