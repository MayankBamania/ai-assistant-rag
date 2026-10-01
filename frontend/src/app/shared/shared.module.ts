/**
 * SharedModule re-exports standalone shared components and pipes for use
 * in any NgModule-based or standalone context.
 *
 * In Angular 22 (standalone-first), SharedModule is kept as a convenience
 * re-export barrel. Import TimestampPipe directly in standalone components,
 * or import SharedModule in any NgModule that needs it.
 */
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TimestampPipe } from './timestamp.pipe';

@NgModule({
  imports: [CommonModule, TimestampPipe],
  exports: [TimestampPipe],
})
export class SharedModule {}
