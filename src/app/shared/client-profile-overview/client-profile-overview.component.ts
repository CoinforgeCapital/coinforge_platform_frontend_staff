import { Component, computed, input, signal } from '@angular/core';

interface InfoField {
  label: string;
  value: string;
  mono: boolean;
}

/** Claves a ocultar en las tarjetas de Profile (ruido de KYCAID, ids, rutas…). */
const PROFILE_SKIP = /^id$|Id$|password|hash|^code$|Code$|token|^raw|kycaid|external|path|formUrl|url$|notes$|^user$/i;

/**
 * Resumen de solo lectura del cliente: datos personales, KYC y perfil de riesgo (con sus notas).
 * Extraído del detalle de cliente para mantener su CSS fuera de `clients.page.css` (presupuesto
 * de estilos por componente). No muta nada: solo recibe el cliente y lo pinta.
 */
@Component({
  selector: 'app-client-profile-overview',
  standalone: true,
  imports: [],
  templateUrl: './client-profile-overview.component.html',
  styleUrl: './client-profile-overview.component.css',
})
export class ClientProfileOverviewComponent {
  /** Cliente cuyo perfil/KYC/riesgo se muestra (solo lectura). */
  readonly client = input.required<Record<string, unknown> | null>();

  readonly showRiskNotes = signal(false);

  readonly personalDataFields = computed<InfoField[]>(() =>
    this.objectFields(this.client()?.['personalData']),
  );
  readonly kycFields = computed<InfoField[]>(() => this.objectFields(this.client()?.['kyc']));
  readonly riskFields = computed<InfoField[]>(() => this.objectFields(this.client()?.['riskProfile']));
  readonly riskNotes = computed<Record<string, unknown>[]>(() => {
    const notes = (this.client()?.['riskProfile'] as Record<string, unknown> | undefined)?.['notes'];
    return Array.isArray(notes) ? (notes as Record<string, unknown>[]) : [];
  });
  readonly hasProfileData = computed(
    () => this.personalDataFields().length + this.kycFields().length + this.riskFields().length > 0,
  );

  toggleRiskNotes(): void {
    this.showRiskNotes.update((v) => !v);
  }

  value(row: Record<string, unknown>, field: string): string {
    return this.format(this.resolvePath(row, field));
  }

  private objectFields(obj: unknown): InfoField[] {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
    const out: InfoField[] = [];
    for (const [key, raw] of Object.entries(obj as Record<string, unknown>)) {
      if (PROFILE_SKIP.test(key)) continue;
      if (raw === null || raw === undefined || raw === '') continue;
      if (typeof raw === 'object') continue;
      out.push({ label: this.humanize(key), value: this.format(raw), mono: false });
    }
    return out;
  }

  private resolvePath(row: Record<string, unknown> | null, path: string): unknown {
    if (!row) return undefined;
    return path.split('.').reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[key];
    }, row);
  }

  private format(value: unknown): string {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString();
    return String(value);
  }

  private humanize(key: string): string {
    const spaced = key.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
}
