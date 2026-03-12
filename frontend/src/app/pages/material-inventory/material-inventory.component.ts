/**
 * =====================================================
 * MATERIAL INVENTORY COMPONENT
 * =====================================================
 * Purpose: Manage material inventory (pipes, wires, accessories, etc.)
 *
 * Features:
 * - List all materials with search and filter
 * - Create/Edit/Delete materials
 * - Filter by material brands (type='MAT')
 * - Low stock alerts
 * =====================================================
 */

import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { MaterialInventoryService, Material, MaterialBrand } from '../../shared/services/material-inventory.service';

@Component({
  selector: 'app-material-inventory',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './material-inventory.component.html',
})
export class MaterialInventoryComponent implements OnInit {
  // State
  materials: Material[] = [];
  brands: MaterialBrand[] = [];
  isLoading = false;
  errorMessage = '';
  successMessage = '';

  // Filters
  search = '';
  selectedBrandId: number | null = null;

  // Drawer state
  isDrawerOpen = false;
  drawerMode: 'create' | 'edit' = 'create';
  editingId: number | null = null;
  isSubmitting = false;

  // Brand drawer state
  isBrandDrawerOpen = false;
  brandForm = {
    name: '',
    prefix: '',
    type: 'MAT'
  };

  // Form
  form = {
    brand_id: null as number | null,
    material_name: '',
    material_code: '',
    description: '',
    unit: 'PCS',
    unit_price: 0,
    sell_price: 0,
    on_hand_stock: 0,
    reorder_level: 0,
  };

  constructor(private materialService: MaterialInventoryService) {}

  async ngOnInit() {
    await this.loadBrands();
    await this.loadMaterials();
  }

  /**
   * Load all materials with filters
   */
  async loadMaterials() {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      this.materials = await this.materialService.getMaterials(
        this.search || undefined,
        this.selectedBrandId || undefined
      );
    } catch (error: any) {
      this.errorMessage = error.response?.data?.message || 'Failed to load materials';
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Load material brands
   */
  async loadBrands() {
    try {
      this.brands = await this.materialService.getMaterialBrands();
    } catch (error: any) {
      console.error('Failed to load brands:', error);
    }
  }

  /**
   * Open brand drawer
   */
  openBrandDrawer() {
    this.isBrandDrawerOpen = true;
    this.brandForm = { name: '', prefix: '', type: 'MAT' };
    this.errorMessage = '';
    this.successMessage = '';
  }

  /**
   * Close brand drawer
   */
  closeBrandDrawer() {
    this.isBrandDrawerOpen = false;
    this.brandForm = { name: '', prefix: '', type: 'MAT' };
  }

  /**
   * Save brand
   */
  async saveBrand() {
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.brandForm.name.trim()) {
      this.errorMessage = 'Brand name is required';
      return;
    }

    this.isSubmitting = true;

    try {
      await this.materialService.createBrand(this.brandForm.name, this.brandForm.prefix);
      this.successMessage = 'Brand created successfully';
      await this.loadBrands();
      this.closeBrandDrawer();
    } catch (error: any) {
      this.errorMessage = error.response?.data?.message || 'Failed to create brand';
    } finally {
      this.isSubmitting = false;
    }
  }

  /**
   * Open create drawer
   */
  openCreateDrawer() {
    this.drawerMode = 'create';
    this.editingId = null;
    this.resetForm();
    this.isDrawerOpen = true;
    this.errorMessage = '';
    this.successMessage = '';
  }

  /**
   * Open edit drawer
   */
  async openEditDrawer(material: Material) {
    this.drawerMode = 'edit';
    this.editingId = material.id;
    this.form = {
      brand_id: material.brand_id,
      material_name: material.material_name,
      material_code: material.material_code || '',
      description: material.description || '',
      unit: material.unit,
      unit_price: material.unit_price,
      sell_price: material.sell_price,
      on_hand_stock: material.on_hand_stock,
      reorder_level: material.reorder_level,
    };
    this.isDrawerOpen = true;
    this.errorMessage = '';
    this.successMessage = '';
  }

  /**
   * Close drawer
   */
  closeDrawer() {
    this.isDrawerOpen = false;
    this.resetForm();
  }

  /**
   * Save material (create or update)
   */
  async saveMaterial() {
    this.errorMessage = '';
    this.successMessage = '';

    // Validation
    if (!this.form.material_name.trim()) {
      this.errorMessage = 'Material name is required';
      return;
    }

    this.isSubmitting = true;

    try {
      if (this.drawerMode === 'create') {
        await this.materialService.createMaterial(this.form);
        this.successMessage = 'Material created successfully';
      } else {
        await this.materialService.updateMaterial(this.editingId!, this.form);
        this.successMessage = 'Material updated successfully';
      }

      await this.loadMaterials();
      this.closeDrawer();
    } catch (error: any) {
      this.errorMessage = error.response?.data?.message || 'Failed to save material';
    } finally {
      this.isSubmitting = false;
    }
  }

  /**
   * Delete material
   */
  async deleteMaterial(material: Material) {
    if (!confirm(`Delete material "${material.material_name}"?`)) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';

    // try {
    //   await this.materialService.deleteMaterial(material.id);
    //   this.successMessage = 'Material deleted successfully';
    //   await this.loadMaterials();
    // } catch (error: any) {
    //   this.errorMessage = error.response?.data?.message || 'Failed to delete material';
    // }
  }

  /**
   * Reset form
   */
  resetForm() {
    this.form = {
      brand_id: null,
      material_name: '',
      material_code: '',
      description: '',
      unit: 'PCS',
      unit_price: 0,
      sell_price: 0,
      on_hand_stock: 0,
      reorder_level: 0,
    };
  }

  /**
   * Handle search change
   */
  onSearchChange() {
    void this.loadMaterials();
  }

  /**
   * Handle brand filter change
   */
  onBrandFilterChange() {
    void this.loadMaterials();
  }

  /**
   * Check if material is low stock
   */
  isLowStock(material: Material): boolean {
    return material.on_hand_stock <= material.reorder_level;
  }

  /**
   * Format currency
   */
  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
    }).format(value);
  }
}
