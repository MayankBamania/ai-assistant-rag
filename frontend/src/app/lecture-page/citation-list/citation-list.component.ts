import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TimestampPipe } from '../../shared/timestamp.pipe';

export interface Citation {
  timestamp: number;
  url: string;
}

@Component({
  selector: 'app-citation-list',
  standalone: true,
  imports: [CommonModule, TimestampPipe],
  template: `
    <div class="citation-list" *ngIf="citations && citations.length > 0">
      <p class="citation-label">Sources</p>
      <button
        *ngFor="let citation of citations"
        type="button"
        class="citation-button"
        (click)="onCitationClick(citation)"
        [attr.aria-label]="'Jump to ' + (citation.timestamp | timestamp)"
      >
        {{ citation.timestamp | timestamp }}
      </button>
      <p *ngIf="videoNotReadyError" class="not-ready-error" role="alert">
        {{ videoNotReadyError }}
      </p>
    </div>
  `,
  styles: [`
    .citation-list {
      margin-top: 0.625rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--color-border);
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      align-items: center;
    }

    .citation-label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--color-text-faint);
      margin: 0;
      width: 100%;
    }

    .citation-button {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.2rem 0.55rem;
      border-radius: 99px;
      background: var(--color-teal-dim);
      color: var(--color-teal);
      font-size: 0.75rem;
      font-weight: 500;
      border: 1px solid rgba(20,184,166,0.25);
      cursor: pointer;
      font-family: inherit;
      transition: background var(--transition), border-color var(--transition);
    }

    .citation-button::before {
      content: '▶';
      font-size: 0.55rem;
      opacity: 0.7;
    }

    .citation-button:hover {
      background: rgba(20,184,166,0.22);
      border-color: rgba(20,184,166,0.4);
    }

    .not-ready-error {
      width: 100%;
      margin: 0.2rem 0 0;
      font-size: 0.72rem;
      color: var(--color-error);
    }
  `],
})
export class CitationListComponent {
  @Input() citations: Citation[] = [];
  @Input() isPlayerReady = false;
  @Output() seek = new EventEmitter<number>();

  videoNotReadyError = '';

  onCitationClick(citation: Citation): void {
    this.videoNotReadyError = '';
    if (!this.isPlayerReady) {
      this.videoNotReadyError = 'Video is not ready.';
      return;
    }
    this.seek.emit(citation.timestamp);
  }
}
