import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';

import {
  ApiService,
  RiskFlag,
  RiskLevel,
  RiskProfile,
  StaffUser,
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { STAFF_PERMISSIONS } from '../../core/staff-permissions';
import { RiskProfileDetailComponent } from '../../shared/risk-profile-detail/risk-profile-detail.component';

interface LevelOption {
  label: string;
  value: RiskLevel;
}
interface FlagOption {
  label: string;
  value: RiskFlag;
}

/** Cliente del listado: StaffUser con su risk profile poblado (viene en listClientsByStaff). */
type ClientRow = StaffUser & { riskProfile?: RiskProfile | null };

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

@Component({
  selector: 'app-risk-profiles-page',
  standalone: true,
  imports: [ReactiveFormsModule, TableModule, RiskProfileDetailComponent],
  templateUrl: './risk-profiles.page.html',
  styleUrl: './risk-profiles.page.css',
})
export class RiskProfilesPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly messages = inject(MessageService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Crear/editar perfil y notas solo para compliance / compliance officer. */
  readonly canWrite = this.auth.hasAnyRole(STAFF_PERMISSIONS.riskProfilesWrite);

  readonly levelOptions = LEVEL_OPTIONS;
  readonly flagOptions = FLAG_OPTIONS;

  // ---- Listado de clientes ----
  readonly clients = signal<ClientRow[]>([]);
  readonly loadingClients = signal(false);
  readonly search = signal('');
  readonly pageSize = 10;
  readonly view = signal<'list' | 'detail'>('list');

  /** Pestaña: gestionar perfiles existentes o crear uno nuevo (solo canWrite). */
  readonly mode = signal<'manage' | 'create'>('manage');
  /** Cliente elegido en la pestaña "Create" para crearle el perfil. */
  readonly creatingFor = signal<ClientRow | null>(null);

  readonly filtered = computed(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) return this.clients();
    return this.clients().filter((c) => String(c.email ?? '').toLowerCase().includes(query));
  });

  /** Clientes que aún NO tienen perfil de riesgo (para la pestaña "Create"). */
  readonly clientsNoProfile = computed(() => {
    const query = this.search().trim().toLowerCase();
    return this.clients().filter(
      (c) => !c.riskProfile && (!query || String(c.email ?? '').toLowerCase().includes(query)),
    );
  });

  // ---- Detalle: el cliente seleccionado; el perfil lo gestiona <app-risk-profile-detail>. ----
  readonly selectedClient = signal<ClientRow | null>(null);

  // Pestaña "Create": alta de perfil para un cliente que aún no tiene.
  readonly savingProfile = signal(false);
  readonly profileForm = this.fb.nonNullable.group({
    level: ['' as RiskLevel | '', [Validators.required]],
    flag: ['' as RiskFlag | '', [Validators.required]],
  });

  ngOnInit(): void {
    void this.loadClients().then(() => {
      // Deep-link desde el detalle de Clients: /risk-profiles?client=<id> abre el perfil del
      // cliente (o el formulario de creación si aún no tiene). Si el rol no lo ve, se ignora.
      const clientId = this.route.snapshot.queryParamMap.get('client');
      if (!clientId) return;
      const found = this.clients().find((c) => c.id === clientId);
      if (found) this.openClient(found);
    });
  }

  async loadClients(): Promise<void> {
    this.loadingClients.set(true);
    try {
      const res = await this.api.listClients();
      this.clients.set((res.users ?? []) as ClientRow[]);
    } catch {
      /* el interceptor ya muestra el aviso */
    } finally {
      this.loadingClients.set(false);
    }
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }
  clearSearch(): void {
    this.search.set('');
  }

  setMode(mode: 'manage' | 'create'): void {
    this.mode.set(mode);
    this.creatingFor.set(null);
    if (mode === 'manage') {
      this.view.set('list');
      this.selectedClient.set(null);
    }
  }

  openClient(client: ClientRow): void {
    this.selectedClient.set(client);
    this.view.set('detail');
  }

  async navigateToClient(client: ClientRow): Promise<void> {
    await this.router.navigate(['/clients'], { queryParams: { client: client.id } });
  }

  /** El detalle compartido avisa del perfil cargado/creado/editado; sincroniza el listado. */
  onProfileChanged(userId: string, profile: RiskProfile | null): void {
    this.patchClientProfile(userId, profile);
  }

  // ---- Pestaña "Create": elegir cliente sin perfil y crearlo ----

  pickForCreate(client: ClientRow): void {
    this.creatingFor.set(client);
    this.profileForm.reset({ level: 'pending_review', flag: 'none' });
  }

  cancelCreate(): void {
    this.creatingFor.set(null);
  }

  async onCreateProfile(): Promise<void> {
    const client = this.creatingFor();
    if (!client || this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }
    const value = this.profileForm.getRawValue();
    this.savingProfile.set(true);
    try {
      const res = await this.api.createRiskProfile({
        userId: client.id,
        level: value.level as RiskLevel,
        flag: value.flag as RiskFlag,
      });
      this.toast('success', 'Risk profile created', res.message);
      // Pasamos a "Manage" sobre ese cliente: ya muestra el perfil y permite añadir notas.
      this.creatingFor.set(null);
      this.mode.set('manage');
      this.openClient(client);
    } catch (err: unknown) {
      this.toast('error', 'Could not create', this.errorOf(err));
    } finally {
      this.savingProfile.set(false);
    }
  }

  backToList(): void {
    this.view.set('list');
    this.selectedClient.set(null);
  }

  /** Mantiene el nivel de riesgo del listado sincronizado tras crear/editar. */
  private patchClientProfile(userId: string, profile: RiskProfile | null): void {
    this.clients.update((list) =>
      list.map((c) => (c.id === userId ? { ...c, riskProfile: profile } : c)),
    );
  }

  // ---- labels / badges ----

  clientRiskLevel(client: ClientRow): RiskLevel | null {
    return client.riskProfile?.level ?? null;
  }
  clientRiskFlag(client: ClientRow): RiskFlag | null {
    return client.riskProfile?.flag ?? null;
  }

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

  stateLabel(state?: string): string {
    return String(state ?? '—').replace(/_/g, ' ');
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
