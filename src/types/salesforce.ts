// src/types/salesforce.ts
export interface AccountDocumentBase {
  Name: string;
  Application_Progress__c: string;
  Document_Type__c: string;
  Document_Link__c: string;
  Verified__c?: boolean;
}

export type AccountDocumentInsert = AccountDocumentBase;

export type AccountDocumentUpdate = AccountDocumentBase & {
  Id: string; // wajib untuk update
};
