import { Component, OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService, PlatformTutorialLanguage, PlatformTutorialManual } from '../../services/api.service';

type ApiErrorLike = {
  error?: { message?: unknown };
  message?: unknown;
};

interface TutorialSection {
  id: string;
  title: string;
  level: 2 | 3;
}

@Component({
  selector: 'app-platform-tutorial-page',
  standalone: true,
  templateUrl: './platform-tutorial.page.html',
  styleUrl: './platform-tutorial.page.css',
  encapsulation: ViewEncapsulation.None,
})
export class PlatformTutorialPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly manual = signal<PlatformTutorialManual | null>(null);
  readonly manualHtml = signal<SafeHtml>('');
  readonly tableOfContents = signal<TutorialSection[]>([]);
  readonly language = signal<PlatformTutorialLanguage>('en');
  readonly languages: { value: PlatformTutorialLanguage; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Español' },
    { value: 'lt', label: 'Lietuvių' },
  ];

  ngOnInit(): void {
    void this.loadManual();
  }

  async loadManual(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');

    try {
      const response = await this.api.getPlatformTutorialManual(this.language());
      const renderedManual = renderMarkdown(response.data.markdown);
      this.manual.set(response.data);
      this.tableOfContents.set(renderedManual.toc);
      this.manualHtml.set(this.sanitizer.bypassSecurityTrustHtml(renderedManual.html));
    } catch (error: unknown) {
      this.manual.set(null);
      this.tableOfContents.set([]);
      this.manualHtml.set('');
      this.errorMessage.set(this.toErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  scrollToSection(sectionId: string): void {
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  changeLanguage(language: PlatformTutorialLanguage): void {
    if (this.language() === language || this.loading()) return;
    this.language.set(language);
    void this.loadManual();
  }

  private toErrorMessage(error: unknown): string {
    const err = error as ApiErrorLike;
    const apiMessage = err.error?.message;
    const message = err.message;

    if (typeof apiMessage === 'string' && apiMessage.trim()) return apiMessage;
    if (typeof message === 'string' && message.trim()) return message;
    return 'The platform tutorial could not be loaded.';
  }
}

function renderMarkdown(markdown: string): { html: string; toc: TutorialSection[] } {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  const toc: TutorialSection[] = [];
  const slugCounts = new Map<string, number>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (isTableAt(lines, index)) {
      const table = renderTable(lines, index);
      html.push(table.html);
      index = table.nextIndex;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      const title = stripInlineMarkdown(heading[2]);
      const id = uniqueSlug(title, slugCounts);

      if (level === 2 || level === 3) {
        toc.push({ id, title, level });
      }

      html.push(`<h${level} id="${id}">${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^-\s+/.test(trimmed)) {
      const result = renderList(lines, index, 'ul');
      html.push(result.html);
      index = result.nextIndex;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const result = renderList(lines, index, 'ol');
      html.push(result.html);
      index = result.nextIndex;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && !isBlockStart(lines, index)) {
      const current = (lines[index] ?? '').trim();
      if (!current) break;
      paragraph.push(current);
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  }

  return { html: html.join('\n'), toc };
}

function renderTable(lines: string[], startIndex: number): { html: string; nextIndex: number } {
  const header = parseTableRow(lines[startIndex] ?? '');
  let index = startIndex + 2;
  const rows: string[][] = [];

  while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
    rows.push(parseTableRow(lines[index] ?? ''));
    index += 1;
  }

  const head = header.map((cell) => `<th>${renderInline(cell)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
    .join('');

  return {
    html: `<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
    nextIndex: index,
  };
}

function renderList(
  lines: string[],
  startIndex: number,
  tag: 'ul' | 'ol',
): { html: string; nextIndex: number } {
  const items: string[] = [];
  let index = startIndex;
  const pattern = tag === 'ul' ? /^-\s+(.+)$/ : /^\d+\.\s+(.+)$/;

  while (index < lines.length) {
    const match = pattern.exec((lines[index] ?? '').trim());
    if (!match) break;
    items.push(`<li>${renderInline(match[1])}</li>`);
    index += 1;
  }

  return {
    html: `<${tag}>${items.join('')}</${tag}>`,
    nextIndex: index,
  };
}

function isTableAt(lines: string[], index: number): boolean {
  const current = (lines[index] ?? '').trim();
  const next = (lines[index + 1] ?? '').trim();

  return current.startsWith('|') && /^\|?[\s:-]+\|[\s|:-]*$/.test(next);
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isBlockStart(lines: string[], index: number): boolean {
  const current = (lines[index] ?? '').trim();
  if (!current) return true;
  if (current.startsWith('```')) return true;
  if (/^#{1,4}\s+/.test(current)) return true;
  if (/^-\s+/.test(current)) return true;
  if (/^\d+\.\s+/.test(current)) return true;
  return isTableAt(lines, index);
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .trim();
}

function uniqueSlug(text: string, counts: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section';

  const count = counts.get(base) ?? 0;
  counts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
