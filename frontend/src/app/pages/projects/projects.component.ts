import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { TableComponent } from '../../shared/components/ui/table/table.component';
import { SalesOrderService, ProjectMasterOption, ProjectWithRelatedSOs } from '../../shared/services/sales-order.service';
import axios from 'axios';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent, TableComponent],
  templateUrl: './projects.component.html',
  styleUrls: ['./projects.component.css']
})
export class ProjectsComponent implements OnInit {
  projects: ProjectMasterOption[] = [];
  selectedProject: ProjectWithRelatedSOs | null = null;
  isDrawerOpen = false;
  isLoading = false;
  errorMessage = '';
  search = '';
  page = 1;
  limit = 20;
  total = 0;
  totalPages = 1;

  constructor(private salesOrderService: SalesOrderService) {}

  ngOnInit(): void {
    this.loadProjects();
  }

  async loadProjects(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      const result = await this.salesOrderService.searchProjects({
        search: this.search.trim() || undefined,
        page: this.page,
        limit: this.limit,
      });

      this.projects = result.items;
      this.total = result.meta.total;
      this.totalPages = result.meta.totalPages;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to load projects';
      } else {
        this.errorMessage = 'Unable to load projects';
      }
      this.projects = [];
      this.total = 0;
      this.totalPages = 1;
    } finally {
      this.isLoading = false;
    }
  }

  async openProjectDrawer(project: ProjectMasterOption): Promise<void> {
    try {
      this.selectedProject = await this.salesOrderService.getProjectWithRelatedSOs(project.id);
      this.isDrawerOpen = true;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to load project details';
      } else {
        this.errorMessage = 'Unable to load project details';
      }
    }
  }

  closeDrawer(): void {
    this.selectedProject = null;
    this.isDrawerOpen = false;
  }

  onSearchChange(): void {
    this.page = 1;
    this.loadProjects();
  }

  onPageChange(newPage: number): void {
    this.page = newPage;
    this.loadProjects();
  }

  getStatusColor(status: string | undefined): string {
    switch (status?.toLowerCase()) {
      case 'planning': return 'bg-blue-100 text-blue-800';
      case 'ongoing': return 'bg-green-100 text-green-800';
      case 'completed': return 'bg-gray-100 text-gray-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  getSOStatusColor(status: string): string {
    switch (status?.toLowerCase()) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'for-delivery': case 'for delivery': return 'bg-blue-100 text-blue-800';
      case 'remitted': return 'bg-purple-100 text-purple-800';
      case 'complete': case 'completed': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  trackBySOId(index: number, so: any) {
    return so.id;
  }
}
