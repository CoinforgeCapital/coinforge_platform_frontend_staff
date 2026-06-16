import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ApiService, CatalogItem } from '../../services/api.service';

type CatalogKey = 'blockchains' | 'fiat-currencies' | 'crypto-currencies' | 'bank-data';

interface CatalogField {
  key: string;
  label: string;
  type: 'text' | 'select';
  placeholder?: string;
  maxLength?: number;
  uppercase?: boolean;
  /** false => no se incluye en el formulario de edición (p. ej. IBAN). */
  editable?: boolean;
  /** Para selects: de dónde salen las opciones. */
  optionsKey?: 'blockchains';
}

interface CatalogColumn {
  field: string;
  label: string;
}

interface CatalogConfig {
  key: CatalogKey;
  kicker: string;
  title: string;
  description: string;
  entityLabel: string;
  columns: CatalogColumn[];
  fields: CatalogField[];
  /** Campos por los que filtra el buscador del listado. */
  searchFields: string[];
  searchPlaceholder: string;
  canEdit: boolean;
  needsBlockchains: boolean;
}

const CATALOG_CONFIGS: Record<CatalogKey, CatalogConfig> = {
  blockchains: {
    key: 'blockchains',
    kicker: 'Catalog',
    title: 'Blockchains',
    description: 'Manage the blockchains supported by the platform.',
    entityLabel: 'blockchain',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'createdAt', label: 'Created' },
    ],
    fields: [{ key: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Ethereum', maxLength: 255 }],
    searchFields: ['name'],
    searchPlaceholder: 'Search by name…',
    canEdit: false,
    needsBlockchains: false,
  },
  'fiat-currencies': {
    key: 'fiat-currencies',
    kicker: 'Catalog',
    title: 'Fiat currencies',
    description: 'Manage the fiat currencies available on the platform.',
    entityLabel: 'fiat currency',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'symbol', label: 'Symbol' },
      { field: 'createdAt', label: 'Created' },
    ],
    fields: [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g. US Dollar', maxLength: 255 },
      { key: 'symbol', label: 'Symbol', type: 'text', placeholder: 'e.g. USD', maxLength: 30, uppercase: true },
    ],
    searchFields: ['name', 'symbol'],
    searchPlaceholder: 'Search by name or symbol…',
    canEdit: false,
    needsBlockchains: false,
  },
  'crypto-currencies': {
    key: 'crypto-currencies',
    kicker: 'Catalog',
    title: 'Crypto currencies',
    description: 'Manage the crypto currencies and their blockchain.',
    entityLabel: 'crypto currency',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'symbol', label: 'Symbol' },
      { field: 'blockchainName', label: 'Blockchain' },
      { field: 'createdAt', label: 'Created' },
    ],
    fields: [
      { key: 'blockchainId', label: 'Blockchain', type: 'select', optionsKey: 'blockchains' },
      { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Bitcoin', maxLength: 255 },
      { key: 'symbol', label: 'Symbol', type: 'text', placeholder: 'e.g. BTC', maxLength: 30, uppercase: true },
    ],
    searchFields: ['name', 'symbol'],
    searchPlaceholder: 'Search by name or symbol…',
    canEdit: false,
    needsBlockchains: true,
  },
  'bank-data': {
    key: 'bank-data',
    kicker: 'Treasury',
    title: 'Bank data',
    description: 'Manage the CoinForge bank accounts used to receive payments.',
    entityLabel: 'bank account',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'owner', label: 'Owner' },
      { field: 'iban', label: 'IBAN' },
      { field: 'swiftBic', label: 'SWIFT/BIC' },
      { field: 'referenceCode', label: 'Reference' },
      { field: 'createdAt', label: 'Created' },
    ],
    fields: [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'Account alias', maxLength: 255 },
      { key: 'iban', label: 'IBAN', type: 'text', placeholder: 'ES91…', maxLength: 50, uppercase: true, editable: false },
      { key: 'owner', label: 'Owner', type: 'text', placeholder: 'Account holder', maxLength: 255 },
      { key: 'swiftBic', label: 'SWIFT/BIC', type: 'text', placeholder: 'ABCDESMM', maxLength: 50 },
      { key: 'referenceCode', label: 'Reference code', type: 'text', placeholder: 'Payment reference', maxLength: 100 },
    ],
    searchFields: ['iban'],
    searchPlaceholder: 'Search by IBAN…',
    canEdit: true,
    needsBlockchains: false,
  },
};

