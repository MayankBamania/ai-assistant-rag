import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { ApiService, Lecture } from '../api.service';
import { LectureRowComponent } from '../lecture-row/lecture-row.component';

@Component({
  selector: 'app-course-detail',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, LectureRowComponent],
  template: `
    <div class="course-detail">
      <a [routerLink]="['/trainer']" class="back-link">← Back to Courses</a>

      <div class="page-header">
        <h1>Lectures</h1>
      </div>

      <!-- Lecture list -->
      <p class="section-label">Lectures</p>
      @if (lectures.length > 0) {
        <div class="lecture-list">
          @for (lecture of lectures; track lecture.id) {
            <app-lecture-row
              [lecture]="lecture"
              [courseId]="courseId"
              (retry)="onRetry($event)"
            ></app-lecture-row>
          }
        </div>
      } @else {
        <div class="empty-state">No lectures yet. Add one below.</div>
      }

      <!-- Add Lecture form -->
      <div class="add-lecture">
        <h2>Add Lecture</h2>

        <div class="form-group">
          <label for="lectureTitle">Lecture title</label>
          <input
            id="lectureTitle"
            type="text"
            [formControl]="titleControl"
            placeholder="e.g. Variables and Data Types"
            aria-describedby="titleError"
          />
          @if (titleControl.invalid && titleControl.dirty) {
            <span id="titleError" class="error-message" role="alert">
              Title must be between 1 and 100 characters.
            </span>
          }
        </div>

        <div class="form-group">
          <label for="lectureUrl">YouTube URL</label>
          <input
            id="lectureUrl"
            type="url"
            [formControl]="urlControl"
            placeholder="https://www.youtube.com/watch?v=..."
            aria-describedby="urlError"
          />
          @if (urlControl.invalid && urlControl.dirty) {
            <span id="urlError" class="error-message" role="alert">
              A valid YouTube URL is required.
            </span>
          }
        </div>

        <button
          class="btn-primary"
          type="button"
          (click)="onSubmit()"
          [disabled]="titleControl.invalid || urlControl.invalid || submitting"
        >
          {{ submitting ? 'Adding…' : 'Add Lecture' }}
        </button>

        @if (errorMessage) {
          <p class="error-banner" role="alert">{{ errorMessage }}</p>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: var(--color-bg); }

    .course-detail {
      max-width: 720px;
      margin: 0 auto;
      padding: 3rem 1.5rem;
    }

    /* ── Back link ── */
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.825rem;
      color: var(--color-text-muted);
      margin-bottom: 2rem;
      transition: color var(--transition);
      text-decoration: none;
    }
    .back-link:hover { color: var(--color-text); }

    /* ── Page header ── */
    .page-header {
      margin-bottom: 2.5rem;
    }
    .page-header h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--color-text);
      letter-spacing: -0.02em;
    }

    /* ── Lecture list ── */
    .section-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-text-faint);
      margin-bottom: 0.75rem;
    }

    .lecture-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 3rem;
    }

    .empty-state {
      padding: 1.5rem 1rem;
      background: var(--color-surface);
      border: 1px dashed var(--color-border);
      border-radius: var(--radius-md);
      text-align: center;
      color: var(--color-text-faint);
      font-size: 0.875rem;
      margin-bottom: 3rem;
    }

    /* ── Add lecture card ── */
    .add-lecture {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
    }

    .add-lecture h2 {
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: 1.25rem;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      margin-bottom: 1rem;
    }

    label {
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--color-text-muted);
    }

    input {
      padding: 0.625rem 0.875rem;
      background: var(--color-surface-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      color: var(--color-text);
      font-size: 0.9rem;
      font-family: inherit;
      outline: none;
      transition: border-color var(--transition), box-shadow var(--transition);
    }

    input::placeholder { color: var(--color-text-faint); }

    input:focus {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px var(--color-accent-dim);
    }

    .error-message { font-size: 0.78rem; color: var(--color-error); }

    .btn-primary {
      display: inline-flex;
      align-items: center;
      padding: 0.625rem 1.25rem;
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: var(--radius-sm);
      font-size: 0.875rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background var(--transition), opacity var(--transition);
    }

    .btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
    .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }

    .error-banner {
      margin-top: 0.75rem;
      font-size: 0.85rem;
      color: var(--color-error);
    }
  `],
})
export class CourseDetailComponent implements OnInit, OnDestroy {
  courseId = '';
  lectures: Lecture[] = [];

