import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, Course } from '../api.service';

@Component({
  selector: 'app-trainer-dashboard',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="trainer-dashboard">
      <div class="page-header">
        <h1>My Courses</h1>
        <p>Manage your courses and lectures</p>
      </div>

      <!-- Course list -->
      <p class="section-label">Courses</p>
      @if (courses.length > 0) {
        <ul class="course-list">
          @for (course of courses; track course.id) {
            <li class="course-item">
              <a [routerLink]="['/trainer/courses', course.id]">{{ course.title }}</a>
            </li>
          }
        </ul>
      } @else {
        <div class="empty-state">No courses yet. Create your first one below.</div>
      }

      <!-- Create Course form -->
      <div class="create-course">
        <h2>Create Course</h2>

        <div class="form-group">
          <label for="courseTitle">Course title</label>
          <input
            id="courseTitle"
            type="text"
            [formControl]="titleControl"
            placeholder="e.g. Introduction to Python"
            aria-describedby="titleError"
          />
          @if (titleControl.invalid && titleControl.dirty) {
            <span id="titleError" class="error-message" role="alert">
              Title must be between 1 and 100 characters.
            </span>
          }
        </div>

        <button
          class="btn-primary"
          type="button"
          (click)="onSubmit()"
          [disabled]="titleControl.invalid || submitting"
        >
          {{ submitting ? 'Creating…' : 'Create Course' }}
        </button>

        @if (successMessage) {
          <p class="success-message" role="status">{{ successMessage }}</p>
        }
        @if (errorMessage) {
          <p class="error-banner" role="alert">{{ errorMessage }}</p>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: var(--color-bg); }

    .trainer-dashboard {
      max-width: 680px;
      margin: 0 auto;
      padding: 3rem 1.5rem;
    }

    /* ── Header ── */
    .page-header {
      margin-bottom: 2.5rem;
    }

    .page-header h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--color-text);
      letter-spacing: -0.02em;
    }

    .page-header p {
      margin-top: 0.375rem;
      font-size: 0.9rem;
      color: var(--color-text-muted);
    }

    /* ── Course list ── */
    .section-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-text-faint);
      margin-bottom: 0.75rem;
    }

    .course-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 3rem;
    }

    .course-item a {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.875rem 1rem;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text);
      font-size: 0.95rem;
      font-weight: 500;
      transition: border-color var(--transition), background var(--transition);
      text-decoration: none;
    }

    .course-item a::after {
      content: '→';
      color: var(--color-text-faint);
      font-size: 0.85rem;
      transition: color var(--transition), transform var(--transition);
    }

    .course-item a:hover {
      border-color: var(--color-accent);
      background: var(--color-surface-2);
    }

    .course-item a:hover::after {
      color: var(--color-accent);
      transform: translateX(3px);
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

    /* ── Create course card ── */
    .create-course {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
    }

    .create-course h2 {
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

    .error-message {
      font-size: 0.78rem;
      color: var(--color-error);
    }

    .btn-primary {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
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

    .success-message {
      margin-top: 0.75rem;
      font-size: 0.85rem;
      color: var(--color-success);
    }

    .error-banner {
      margin-top: 0.75rem;
      font-size: 0.85rem;
      color: var(--color-error);
    }
  `],
})
export class TrainerDashboardComponent implements OnInit {
  courses: Course[] = [];
  titleControl = new FormControl('', [
    Validators.required,
    Validators.minLength(1),
    Validators.maxLength(100),
  ]);
  submitting = false;
  successMessage = '';
  errorMessage = '';

  constructor(private api: ApiService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    console.log('[Dashboard] ngOnInit called');
    this.api.getCourses().subscribe({
      next: (res) => {
        console.log('[Dashboard] API response:', JSON.stringify(res));
        this.courses = res.courses;
        console.log('[Dashboard] courses set to:', this.courses.length, 'items');
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('[Dashboard] API error:', err);
        this.errorMessage = 'Failed to load courses.';
      },
    });
  }

  onSubmit(): void {
    if (this.titleControl.invalid || this.submitting) return;

    const title = this.titleControl.value!.trim();
    if (!title) {
      this.titleControl.markAsDirty();
      return;
    }

    this.submitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.api.createCourse(title).subscribe({
      next: (course) => {
        this.courses = [...this.courses, course];
        this.titleControl.reset();
        this.submitting = false;
        this.successMessage = 'Course created!';
        setTimeout(() => (this.successMessage = ''), 3000);
      },
      error: (err) => {
        this.submitting = false;
        this.errorMessage =
          err?.error?.message ?? err?.message ?? 'Failed to create course.';
      },
    });
  }
}
