import { Directive, Input, OnChanges, TemplateRef, ViewContainerRef } from '@angular/core';
import { MenuKey, PermissionKey, RbacService } from '../services/rbac.service';

type CanConfig =
  | PermissionKey
  | {
      menu?: MenuKey;
      permission?: PermissionKey;
    };

@Directive({
  selector: '[appCan]',
  standalone: true,
})
export class CanDirective implements OnChanges {
  @Input('appCan') config?: CanConfig;

  private hasView = false;

  constructor(
    private readonly templateRef: TemplateRef<unknown>,
    private readonly viewContainer: ViewContainerRef,
    private readonly rbacService: RbacService,
  ) {}

  ngOnChanges(): void {
    this.updateView();
  }

  private updateView(): void {
    const allowed = this.isAllowed();

    if (allowed && !this.hasView) {
      this.viewContainer.createEmbeddedView(this.templateRef);
      this.hasView = true;
      return;
    }

    if (!allowed && this.hasView) {
      this.viewContainer.clear();
      this.hasView = false;
    }
  }

  private isAllowed(): boolean {
    if (!this.config) {
      return false;
    }

    if (typeof this.config === 'string') {
      return this.rbacService.hasPermission(this.config);
    }

    const { menu, permission } = this.config;

    if (menu && permission) {
      return this.rbacService.canAccess(menu, permission);
    }

    if (menu) {
      return this.rbacService.hasMenu(menu);
    }

    if (permission) {
      return this.rbacService.hasPermission(permission);
    }

    return false;
  }
}
