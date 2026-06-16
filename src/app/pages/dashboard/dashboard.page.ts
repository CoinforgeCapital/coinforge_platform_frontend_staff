import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { STAFF_NAV_ITEMS } from '../../core/staff-permissions';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.css',
})
export class DashboardPage {
  private readonly auth = inject(AuthService);

  readonly visibleSections = computed(() =>
    STAFF_NAV_ITEMS.filter((item) => item.path !== '/dashboard' && this.auth.hasAnyRole(item.roles)),
  );

  roleLabel(): string {
    return this.auth.currentRole()?.replace(/_/g, ' ') ?? 'Staff';
  }
}
