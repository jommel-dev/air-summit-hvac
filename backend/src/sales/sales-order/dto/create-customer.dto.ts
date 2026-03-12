export class CreateCustomerDto {
  name!: string;
  address?: string;
  contactPerson?: string;
  contactNumber?: string;
  email?: string;
  tinNumber?: string;
  customerType?: 'regular' | 'sub_dealer';
  creditLimit?: number;
  paymentTerms?: number;
}
