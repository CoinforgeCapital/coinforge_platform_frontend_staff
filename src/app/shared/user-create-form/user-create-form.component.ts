import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MessageService } from 'primeng/api';

import { STAFF_ROLES } from '../../core/staff-permissions';
import {
  ApiService,
  CreateUserRequest,
  ManageableUserState,
  StaffRole,
  UserRole,
  UserState,
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

interface RoleOption {
  label: string;
  value: UserRole;
}
interface StateOption {
  label: string;
  value: UserState;
}

const CLIENT_STATES: readonly StateOption[] = [
  { label: 'New', value: 'new' },
  { label: 'KYC pending', value: 'kyc_pending' },
  { label: 'KYC sent', value: 'kyc_send' },
  { label: 'Under review', value: 'under_review' },
  { label: 'Approved', value: 'approved' },
  { label: 'Restricted', value: 'restricted' },
  { label: 'Blocked', value: 'blocked' },
];

const STAFF_STATES: readonly StateOption[] = [
  { label: 'Approved (active)', value: 'approved' },
  { label: 'Blocked', value: 'blocked' },
];

/**
 * Formulario de alta de usuario (cliente o staff), reutilizable.
 *
 * Es el MISMO formulario que usa la página de Management; se comparte para poder crear usuarios
 * también desde el listado de clientes y el de staff. Las opciones de rol y estado se derivan del
 * rol del staff autenticado (espejo del backend `createUserAction`). Emite `created` al crear.
 */
@Component({
  selector: 'app-user-create-form',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './user-create-form.component.html',
  styleUrl: './user-create-form.component.css',
})
export class UserCreateFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly messages = inject(MessageService);

  /**
   * Restringe los roles ofertados al contexto: 'client' (solo cliente), 'staff' (solo roles de
   * staff) o 'any' (todos los que el rol actual pueda crear, p. ej. en Management).
   */
  readonly kind = input<'client' | 'staff' | 'any'>('any');
  readonly created = output<void>();

  readonly creating = signal(false);

  readonly roleOptions = computed(() => {
    const all = this.getRoleOptions(this.auth.currentRole());
    const kind = this.kind();
    if (kind === 'client') return all.filter((o) => o.value === 'CLIENT');
    if (kind === 'staff') return all.filter((o) => o.value !== 'CLIENT');
    return all;
  });
  readonly showRoleSelect = computed(() => this.roleOptions().length > 1);

  private readonly selectedRole = signal<UserRole>('CLIENT');
  readonly isStaffTarget = computed(() => this.selectedRole() !== 'CLIENT');
  readonly createStateOptions = computed<readonly StateOption[]>(() =>
    this.isStaffTarget() ? STAFF_STATES : CLIENT_STATES,
  );

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    nickname: ['', []],
    role: ['CLIENT' as UserRole, [Validators.required]],
    state: ['kyc_pending' as UserState, [Validators.required]],
  });

  ngOnInit(): void {
    const initial = this.roleOptions()[0]?.value ?? 'CLIENT';
    this.form.controls.role.setValue(initial);
    this.selectedRole.set(initial);
    this.form.controls.state.setValue(this.defaultStateFor(initial));
    this.applyNicknameValidators(initial);
  }

  get email() {
    return this.form.controls.email;
  }
  get nickname() {
    return this.form.controls.nickname;
  }

  get roleHint(): string {
    const currentRole = this.auth.currentRole();
    if (currentRole === STAFF_ROLES.complianceOfficer) return 'As a compliance officer, you can create compliance users.';
    if (currentRole === STAFF_ROLES.supportOfficer) return 'As a support officer, you can create support users.';
    return 'Create a client or staff account. Available roles match your permissions.';
  }

  forcedRoleLabel(): string {
    return this.roleOptions()[0]?.label ?? '-';
  }

  onRoleChange(): void {
    const role = this.form.controls.role.value;
    this.selectedRole.set(role);
    this.form.controls.state.setValue(this.defaultStateFor(role));
    this.applyNicknameValidators(role);
  }

  async onCreate(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.creating.set(true);
    try {
      const response = await this.api.createUser(this.toCreateUserRequest());
      this.messages.add({
        severity: response.ok ? 'success' : 'warn',
        summary: response.ok ? 'User created' : 'User not created',
        detail: response.message,
        life: 6000,
      });
      if (response.ok) {
        this.resetCreateForm();
        this.created.emit();
      }
    } catch (err: unknown) {
      this.toast('error', 'User creation failed', this.toErrorMessage(err));
    } finally {
      this.creating.set(false);
    }
  }

  private resetCreateForm(): void {
    const initial = this.roleOptions()[0]?.value ?? 'CLIENT';
    this.form.reset({ email: '', nickname: '', role: initial, state: this.defaultStateFor(initial) });
    this.selectedRole.set(initial);
    this.applyNicknameValidators(initial);
  }

  private applyNicknameValidators(role: UserRole): void {
    const control = this.form.controls.nickname;
    if (role === 'CLIENT') {
      control.clearValidators();
      control.setValue('');
    } else {
      control.setValidators([Validators.required, Validators.maxLength(100)]);
    }
    control.updateValueAndValidity();
  }

  private defaultStateFor(role: UserRole): UserState {
    return role === 'CLIENT' ? 'kyc_pending' : 'approved';
  }

  private toCreateUserRequest(): CreateUserRequest {
    const value = this.form.getRawValue();
    const body: CreateUserRequest = {
      email: value.email,
      state: value.state as ManageableUserState,
    };
    if (value.role !== 'CLIENT') {
      body.nickname = value.nickname.trim();
    }
    const currentRole = this.auth.currentRole();
    if (currentRole === STAFF_ROLES.admin) {
      body.roleAdmin = value.role as CreateUserRequest['roleAdmin'];
    } else if (currentRole === STAFF_ROLES.operator) {
      body.roleOperator = value.role as CreateUserRequest['roleOperator'];
    }
    return body;
  }

  private getRoleOptions(role: StaffRole | null): RoleOption[] {
    if (role === STAFF_ROLES.admin) {
      return [
        { label: 'Client', value: 'CLIENT' },
        { label: 'Support', value: 'SUPPORT' },
        { label: 'Support officer', value: 'SUPPORT_OFFICER' },
        { label: 'Compliance', value: 'COMPLIANCE' },
        { label: 'Compliance officer', value: 'COMPLIANCE_OFFICER' },
        { label: 'Operator', value: 'OPERATOR' },
      ];
    }
    if (role === STAFF_ROLES.operator) {
      return [
        { label: 'Client', value: 'CLIENT' },
        { label: 'Support', value: 'SUPPORT' },
        { label: 'Support officer', value: 'SUPPORT_OFFICER' },
        { label: 'Compliance', value: 'COMPLIANCE' },
        { label: 'Compliance officer', value: 'COMPLIANCE_OFFICER' },
      ];
    }
    if (role === STAFF_ROLES.complianceOfficer) {
      return [{ label: 'Compliance', value: 'COMPLIANCE' }];
    }
    if (role === STAFF_ROLES.supportOfficer) {
      return [{ label: 'Support', value: 'SUPPORT' }];
    }
    return [];
  }

  private toast(severity: 'success' | 'error', summary: string, detail: string): void {
    this.messages.add({ severity, summary, detail, life: severity === 'error' ? 6000 : 5000 });
  }

  private toErrorMessage(err: unknown): string {
    const error = err as { error?: { message?: unknown }; message?: unknown };
    if (typeof error.error?.message === 'string' && error.error.message.trim()) return error.error.message;
    if (typeof error.message === 'string' && error.message.trim()) return error.message;
    return 'Unable to complete the operation.';
  }
}