@Component({
  selector: 'app-catalog-manager-page',
  standalone: true,
  imports: [ReactiveFormsModule, TableModule],
  templateUrl: './catalog-manager.page.html',
  styleUrl: './catalog-manager.page.css',
})
export class CatalogManagerPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  readonly config = signal<CatalogConfig>(CATALOG_CONFIGS.blockchains);
  readonly rows = signal<Record<string, unknown>[]>([]);
  readonly search = signal('');
  readonly blockchains = signal<CatalogItem[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly formOpen = signal(false);
  readonly editingId = signal<string | null>(null);

  form: FormGroup = new FormGroup({});

  /** Campos visibles en el formulario (en edición se ocultan los no editables). */
  readonly visibleFields = computed<CatalogField[]>(() => {
    const editing = this.editingId() !== null;
    return this.config().fields.filter((f) => !editing || f.editable !== false);
  });

  /** Filas filtradas por el buscador (según searchFields de cada catálogo). */
  readonly filteredRows = computed<Record<string, unknown>[]>(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) return this.rows();
    const fields = this.config().searchFields;
    return this.rows().filter((row) =>
      fields.some((field) => String(row[field] ?? '').toLowerCase().includes(query)),
    );
  });

  ngOnInit(): void {
    const key = (this.route.snapshot.data['sectionKey'] as CatalogKey) ?? 'blockchains';
    this.config.set(CATALOG_CONFIGS[key]);

    if (this.config().needsBlockchains) void this.loadBlockchains();
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const items = await this.listRequest();
      this.rows.set(this.config().key === 'crypto-currencies' ? this.withBlockchainNames(items) : items);
    } catch {
      /* el interceptor ya muestra el aviso */
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  clearSearch(): void {
    this.search.set('');
  }

  openCreate(): void {
    this.editingId.set(null);
    this.buildForm();
    this.formOpen.set(true);
  }

  openEdit(row: Record<string, unknown>): void {
    this.editingId.set(String(row['id'] ?? ''));
    this.buildForm(row);
    this.formOpen.set(true);
  }

  cancel(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    try {
      const raw = this.form.getRawValue() as Record<string, string>;
      const payload: Record<string, string> = {};
      for (const field of this.visibleFields()) {
        let value = (raw[field.key] ?? '').trim();
        if (field.uppercase) value = value.toUpperCase();
        payload[field.key] = value;
      }

      const id = this.editingId();
      const res = id ? await this.updateRequest(id, payload) : await this.createRequest(payload);
      const ok = res.ok !== false;

      this.messages.add({
        severity: ok ? 'success' : 'warn',
        summary: ok ? (id ? 'Updated' : 'Created') : 'Not saved',
        detail: res.message ?? '',
        life: 5000,
      });

      if (ok) {
        this.cancel();
        await this.load();
      }
    } catch {
      /* el interceptor ya muestra el aviso */
    } finally {
      this.saving.set(false);
    }
  }

  remove(row: Record<string, unknown>): void {
    const id = String(row['id'] ?? '');
    if (!id) return;

    const label = this.value(row, this.config().columns[0].field);
    const name = label && label !== '-' ? ` "${label}"` : '';

    this.confirm.confirm({
      header: `Delete ${this.config().entityLabel}`,
      message: `Delete this ${this.config().entityLabel}${name}? This action cannot be undone.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => void this.performDelete(id),
    });
  }

  private async performDelete(id: string): Promise<void> {
    try {
      await this.deleteRequest(id);
      this.messages.add({
        severity: 'success',
        summary: 'Deleted',
        detail: `The ${this.config().entityLabel} was deleted.`,
        life: 5000,
      });
      await this.load();
    } catch {
      /* el interceptor ya muestra el aviso */
    }
  }

  value(row: Record<string, unknown>, field: string): string {
    const value = field.split('.').reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[key];
    }, row);

    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString();
    return String(value);
  }

  private buildForm(values?: Record<string, unknown>): void {
    const group: Record<string, FormControl<string>> = {};
    for (const field of this.visibleFields()) {
      const validators = [Validators.required];
      if (field.maxLength) validators.push(Validators.maxLength(field.maxLength));
      group[field.key] = new FormControl(String(values?.[field.key] ?? ''), {
        nonNullable: true,
        validators,
      });
    }
    this.form = new FormGroup(group);
  }

  private withBlockchainNames(items: Record<string, unknown>[]): Record<string, unknown>[] {
    const map = new Map(this.blockchains().map((b) => [b.id, b.name ?? '-']));
    return items.map((row) => {
      const bc = row['blockchain'] as { id?: string; name?: string } | string | null | undefined;
      let blockchainName = '-';
      if (typeof bc === 'string') {
        blockchainName = map.get(bc) ?? '-';
      } else if (bc) {
        blockchainName = bc.name ?? map.get(bc.id ?? '') ?? '-';
      }
      return { ...row, blockchainName };
    });
  }

  private async loadBlockchains(): Promise<void> {
    try {
      const res = await this.api.listBlockchains();
      this.blockchains.set(res.blockchains ?? []);
      // Si la lista de crypto ya estaba cargada, re-resolvemos los nombres.
      if (this.config().key === 'crypto-currencies' && this.rows().length) {
        this.rows.set(this.withBlockchainNames(this.rows()));
      }
    } catch {
      /* el interceptor ya muestra el aviso */
    }
  }

  private listRequest(): Promise<Record<string, unknown>[]> {
    switch (this.config().key) {
      case 'blockchains':
        return this.api.listBlockchains().then((r) => (r.blockchains ?? []) as unknown as Record<string, unknown>[]);
      case 'fiat-currencies':
        return this.api.listFiatCurrencies().then((r) => (r.fiatCurrencies ?? []) as unknown as Record<string, unknown>[]);
      case 'crypto-currencies':
        return this.api.listCryptoCurrencies().then((r) => (r.cryptoCurrencies ?? []) as unknown as Record<string, unknown>[]);
      case 'bank-data':
        return this.api.listBankData().then((r) => (r.bankAccounts ?? []) as unknown as Record<string, unknown>[]);
    }
  }

  private createRequest(payload: Record<string, string>): Promise<{ ok: boolean; message?: string }> {
    switch (this.config().key) {
      case 'blockchains':
        return this.api.createBlockchain({ name: payload['name'] });
      case 'fiat-currencies':
        return this.api.createFiatCurrency({ name: payload['name'], symbol: payload['symbol'] });
      case 'crypto-currencies':
        return this.api.createCryptoCurrency({
          blockchainId: payload['blockchainId'],
          name: payload['name'],
          symbol: payload['symbol'],
        });
      case 'bank-data':
        return this.api.createBankData({
          name: payload['name'],
          iban: payload['iban'],
          owner: payload['owner'],
          swiftBic: payload['swiftBic'],
          referenceCode: payload['referenceCode'],
        });
    }
  }

  private updateRequest(id: string, payload: Record<string, string>): Promise<{ ok: boolean; message?: string }> {
    // Solo bank-data admite edición.
    return this.api.updateBankData(id, {
      name: payload['name'],
      owner: payload['owner'],
      swiftBic: payload['swiftBic'],
      referenceCode: payload['referenceCode'],
    });
  }

  private deleteRequest(id: string): Promise<void> {
    switch (this.config().key) {
      case 'blockchains':
        return this.api.deleteBlockchain(id);
      case 'fiat-currencies':
        return this.api.deleteFiatCurrency(id);
      case 'crypto-currencies':
        return this.api.deleteCryptoCurrency(id);
      case 'bank-data':
        return this.api.deleteBankData(id);
    }
  }
}
