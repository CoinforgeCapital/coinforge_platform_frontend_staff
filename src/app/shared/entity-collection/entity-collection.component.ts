import { Component, computed, input, output, signal } from '@angular/core';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';

import { formatAmountByField } from '../amount-format';

export interface EntityColumn {
  field: string;
  label: string;
}

interface DetailField {
  label: string;
  value: string;
  mono: boolean;
  wide: boolean;
}

interface DetailBadge {
  label: string;
  value: string;
  badgeClass: string;
}

interface PersonRef {
  label: string;
  email: string | null;
  /** null cuando la referencia existe en el registro pero está vacía (p. ej. sin asignar). */
  user: Record<string, unknown> | null;
  /** Texto a mostrar cuando no hay usuario (p. ej. "Unassigned"). */
  emptyText?: string;
}

interface MessageView {
  sender: string;
  body: string;
  date: string;
  attachments: string[];
}

interface ParsedDetail {
  title: string | null;
  badges: DetailBadge[];
  people: PersonRef[];
  fields: DetailField[];
  messages: MessageView[];
}

/** Campos que actúan como título del registro. */
const TITLE_KEYS = ['subject', 'name'];
/** Campos de estado/categoría que se muestran como chips con color. */
const BADGE_KEYS = new Set(['status', 'state', 'priority', 'target', 'role', 'type']);
/** Etiquetas legibles para las referencias a usuario. */
const PERSON_LABELS: Record<string, string> = {
  clientUser: 'Client',
  complianceUser: 'Compliance',
  assignedByUser: 'Assigned by',
  customerUser: 'Customer',
  staffUser: 'Staff',
  supportUser: 'Support',
  staffUserCreator: 'Created by',
  staffUserAssigned: 'Assigned to',
  closedBy: 'Closed by',
  sender: 'Sender',
};

/**
 * Vista reutilizable de una colección embebida:
 *  - Sin elemento seleccionado: tabla (columnas a medida, orden + paginación, fila clicable).
 *  - Con `selectedItem`: detalle (título + chips de estado + referencias a usuario clicables +
 *    datos + hilo de mensajes). Al pulsar una referencia a usuario se abre su info básica.
 */
@Component({
  selector: 'app-entity-collection',
  standalone: true,
  imports: [TableModule, DialogModule],
  templateUrl: './entity-collection.component.html',
  styleUrl: './entity-collection.component.css',
})
export class EntityCollectionComponent {
  readonly items = input<Record<string, unknown>[]>([]);
  readonly columns = input<EntityColumn[]>([]);
  readonly selectedItem = input<Record<string, unknown> | null>(null);
  readonly emptyLabel = input<string>('No records.');
  readonly hideMessages = input(false);

  readonly open = output<Record<string, unknown>>();

  readonly userDialogVisible = signal(false);
  readonly selectedUser = signal<Record<string, unknown> | null>(null);

  readonly detail = computed<ParsedDetail>(() => {
    const item = this.selectedItem();
    return item ? this.parse(item) : { title: null, badges: [], people: [], fields: [], messages: [] };
  });