  titleControl = new FormControl('', [
    Validators.required,
    Validators.minLength(1),
    Validators.maxLength(100),
  ]);
  urlControl = new FormControl('', [Validators.required, Validators.minLength(1)]);

  submitting = false;
  errorMessage = '';

  // Map of lectureId -> interval handle for polling
  private pollingIntervals = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private route: ActivatedRoute, private api: ApiService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.courseId = this.route.snapshot.paramMap.get('courseId') ?? '';
    this.api.getLectures(this.courseId).subscribe({
      next: (res) => {
        this.lectures = res.lectures;
        // Resume polling for any lectures already in 'processing' state
        this.lectures
          .filter((l) => l.ingestion_status === 'processing')
          .forEach((l) => this.startPolling(l));
        this.cdr.detectChanges();
      },
      error: () => {
        this.errorMessage = 'Failed to load lectures.';
        this.cdr.detectChanges();
      },
    });
  }

  ngOnDestroy(): void {
    // Clear all polling intervals on component teardown
    this.pollingIntervals.forEach((handle) => clearInterval(handle));
    this.pollingIntervals.clear();
  }

  trackById(_: number, lecture: Lecture): string {
    return lecture.id;
  }

  onSubmit(): void {
    if (this.titleControl.invalid || this.urlControl.invalid || this.submitting) return;

    const title = this.titleControl.value!.trim();
    const url = this.urlControl.value!.trim();

    if (!title || !url) {
      this.titleControl.markAsDirty();
      this.urlControl.markAsDirty();
      return;
    }

    this.submitting = true;
    this.errorMessage = '';

    this.api.createLecture(this.courseId, title, url).subscribe({
      next: (lecture) => {
        // Append with 'processing' status (backend triggers ingestion automatically)
        const newLecture: Lecture = { ...lecture, ingestion_status: 'processing' };
        this.lectures = [...this.lectures, newLecture];
        this.titleControl.reset();
        this.urlControl.reset();
        this.submitting = false;
        this.startPolling(newLecture);
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.submitting = false;
        this.errorMessage =
          err?.error?.message ?? err?.message ?? 'Failed to add lecture.';
        this.cdr.detectChanges();
        // Form values are intentionally retained on error
      },
    });
  }

  onRetry(lecture: Lecture): void {
    this.errorMessage = '';
    this.api.triggerIngest(this.courseId, lecture.id, lecture.video_url).subscribe({
      next: () => {
        this.updateLectureStatus(lecture.id, 'processing');
        // Find the updated reference and resume polling
        const updated = this.lectures.find((l) => l.id === lecture.id);
        if (updated) {
          this.stopPolling(lecture.id);
          this.startPolling(updated);
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage =
          err?.error?.message ?? err?.message ?? 'Failed to retry ingestion.';
        this.cdr.detectChanges();
      },
    });
  }

  // ── Polling helpers ────────────────────────────────────────────────────────

  private startPolling(lecture: Lecture): void {
    if (this.pollingIntervals.has(lecture.id)) return; // already polling

    const handle = setInterval(() => {
      this.api.getLectureStatus(this.courseId, lecture.id).subscribe({
        next: (res) => {
          const status = res.ingestionStatus as Lecture['ingestion_status'];
          this.updateLectureStatus(lecture.id, status);
          if (status === 'ready' || status === 'failed') {
            this.stopPolling(lecture.id);
          }
        },
        // Silently ignore transient errors — polling will retry next tick
      });
    }, 5000);

    this.pollingIntervals.set(lecture.id, handle);
  }

  private stopPolling(lectureId: string): void {
    const handle = this.pollingIntervals.get(lectureId);
    if (handle !== undefined) {
      clearInterval(handle);
      this.pollingIntervals.delete(lectureId);
    }
  }

  private updateLectureStatus(
    lectureId: string,
    status: Lecture['ingestion_status']
  ): void {
    this.lectures = this.lectures.map((l) =>
      l.id === lectureId ? { ...l, ingestion_status: status } : l
    );
    this.cdr.detectChanges();
  }
}
