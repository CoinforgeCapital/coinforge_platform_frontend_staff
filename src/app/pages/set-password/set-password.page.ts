import { Component, inject, OnInit, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';

/** Las dos contraseñas deben coincidir. */
function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirm')?.value;
  return password && confirm && password !== confirm ? { mismatch: true } : null;
}

/**
 * Página pública donde el usuario (alta por staff o reset por admin) establece su contraseña
 * con el código de un solo uso que recibió por email. El código llega en `?code=...`.
 */
@Component({
  selector: 'app-set-password-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './set-password.page.html',
  styleUrl: './set-password.page.css',
})
export class SetPasswordPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  private code = '';

  readonly checking = signal(true);
  readonly linkValid = signal(false);
  readonly loading = signal(false);
  readonly done = signal(false);
  readonly showPassword = signal(false);
  readonly errorMessage = signal('');

  readonly form = this.fb.nonNullable.group(
    {
      password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
      confirm: ['', [Validators.required]],
    },
    { validators: passwordsMatch },
  );

  get password() {
    return this.form.controls.password;
  }

  async ngOnInit(): Promise<void> {
    this.code = this.route.snapshot.queryParamMap.get('code') ?? '';
    if (!this.code) {
      this.checking.set(false);
      return;
    }
    try {
      const res = await this.api.validateSetPasswordCode(this.code);
      this.linkValid.set(!!res.valid);
    } catch {
      this.linkValid.set(false);
    } finally {
      this.checking.set(false);
    }
  }

  togglePassword(): void {
    this.showPassword.update((visible) => !visible);
  }

  async onSubmit(): Promise<void> {
    this.errorMessage.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    try {
      await this.api.setPassword(this.code, this.form.controls.password.value);
      this.done.set(true);
    } catch (err: unknown) {
      this.errorMessage.set(this.toErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  private toErrorMessage(err: unknown): string {
    const e = err as { error?: { message?: unknown }; message?: unknown };
    const apiMessage = e.error?.message;
    if (typeof apiMessage === 'string' && apiMessage.trim()) return apiMessage;
    if (typeof e.message === 'string' && e.message.trim()) return e.message;
    return 'Could not set the password. The link may have expired.';
  }
}
