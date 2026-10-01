import { Routes } from '@angular/router';
import { TrainerDashboardComponent } from './trainer-dashboard/trainer-dashboard.component';
import { CourseDetailComponent } from './course-detail/course-detail.component';

export const trainerRoutes: Routes = [
  { path: '', component: TrainerDashboardComponent },
  { path: 'courses/:courseId', component: CourseDetailComponent },
];