  value(row: Record<string, unknown>, field: string): string {
    const value = field.split('.').reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[key];
    }, row);
    const formattedAmount = formatAmountByField(field, value as string | number | null | undefined);
    if (formattedAmount !== null) return formattedAmount;
    return this.format(value);
  }

  openUser(user: Record<string, unknown>): void {
    this.selectedUser.set(user);
    this.userDialogVisible.set(true);
  }

  initials(value: string): string {
    const name = (value.split('@')[0] || value).trim();
    const parts = name.split(/[._\-\s]+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => p[0]).join('');
    return (letters || value.slice(0, 2)).toUpperCase();
  }

  userEmail(user: Record<string, unknown>): string {
    return String(user['email'] ?? user['id'] ?? '—');
  }

  roleText(role: unknown): string {
    return String(role ?? '-').replace(/_/g, ' ');
  }

  stateBadgeClass(value: unknown): string {
    return 'cf-badge cf-badge--' + this.severity(String(value));
  }

  formatValue(value: unknown): string {
    return this.format(value);
  }

  private parse(item: Record<string, unknown>): ParsedDetail {
    let title: string | null = null;
    const badges: DetailBadge[] = [];
    const people: PersonRef[] = [];
    const fields: DetailField[] = [];
    let messages: MessageView[] = [];

    for (const [key, raw] of Object.entries(item)) {
      // Nunca exponer rutas de servidor, tokens ni blobs crudos en el detalle.
      if (this.isSensitiveKey(key)) continue;

      if (raw === null || raw === undefined || raw === '') {
        // Referencia a usuario presente pero vacía (p. ej. action request sin asignar):
        // se muestra explícitamente como "Unassigned" en lugar de omitirse.
        if (this.isPersonKey(key)) {
          people.push({
            label: PERSON_LABELS[key] ?? this.humanize(key),
            email: null,
            user: null,
            emptyText: /assign/i.test(key) ? 'Unassigned' : 'None',
          });
        }
        continue;
      }

      // Hilo de mensajes (tickets / conversaciones internas / action requests)
      if (key === 'messages' && Array.isArray(raw)) {
        messages = this.toThread(raw);
        continue;
      }

      // Referencia a usuario -> tarjeta clicable
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const ref = raw as Record<string, unknown>;
        if (ref['id'] !== undefined && this.isPersonKey(key)) {
          people.push({
            label: PERSON_LABELS[key] ?? this.humanize(key),
            email: (ref['email'] as string) ?? null,
            user: ref,
          });
          continue;
        }
      }

      // Título (asunto/nombre)
      if (!title && TITLE_KEYS.includes(key) && typeof raw !== 'object') {
        title = String(raw);
        continue;
      }

      // Estados/categorías -> chip con color
      if (BADGE_KEYS.has(key) && typeof raw !== 'object') {
        badges.push({
          label: this.humanize(key),
          value: this.format(raw),
          badgeClass: this.stateBadgeClass(raw),
        });
        continue;
      }

      // Resolver el valor
      let value: string;
      if (Array.isArray(raw)) {
        value = `${raw.length} item(s)`;
      } else if (typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        const ref = obj['email'] ?? obj['subject'] ?? obj['name'] ?? obj['id'];
        if (ref === undefined) continue;
        value = String(ref);
      } else {
        value = formatAmountByField(key, raw as string | number | null | undefined) ?? this.format(raw);
      }

      const isId = key === 'id' || /Id$/.test(key) || (typeof raw === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(raw));
      fields.push({ label: this.humanize(key), value, mono: isId, wide: value.length > 38 });
    }

    return { title, badges, people, fields, messages };
  }

  private isPersonKey(key: string): boolean {
    return /(user|sender|closedby)/.test(key.replace(/[_\s-]/g, '').toLowerCase());
  }

  /** Claves que no deben mostrarse nunca (rutas en servidor, tokens, blobs crudos…). */
  private isSensitiveKey(key: string): boolean {
    return /path|secret|token|hash|password|\braw|kycaid|formurl/i.test(key);
  }

  private toThread(raw: unknown[]): MessageView[] {
    return raw
      .map((m) => m as Record<string, unknown>)
      .sort((a, b) => String(a['createdAt'] ?? '').localeCompare(String(b['createdAt'] ?? '')))
      .map((m) => this.toMessage(m));
  }

  private toMessage(message: Record<string, unknown>): MessageView {
    const sender = message['sender'] as { email?: string } | undefined;
    const docs = Array.isArray(message['documents']) ? (message['documents'] as Record<string, unknown>[]) : [];
    return {
      sender: sender?.email ?? '—',
      body: String(message['body'] ?? message['content'] ?? message['message'] ?? ''),
      date: this.format(message['createdAt']),
      attachments: docs.map((d) => String(d['name'] ?? d['id'] ?? 'file')),
    };
  }

  private severity(value: string): string {
    const v = value.toLowerCase();
    if (['approved', 'resolved', 'verified', 'completed', 'active'].includes(v)) return 'success';
    if (['blocked', 'deleted', 'restricted', 'rejected', 'denied', 'urgent'].includes(v)) return 'danger';
    if (['pending', 'under_review', 'high'].includes(v)) return 'warning';
    if (['open', 'new', 'in_progress', 'kyc_send', 'normal', 'low'].includes(v)) return 'info';
    return 'neutral';
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
