import { Component } from '@angular/core';
import { GridShapeComponent } from '../../components/common/grid-shape/grid-shape.component';
import { RouterModule } from '@angular/router';
import { ThemeToggleTwoComponent } from '../../components/common/theme-toggle-two/theme-toggle-two.component';
import { BusinessSettingsService } from '../../services/business-settings.service';

@Component({
  selector: 'app-auth-page-layout',
  imports: [
    GridShapeComponent,
    RouterModule,
    ThemeToggleTwoComponent,
  ],
  templateUrl: './auth-page-layout.component.html',
  styles: ``
})
export class AuthPageLayoutComponent {
  private readonly defaultBusinessLogoLight = '/images/fwdslogo.png';
  private readonly defaultBusinessLogoDark = '/images/fwdslogo-dark.png';

  logoLightSrc = this.defaultBusinessLogoLight;
  logoDarkSrc = this.defaultBusinessLogoDark;

  constructor(private readonly businessSettingsService: BusinessSettingsService) {}

  ngOnInit(): void {
    void this.loadPublicBusinessBranding();
  }

  private async loadPublicBusinessBranding(): Promise<void> {
    try {
      const settings = await this.businessSettingsService.getPublicBusinessProfile();
      this.logoLightSrc = settings?.businessLogoLight || settings?.businessLogo || this.defaultBusinessLogoLight;
      this.logoDarkSrc = settings?.businessLogoDark || settings?.businessLogo || this.defaultBusinessLogoDark;
    } catch {
      this.logoLightSrc = this.defaultBusinessLogoLight;
      this.logoDarkSrc = this.defaultBusinessLogoDark;
    }
  }

}
