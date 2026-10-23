// lib/issue-templates.ts
//
// Shared (client-safe) limits and types of the issue templates. The limits match
// the "Report an Issue" form (title 120, description 2000).

export const ISSUE_TEMPLATE_NAME_MAX = 60;
export const ISSUE_TITLE_MAX = 120;
export const ISSUE_DESCRIPTION_MAX = 2000;

/** One template as the employee form and the IT page get it from the API. */
export interface IssueTemplateDto {
  id: number;
  name: string;
  title: string | null;
  description: string | null;
  assignedRoleIds: number[];
  isActive: boolean;
  sortOrder: number;
}
