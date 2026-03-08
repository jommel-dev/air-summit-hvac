
import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { MenuKey } from '../../shared/services/rbac.service';
import { CanDirective } from '../../shared/directives/can.directive';

@Component({
  selector: 'app-blank',
  imports: [
    PageBreadcrumbComponent,
    ButtonComponent,
    CanDirective,
],
  templateUrl: './blank.component.html',
  styles: ``
})
export class BlankComponent {
  currentMenu?: MenuKey;

  constructor(private readonly activatedRoute: ActivatedRoute) {
    this.currentMenu = this.activatedRoute.snapshot.data['menu'] as MenuKey | undefined;
  }
}
