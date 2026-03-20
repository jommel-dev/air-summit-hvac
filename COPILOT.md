# Project: HVAC Warehouse and Sales Management System
# Role: Senior Fullstack Developer and Solutions Architect 

## Tasks:
### Task 1: Quotation Module
- [ ] Check the API and UI component of the Convert to SO since because there was an error during the execution and here is the error 'cannot insert a non-DEFAULT value into column "so_number"' and also double check and test all kind of scenario and fix any issues if ever encountered one using the actual form code in UI.
- [ ] In Print Preview make the Table Headers backgound color to #0f9cdf and text color to white including SALES CONTRACT, PAYMENT DETAILS, TERMS & CONDITIONS
- [ ] In Quotation Form Drawer can we add a Meterial Miscellaneous for additional costing of the estimation also add one column in the main table for the total amount of excess and header of it is Misc. so then in the TOTAL (PHP) value would be (excess total amount + Price/Discounted Price) and in printing or preview we need to add also new table below the main table of quotation for the Miscellaneous.
- [ ] We need to add also the Validity of quotation in example 14 days so when the user enter 14 it will automatically set the quotation validity and if it reaches that validity until it was not yet finalize we need to sof delete it and put it in a trash then we will be having a Expired Tab and in that expire tab we can permanently delete the quotation and it might require an authentication password by the super admin or admin.
- [ ] Before inserting the customer data kindly check if the customer is existing or not the Name, and other important details might not to be duplicated.

### Task 2: Sales Order Module
- [ ] When creating Service sales order in service details can we do a selection for Service Name [ 'CLEANING', 'DISMANTLE', 'RELOCATION', 'CHARING FREON', 'SURVEY', 'CHIPPING', 'PUMP DOWN', 'INSTALL ONLY', 'CHECKUP' ]
- [ ] When creating Concern Sales Order i am getting a "Please provide concern type or subject." but there is no content for this to complete the form.
- [ ] Before inserting the customer data kindly check if the customer is existing or not the Name, and other important details might not to be duplicated.

### Task 3: Customers Module
- [ ] How the SOA works on Customer and there should be a generated PDF for SOA Created and also i have checked when i generate SOA the previous Charges is adding as Opening then add the Charges and it get doubled.
- [ ] in Concerns Tab Service type Sales Order should be displayed in it and remove it in Orders Tab.
- [ ] separate the Project Type also and i would prefer the arrangement of tabs is like this Orders|Concerns|Projects|Payments|SOA

### Task 4: Schedule Today Sales Order
- [ ] Can we make the scanning of serial number logic here is make it the same like Purchase Order

### Task 5: Accounting Module (New)
- [ ] First Duplicate the page of Inventory because i want it to styled with Folder Tree View of any kind of reports 
- [ ] Create initial Report generation and verify and check the implemented Backend and UI if there is any
- [ ] The file tree mus have these items not the products: Cheque Voucher, General Journal Register, Disbursement Register, Sales Register, 2307 Tax Report, Weekly Sales, Daily Unit Realeased, Low Stocks Report and can we do like each item can be rbac configurable
- [ ] Cheque Voucher: this kind of report where you can create vouchers that contains Payee, Voucher Date, TIN Number, Address, Zip code, multiple cheque deposits, Particulars, multiple invoices with details, Account titles Details
- [ ] General Journal Register: this contains Description 