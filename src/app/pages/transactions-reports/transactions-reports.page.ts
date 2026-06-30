import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MessageService } from 'primeng/api';

import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-transactions-reports-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './transactions-reports.page.html',
  styleUrl: './transactions-reports.page.css',
})
export class TransactionsReportsPage {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly messages = inject(MessageService);

  readonly generating = signal(false);

  readonly form = this.fb.nonNullable.group({
    from: [this.formatDateInput(this.addDays(new Date(), -30)), Validators.required],
    to: [this.formatDateInput(new Date()), Validators.required],
  });

  rangeInvalid(): boolean {
    const { from, to } = this.form.getRawValue();
    return Boolean(from && to && from > to);
  }

  canGenerate(): boolean {
    return !this.generating()
      && this.form.valid
      && !this.rangeInvalid();
  }

  get from() {
    return this.form.controls.from;
  }

  get to() {
    return this.form.controls.to;
  }

  async generateReport(): Promise<void> {
    if (!this.canGenerate()) {
      this.form.markAllAsTouched();
      return;
    }

    const { from, to } = this.form.getRawValue();

    this.generating.set(true);
    try {
      const blob = await this.api.downloadCompletedTransactionsReportPdf(from, to);
      this.saveBlob(blob, `completed-transactions-${from}-to-${to}.pdf`);
    } catch (err: unknown) {
      this.messages.add({
        severity: 'error',
        summary: 'Could not generate report',
        detail: this.errorOf(err),
        life: 6000,
      });
    } finally {
      this.generating.set(false);
    }
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private formatDateInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private errorOf(err: unknown): string {
    if (err && typeof err === 'object' && 'error' in err) {
      const payload = (err as { error?: { message?: string } }).error;
      if (payload?.message) {
        return payload.message;
      }
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'The report could not be generated.';
  }
}
