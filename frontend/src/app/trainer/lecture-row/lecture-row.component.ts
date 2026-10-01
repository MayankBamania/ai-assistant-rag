import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Lecture } from '../api.service';

@Component({
  selector: 'app-lecture-row',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="lecture-row">
      <div class="lecture-info">
        <span class="lecture-title">{{ lecture.title }}</span>
        <a class="lecture-url" [href]="lecture.video_url" target="_blank" rel="noopener noreferrer">
          {{ lecture.video_url }}
        </a>
      </div>

      <div class="lecture-status">
        <!-- pending -->
        <span *ngIf="lecture.ingestion_status === 'pending'" class="badge badge-pending">
          Pending
        </span>

        <!-- processing -->
        <span *ngIf="lecture.ingestion_status === 'processing'" class="badge badge-processing">
          <span class="spinner" aria-hidden="true"></span>
          Processing
        </span>

        <!-- ready -->
        <ng-container *ngIf="lecture.ingestion_status === 'ready'">
          <span class="badge badge-ready">Ready</span>
          <a [routerLink]="['/lecture', lecture.id]" [queryParams]="{ courseId: courseId }" class="btn-open" aria-label="Open lecture {{ lecture.title }}">
            Open →
          </a>
        </ng-container>

        <!-- failed -->
        <ng-container *ngIf="lecture.ingestion_status === 'failed'">
          <span class="badge badge-failed">Failed</span>
          <button
            type="button"
            class="btn-retry"
            (click)="onRetry()"
            aria-label="Retry ingestion for {{ lecture.title }}"
          >
            Retry
          </button>
        </ng-container>
      </div>
    </div>
  `,
  styles: [`
    .lecture-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.875rem 1rem;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      gap: 1rem;
      transition: border-color var(--transition);
    }

    .lecture-row:hover {
      border-color: var(--color-border-light);
    }

    .lecture-info {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      min-width: 0;
      flex: 1;
    }

    .lecture-title {
      font-weight: 500;
      color: var(--color-text);
      font-size: 0.9rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .lecture-url {
      font-size: 0.75rem;
      color: var(--color-text-faint);
      text-decoration: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color var(--transition);
    }

    .lecture-url:hover { color: var(--color-text-muted); }

    .lecture-status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    /* ── Badges ── */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.2rem 0.6rem;
      border-radius: 99px;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .badge-pending  { background: var(--color-surface-2); color: var(--color-text-faint); border: 1px solid var(--color-border); }
    .badge-processing { background: var(--color-teal-dim); color: var(--color-teal); border: 1px solid rgba(20,184,166,0.25); }
    .badge-ready    { background: rgba(34,197,94,0.12);  color: var(--color-success); border: 1px solid rgba(34,197,94,0.25); }
    .badge-failed   { background: var(--color-error-dim); color: var(--color-error);   border: 1px solid rgba(239,68,68,0.25); }

    /* ── Spinner ── */
    .spinner {
      display: inline-block;
      width: 0.65rem;
      height: 0.65rem;
      border: 1.5px solid rgba(20,184,166,0.3);
      border-top-color: var(--color-teal);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Action buttons ── */
    .btn-open {
      padding: 0.3rem 0.75rem;
      background: var(--color-accent);
      color: #fff;
      border-radius: var(--radius-sm);
      font-size: 0.8rem;
      font-weight: 600;
      text-decoration: none;
      transition: background var(--transition);
    }

    .btn-open:hover { background: var(--color-accent-hover); color: #fff; }

    .btn-retry {
      padding: 0.3rem 0.75rem;
      background: var(--color-error-dim);
      color: var(--color-error);
      border: 1px solid rgba(239,68,68,0.25);
      border-radius: var(--radius-sm);
      font-size: 0.8rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background var(--transition);
    }

    .btn-retry:hover { background: rgba(239,68,68,0.2); }
  `],
})
export class LectureRowComponent {
  @Input() lecture!: Lecture;
  @Input() courseId!: string;
  @Output() retry = new EventEmitter<Lecture>();

  onRetry(): void {
    this.retry.emit(this.lecture);
  }
}
