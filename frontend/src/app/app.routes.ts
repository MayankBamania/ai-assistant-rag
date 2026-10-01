import { Routes } from '@angular/router';
import { LecturePageComponent } from './lecture-page/lecture-page.component';

export const routes: Routes = [
  {
    path: 'trainer',
    loadChildren: () =>
      import('./trainer/trainer.routes').then((m) => m.trainerRoutes),
  },
  {
    path: 'lecture/:lectureId',
    component: LecturePageComponent,
  },
  { path: '', redirectTo: '/trainer', pathMatch: 'full' },
];
